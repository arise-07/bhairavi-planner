/**
 * state.js
 * Single in-memory store + all data mutations. Every view reads from `state`
 * and re-renders when a change event is emitted, so the dashboard, calendar,
 * task list, subjects and progress always show the same data.
 *
 * COMPLETION HISTORY RULE
 *  - Completing a task stores `completedAt` on the task AND appends a history entry.
 *  - Reopening a task clears `completedAt` and removes that task's history entries
 *    (the completion was undone, so it no longer counts toward streaks).
 *  - Deleting a task removes the task but keeps its history entries
 *    (the work really happened, so streaks and weekly counts do not drop).
 */

import * as store from './storage.js';
import { uid } from './utils.js';

export const state = {
  profile: null,
  settings: store.normalizeSettings({}),
  tasks: [],
  history: [],
  loadWarnings: [],
};

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(type, detail = {}) {
  listeners.forEach((fn) => {
    try { fn({ type, ...detail }); } catch (err) { console.error('[state listener]', err); }
  });
}

export function initState() {
  Object.assign(state, store.loadAll());
}

/* ---------- Profile & settings ---------- */

export function setProfileName(name) {
  const clean = String(name || '').trim().slice(0, 40);
  if (!clean) return false;
  state.profile = { createdAt: state.profile?.createdAt || new Date().toISOString(), name: clean };
  store.saveProfile(state.profile);
  emit('profile');
  return true;
}

export function updateSettings(patch) {
  state.settings = store.normalizeSettings({ ...state.settings, ...patch });
  store.saveSettings(state.settings);
  emit('settings');
}

export function addCustomSubject(name) {
  const clean = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!clean) return '';
  const existing = state.settings.customSubjects.find((s) => s.toLowerCase() === clean.toLowerCase());
  if (existing) return existing;
  updateSettings({ customSubjects: [...state.settings.customSubjects, clean] });
  return clean;
}

export function removeCustomSubject(name) {
  updateSettings({ customSubjects: state.settings.customSubjects.filter((s) => s !== name) });
}

/* ---------- Tasks ---------- */

export const getTask = (id) => state.tasks.find((t) => t.id === id) || null;
const indexOf = (id) => state.tasks.findIndex((t) => t.id === id);
const persistTasks = () => store.saveTasks(state.tasks);

export function addTask(input) {
  const now = new Date().toISOString();
  const task = store.normalizeTask({
    ...input, id: uid(), completed: false, completedAt: null, createdAt: now, updatedAt: now,
  });
  if (!task) return null;
  state.tasks.push(task);
  persistTasks();
  emit('tasks', { action: 'add', id: task.id });
  return task;
}

export function updateTask(id, patch) {
  const i = indexOf(id);
  if (i < 0) return null;
  const cur = state.tasks[i];
  const next = store.normalizeTask({
    ...cur,
    ...patch,
    id: cur.id,
    createdAt: cur.createdAt,
    completed: cur.completed,
    completedAt: cur.completedAt,
    updatedAt: new Date().toISOString(),
  });
  if (!next) return null;
  if (cur.demo) next.demo = true;
  state.tasks[i] = next;
  persistTasks();
  emit('tasks', { action: 'update', id });
  return next;
}

export function setTaskCompleted(id, completed) {
  const i = indexOf(id);
  if (i < 0) return null;
  const cur = state.tasks[i];
  if (cur.completed === completed) return cur;

  const now = new Date().toISOString();
  const next = { ...cur, completed, completedAt: completed ? now : null, updatedAt: now };
  state.tasks[i] = next;

  if (completed) {
    const entry = {
      id: uid(), taskId: id, title: next.title, subject: next.subject, dueDate: next.dueDate, completedAt: now,
    };
    if (next.demo) entry.demo = true;
    state.history.push(entry);
  } else {
    state.history = state.history.filter((h) => h.taskId !== id);
  }

  persistTasks();
  store.saveHistory(state.history);
  emit('tasks', { action: completed ? 'complete' : 'reopen', id });
  return next;
}

/** Removes a task. Returns a snapshot that `restoreTask` can use for Undo. */
export function deleteTask(id) {
  const i = indexOf(id);
  if (i < 0) return null;
  const [task] = state.tasks.splice(i, 1);
  persistTasks();
  emit('tasks', { action: 'delete', id });
  return { task, index: i };
}

export function restoreTask(snapshot) {
  if (!snapshot?.task || getTask(snapshot.task.id)) return;
  state.tasks.splice(Math.min(snapshot.index, state.tasks.length), 0, snapshot.task);
  persistTasks();
  emit('tasks', { action: 'restore', id: snapshot.task.id });
}

/* ---------- Bulk operations ---------- */

function persistAll() {
  store.saveProfile(state.profile);
  store.saveSettings(state.settings);
  persistTasks();
  store.saveHistory(state.history);
}

/**
 * mode 'replace': backup tasks, history and preferences replace current ones.
 *                 The current display name is kept.
 * mode 'merge':   only records whose id is not already present are added (no duplicates).
 * Returns the number of tasks added.
 */
export function importData(data, mode) {
  let added = 0;
  if (mode === 'replace') {
    state.tasks = data.tasks.slice();
    state.history = data.history.slice();
    if (data.settings) state.settings = data.settings;
    added = data.tasks.length;
  } else {
    const taskIds = new Set(state.tasks.map((t) => t.id));
    data.tasks.forEach((t) => { if (!taskIds.has(t.id)) { state.tasks.push(t); added++; } });
    const historyIds = new Set(state.history.map((h) => h.id));
    data.history.forEach((h) => { if (!historyIds.has(h.id)) state.history.push(h); });
    if (data.settings) {
      const merged = new Set([...state.settings.customSubjects, ...data.settings.customSubjects]);
      state.settings = store.normalizeSettings({ ...state.settings, customSubjects: [...merged] });
    }
  }
  persistAll();
  emit('all');
  return added;
}

export function removeDemoData() {
  state.tasks = state.tasks.filter((t) => !t.demo);
  state.history = state.history.filter((h) => !h.demo);
  persistTasks();
  store.saveHistory(state.history);
  emit('all');
}

export const hasDemoData = () => state.tasks.some((t) => t.demo);

export function clearAllData() {
  store.clearAllStorage();
  state.profile = null;
  state.settings = store.normalizeSettings({});
  state.tasks = [];
  state.history = [];
  emit('reset');
}
