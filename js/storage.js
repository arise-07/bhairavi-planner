/**
 * storage.js
 * Persistence layer over localStorage: versioned keys, validation on load,
 * safe writes, and JSON backup import/export.
 *
 * Nothing outside this file touches localStorage directly, so swapping this
 * module for API calls is the main change needed when a backend is added.
 */

import { isValidDateKey, toDateKey, uid } from './utils.js';

export const APP_ID = 'bhairavi-study-planner';
export const SCHEMA_VERSION = 1;

export const KEYS = Object.freeze({
  profile: 'bhairavi_profile_v1',
  tasks: 'bhairavi_tasks_v1',
  settings: 'bhairavi_settings_v1',
  history: 'bhairavi_completion_history_v1',
});

// Keys from the removed Focus Room. Never read; only cleared by "Clear all data".
const LEGACY_KEYS = ['bhairavi_focus_sessions_v1', 'bhairavi_timer_v1'];

export const PRIORITIES = ['low', 'medium', 'high'];
export const EXAM_TRACKS = ['NEET', 'JEE', 'Custom'];
export const CORE_SUBJECTS = ['Physics', 'Chemistry', 'Biology', 'Mathematics'];

export const DEFAULT_SETTINGS = Object.freeze({
  examTrack: 'NEET',
  weekStartsOn: 0, // 0 = Sunday, 1 = Monday
  calendarView: 'month', // 'month' | 'agenda'
  confirmDelete: true,
  customSubjects: [],
  customTrackSubjects: CORE_SUBJECTS, // core subjects included in the Custom course
});

/* ---------- Low-level access ---------- */

let errorHandler = () => {};
export function onStorageError(fn) { errorHandler = fn; }

export const storageAvailable = (() => {
  try {
    const k = '__bhairavi_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
})();

function readJSON(key) {
  if (!storageAvailable) return { value: undefined };
  let raw;
  try { raw = localStorage.getItem(key); } catch { return { value: undefined }; }
  if (raw == null) return { value: undefined };
  try { return { value: JSON.parse(raw) }; } catch { return { value: undefined, corrupt: true }; }
}

function writeJSON(key, value) {
  if (!storageAvailable) return false;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    errorHandler(err);
    return false;
  }
}

/* ---------- Validation / normalisation ---------- */

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const toISO = (v) => {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const intIn = (v, min, max, fallback) => {
  const n = Math.round(Number(v));
  return v !== null && v !== '' && Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

/**
 * Returns a clean task or null. Only a missing title makes a task unrecoverable;
 * any other bad field falls back to a safe default so one invalid optional field
 * never loses the task.
 */
export function normalizeTask(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = str(raw.title, 200);
  if (!title) return null;

  const now = new Date().toISOString();
  const createdAt = toISO(raw.createdAt) || now;
  const completed = raw.completed === true;

  const task = {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim().slice(0, 80) : uid(),
    title,
    description: str(raw.description, 2000),
    subject: str(raw.subject, 40),
    chapter: str(raw.chapter, 120),
    dueDate: isValidDateKey(raw.dueDate) ? raw.dueDate : toDateKey(new Date(createdAt)),
    priority: PRIORITIES.includes(raw.priority) ? raw.priority : 'medium',
    completed,
    createdAt,
    updatedAt: toISO(raw.updatedAt) || createdAt,
    completedAt: completed ? (toISO(raw.completedAt) || toISO(raw.updatedAt) || now) : null,
  };
  if (raw.demo === true) task.demo = true;
  return task;
}

export function normalizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_SETTINGS;
  return {
    examTrack: EXAM_TRACKS.includes(s.examTrack) ? s.examTrack : d.examTrack,
    weekStartsOn: s.weekStartsOn === 1 ? 1 : 0,
    calendarView: s.calendarView === 'agenda' ? 'agenda' : 'month',
    confirmDelete: s.confirmDelete !== false,
    customSubjects: Array.isArray(s.customSubjects)
      ? [...new Set(s.customSubjects.map((x) => str(x, 40)).filter(Boolean))].slice(0, 30)
      : [],
    customTrackSubjects: Array.isArray(s.customTrackSubjects)
      ? CORE_SUBJECTS.filter((x) => s.customTrackSubjects.includes(x))
      : [...d.customTrackSubjects],
  };
}

export function normalizeProfile(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = str(raw.name, 40);
  if (!name) return null;
  return { name, createdAt: toISO(raw.createdAt) || new Date().toISOString() };
}

export function normalizeHistoryEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const completedAt = toISO(raw.completedAt);
  if (!completedAt || typeof raw.taskId !== 'string' || !raw.taskId) return null;
  const entry = {
    id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 80) : uid(),
    taskId: raw.taskId,
    title: str(raw.title, 200) || 'Untitled task',
    subject: str(raw.subject, 40),
    dueDate: isValidDateKey(raw.dueDate) ? raw.dueDate : null,
    completedAt,
  };
  if (raw.demo === true) entry.demo = true;
  return entry;
}

function normalizeList(list, normalizer) {
  if (!Array.isArray(list)) return { items: [], skipped: 0 };
  const seen = new Set();
  const items = [];
  let skipped = 0;
  for (const raw of list) {
    const item = normalizer(raw);
    if (!item || seen.has(item.id)) { skipped++; continue; }
    seen.add(item.id);
    items.push(item);
  }
  return { items, skipped };
}

/* ---------- Load / save ---------- */

export function loadAll() {
  const warnings = [];
  const p = readJSON(KEYS.profile);
  const s = readJSON(KEYS.settings);
  const t = readJSON(KEYS.tasks);
  const h = readJSON(KEYS.history);

  [p, s, t, h].forEach((r) => { if (r.corrupt) warnings.push('unreadable'); });

  const tasks = normalizeList(t.value, normalizeTask);
  const history = normalizeList(h.value, normalizeHistoryEntry);
  if (tasks.skipped || history.skipped) warnings.push('skipped');

  return {
    profile: normalizeProfile(p.value),
    settings: normalizeSettings(s.value),
    tasks: tasks.items,
    history: history.items,
    loadWarnings: warnings,
  };
}

export const saveProfile = (profile) => writeJSON(KEYS.profile, profile);
export const saveSettings = (settings) => writeJSON(KEYS.settings, settings);
export const saveTasks = (tasks) => writeJSON(KEYS.tasks, tasks);
export const saveHistory = (history) => writeJSON(KEYS.history, history);

export function clearAllStorage() {
  if (!storageAvailable) return;
  [...Object.values(KEYS), ...LEGACY_KEYS].forEach((k) => {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
  });
}

/** Approximate bytes used by this app's keys (UTF-16, 2 bytes per char). */
export function storageUsageBytes() {
  if (!storageAvailable) return 0;
  return Object.values(KEYS).reduce((sum, k) => {
    try { return sum + (localStorage.getItem(k) || '').length * 2; } catch { return sum; }
  }, 0);
}

/* ---------- Backup export / import ---------- */

export function buildBackup(state) {
  return {
    app: APP_ID,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    profile: state.profile,
    settings: state.settings,
    tasks: state.tasks,
    completionHistory: state.history,
  };
}

/**
 * Validate a backup file's text. Returns { ok, error } or { ok, data, summary }.
 * Nothing is written here; the caller decides whether to merge or replace.
 */
export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch {
    return { ok: false, error: 'This file is not valid JSON.' };
  }
  if (!data || typeof data !== 'object' || data.app !== APP_ID) {
    return { ok: false, error: 'This file is not a Bhairavi Study Planner backup.' };
  }
  if (typeof data.schemaVersion !== 'number' || data.schemaVersion > SCHEMA_VERSION) {
    return { ok: false, error: 'This backup was made by a newer version of the planner and cannot be imported.' };
  }
  if (!Array.isArray(data.tasks)) {
    return { ok: false, error: 'The backup does not contain a task list.' };
  }
  const tasks = normalizeList(data.tasks, normalizeTask);
  const history = normalizeList(data.completionHistory, normalizeHistoryEntry);
  return {
    ok: true,
    data: {
      profile: normalizeProfile(data.profile),
      settings: data.settings ? normalizeSettings(data.settings) : null,
      tasks: tasks.items,
      history: history.items,
      exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : null,
    },
    summary: {
      tasks: tasks.items.length,
      skipped: tasks.skipped,
      history: history.items.length,
    },
  };
}
