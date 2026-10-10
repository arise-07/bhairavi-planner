/**
 * modal.js
 * The reusable Add/Edit Task dialog, task deletion flow, and the global
 * delegated handlers for task checkboxes / edit / delete buttons used on
 * every page (one set of listeners for the whole app, attached once).
 */

import {
  state, addTask, updateTask, getTask, deleteTask, restoreTask, setTaskCompleted, addCustomSubject,
} from './state.js';
import { subjectGroups } from './stats.js';
import { todayKey, isValidDateKey, esc } from './utils.js';
import { toast, confirmDialog, announce, syncScrollLock } from './ui.js';

const NEW_SUBJECT = '__new__';

let dlg;
let form;
const el = {};
let editingId = null;
let snapshot = '';
let returnFocus = null;
let saving = false;
let pointerStartedOnBackdrop = false;

/* ---------- Setup ---------- */

export function initTaskModal() {
  dlg = document.getElementById('task-modal');
  form = document.getElementById('task-form');
  Object.assign(el, {
    heading: document.getElementById('task-modal-title'),
    title: document.getElementById('tf-title'),
    desc: document.getElementById('tf-desc'),
    subject: document.getElementById('tf-subject'),
    subjectNewWrap: document.getElementById('tf-subject-new-wrap'),
    subjectNew: document.getElementById('tf-subject-new'),
    chapter: document.getElementById('tf-chapter'),
    date: document.getElementById('tf-date'),
    del: document.getElementById('tf-delete'),
    save: document.getElementById('tf-save'),
  });

  form.addEventListener('submit', onSubmit);

  // Escape key: ask before discarding unsaved changes.
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); attemptClose(); });

  // Backdrop click closes only when the press STARTED on the backdrop and the form is clean.
  // Dragging out of an input (e.g. selecting text) never closes the dialog.
  dlg.addEventListener('pointerdown', (e) => { pointerStartedOnBackdrop = e.target === dlg; });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg && pointerStartedOnBackdrop && !isDirty()) closeModal();
    pointerStartedOnBackdrop = false;
  });

  dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => attemptClose()));
  dlg.addEventListener('close', () => {
    syncScrollLock();
    if (returnFocus && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  });

  el.subject.addEventListener('change', syncSubjectNew);
  form.addEventListener('input', (e) => clearError(e.target));
  el.del.addEventListener('click', async () => {
    if (!editingId) return;
    const deleted = await requestDeleteTask(editingId);
    if (deleted) closeModal();
  });
}

export const isTaskModalOpen = () => !!dlg?.open;

/* ---------- Open ---------- */

/**
 * openTaskModal({ task?, date?, subject?, trigger? })
 *  - task: edit an existing task
 *  - date / subject: preselect when creating (from calendar / subject views)
 */
export function openTaskModal({ task = null, date = '', subject = undefined, trigger = null } = {}) {
  if (!dlg) return;
  if (dlg.open) return;
  editingId = task ? task.id : null;
  returnFocus = trigger || document.activeElement;
  saving = false;
  clearAllErrors();

  el.heading.textContent = task ? 'Edit task' : 'Add task';
  el.save.textContent = task ? 'Save Changes' : 'Save Task';
  el.del.hidden = !task;

  const presetSubject = task ? task.subject : subject !== undefined ? subject : defaultSubject();
  fillSubjects(presetSubject);
  el.subjectNew.value = '';
  syncSubjectNew();

  el.title.value = task?.title || '';
  el.desc.value = task?.description || '';
  el.chapter.value = task?.chapter || '';
  el.date.value = task ? task.dueDate : isValidDateKey(date) ? date : todayKey();
  setRadio('priority', task?.priority || 'medium');

  snapshot = serialize();
  dlg.showModal();
  syncScrollLock();
  el.title.focus();
  if (task) el.title.setSelectionRange(el.title.value.length, el.title.value.length);
}

function defaultSubject() {
  const groups = subjectGroups(state.settings, state.tasks);
  return groups[0]?.items[0] || '';
}

function fillSubjects(selected) {
  const groups = subjectGroups(state.settings, state.tasks);
  const all = groups.flatMap((g) => g.items);
  if (selected && !all.includes(selected)) groups.push({ label: 'Current', items: [selected] });
  el.subject.innerHTML = `<option value="">No subject</option>${groups.map((g) => `<optgroup label="${esc(g.label)}">${g.items.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</optgroup>`).join('')}<option value="${NEW_SUBJECT}">Add new subject…</option>`;
  el.subject.value = selected || '';
}

/* ---------- Form helpers ---------- */

const radios = (name) => [...form.querySelectorAll(`input[name="${name}"]`)];
const getRadio = (name) => radios(name).find((r) => r.checked)?.value || '';
function setRadio(name, value) { radios(name).forEach((r) => { r.checked = r.value === value; }); }

function syncSubjectNew() {
  const show = el.subject.value === NEW_SUBJECT;
  el.subjectNewWrap.hidden = !show;
  if (show) el.subjectNew.focus();
}

function serialize() {
  return JSON.stringify([
    el.title.value, el.desc.value, el.subject.value, el.subjectNew.value, el.chapter.value,
    el.date.value, getRadio('priority'),
  ]);
}

const isDirty = () => dlg.open && serialize() !== snapshot;

const ERROR_FOR = { 'tf-title': 'tf-title-error', 'tf-date': 'tf-date-error', 'tf-subject-new': 'tf-subject-error' };

function showError(input, message) {
  const err = document.getElementById(ERROR_FOR[input.id]);
  if (err) { err.textContent = message; err.hidden = false; }
  input.setAttribute('aria-invalid', 'true');
}

function clearError(input) {
  if (!input || !ERROR_FOR[input.id]) return;
  const err = document.getElementById(ERROR_FOR[input.id]);
  if (err) err.hidden = true;
  input.removeAttribute('aria-invalid');
}

function clearAllErrors() {
  Object.keys(ERROR_FOR).forEach((id) => clearError(document.getElementById(id)));
}

/* ---------- Save / close ---------- */

function onSubmit(e) {
  e.preventDefault();
  if (saving) return;
  clearAllErrors();

  const invalid = [];
  const title = el.title.value.trim();
  if (!title) { showError(el.title, 'Enter a task title.'); invalid.push(el.title); }

  if (!isValidDateKey(el.date.value)) { showError(el.date, 'Choose a valid due date.'); invalid.push(el.date); }

  let subject = el.subject.value;
  if (subject === NEW_SUBJECT) {
    const name = el.subjectNew.value.trim();
    if (!name) { showError(el.subjectNew, 'Enter a name for the new subject.'); invalid.push(el.subjectNew); }
    subject = name;
  }

  if (invalid.length) {
    invalid[0].focus();
    return;
  }

  saving = true;
  if (el.subject.value === NEW_SUBJECT) subject = addCustomSubject(subject);

  const data = {
    title,
    description: el.desc.value,
    subject,
    chapter: el.chapter.value,
    dueDate: el.date.value,
    priority: getRadio('priority') || 'medium',
  };

  const wasEditing = !!editingId;
  const result = wasEditing ? updateTask(editingId, data) : addTask(data);
  saving = false;
  if (!result) {
    toast('This task could not be saved. Please check the details and try again.', { type: 'error' });
    return;
  }
  closeModal();
  toast(wasEditing ? 'Task updated.' : 'Task added.', { type: 'success', duration: 2500 });
}

async function attemptClose() {
  if (!isDirty()) { closeModal(); return; }
  const result = await confirmDialog({
    title: 'Discard changes?',
    message: 'You have unsaved changes in this task. They will be lost if you close it.',
    confirmLabel: 'Discard',
    cancelLabel: 'Keep editing',
    danger: true,
  });
  if (result === 'confirm') closeModal();
  else el.title.focus();
}

function closeModal() {
  if (dlg.open) dlg.close();
  editingId = null;
}

/* ---------- Delete ---------- */

export async function requestDeleteTask(id) {
  const task = getTask(id);
  if (!task) return false;

  if (state.settings.confirmDelete) {
    const result = await confirmDialog({
      title: 'Delete this task?',
      message: `"${task.title}" will be permanently removed from your planner. This cannot be undone.`,
      confirmLabel: 'Delete task',
      danger: true,
    });
    if (result !== 'confirm') return false;
    deleteTask(id);
    toast('Task deleted.', { duration: 2500 });
  } else {
    const snap = deleteTask(id);
    toast('Task deleted.', { action: { label: 'Undo', onClick: () => restoreTask(snap) }, duration: 6000 });
  }
  return true;
}

/* ---------- Global task actions (attached once) ---------- */

export function initTaskActions() {
  document.addEventListener('change', (e) => {
    const box = e.target.closest?.('[data-task-action="toggle"]');
    if (!box) return;
    const task = setTaskCompleted(box.dataset.id, box.checked);
    if (task) announce(task.completed ? `Completed: ${task.title}` : `Marked as not done: ${task.title}`);
  });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-task-action]');
    if (!btn || btn.dataset.taskAction === 'toggle') return;
    const task = getTask(btn.dataset.id);
    if (!task) return;
    if (btn.dataset.taskAction === 'edit') openTaskModal({ task, trigger: btn });
    if (btn.dataset.taskAction === 'delete') requestDeleteTask(task.id);
  });
}
