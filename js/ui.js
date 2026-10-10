/**
 * ui.js
 * Shared UI pieces: toasts, confirm dialog, screen-reader announcements,
 * document title, and HTML builders reused by every page (task rows,
 * empty states, progress bars, subject and priority labels).
 */

import { icon } from './icons.js';
import { esc, relativeDayLabel, todayKey } from './utils.js';
import { taskStatus, subjectColor, PRIORITY_LABEL } from './stats.js';

/* ---------- Document title ---------- */

const APP_TITLE = 'Bhairavi Academy Study Planner';
export function setPageTitle(page) { document.title = page ? `${page} · ${APP_TITLE}` : APP_TITLE; }

/* ---------- Announcements & toasts ---------- */

export function announce(message) {
  const el = document.getElementById('sr-live');
  if (!el) return;
  el.textContent = '';
  window.setTimeout(() => { el.textContent = message; }, 30);
}

export function toast(message, { type = 'info', action = null, duration = 4000 } = {}) {
  const region = document.getElementById('toasts');
  if (!region) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  const iconName = type === 'error' ? 'alert-triangle' : type === 'success' ? 'circle-check' : 'info';
  el.innerHTML = `${icon(iconName, { size: 16, cls: 'toast-icon' })}<p class="toast-text">${esc(message)}</p>`;

  let timer = null;
  const dismiss = () => {
    window.clearTimeout(timer);
    el.classList.add('is-leaving');
    window.setTimeout(() => el.remove(), 180);
  };

  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.addEventListener('click', () => { action.onClick(); dismiss(); });
    el.appendChild(btn);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'Dismiss notification');
  close.innerHTML = icon('x', { size: 14 });
  close.addEventListener('click', dismiss);
  el.appendChild(close);

  region.appendChild(el);
  while (region.children.length > 3) region.firstElementChild.remove();
  if (duration > 0) {
    timer = window.setTimeout(dismiss, duration);
    el.addEventListener('mouseenter', () => window.clearTimeout(timer));
    el.addEventListener('mouseleave', () => { timer = window.setTimeout(dismiss, 2000); });
  }
}

/* ---------- Downloads ---------- */

/** Save a Blob as a file through a temporary link. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- Dialog helpers ---------- */

/** Keep page scroll locked while any dialog is open. */
export function syncScrollLock() {
  document.documentElement.classList.toggle('modal-open', !!document.querySelector('dialog[open]'));
}

const confirmEls = {};
let confirmResolve = null;
let confirmReturnFocus = null;
let confirmRequire = '';

export function initConfirm() {
  const ids = ['dialog', 'form', 'icon', 'title', 'message', 'require', 'require-label', 'input', 'error', 'cancel', 'secondary', 'ok'];
  ids.forEach((k) => { confirmEls[k] = document.getElementById(k === 'dialog' ? 'confirm-dialog' : `confirm-${k}`); });
  const { dialog, form, cancel, secondary, input, error } = confirmEls;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (confirmRequire && input.value.trim() !== confirmRequire) {
      error.textContent = `Type ${confirmRequire} exactly to continue.`;
      error.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    finishConfirm('confirm');
  });
  cancel.addEventListener('click', () => finishConfirm(false));
  secondary.addEventListener('click', () => finishConfirm('secondary'));
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); finishConfirm(false); });
  input.addEventListener('input', () => { error.hidden = true; input.removeAttribute('aria-invalid'); });
}

function finishConfirm(result) {
  const resolve = confirmResolve;
  confirmResolve = null;
  if (confirmEls.dialog.open) confirmEls.dialog.close();
  syncScrollLock();
  if (confirmReturnFocus && confirmReturnFocus.isConnected) confirmReturnFocus.focus({ preventScroll: true });
  confirmReturnFocus = null;
  if (resolve) resolve(result);
}

/**
 * Promise-based confirm. Resolves to 'confirm', 'secondary' or false.
 * `requireText` asks the user to type a word before confirming (for destructive actions).
 */
export function confirmDialog({
  title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', secondaryLabel = '', danger = false, requireText = '',
}) {
  if (confirmResolve) finishConfirm(false);
  const e = confirmEls;
  return new Promise((resolve) => {
    confirmResolve = resolve;
    confirmReturnFocus = document.activeElement;
    confirmRequire = requireText;
    e.title.textContent = title;
    e.message.textContent = message;
    e.icon.innerHTML = icon(danger ? 'alert-triangle' : 'info', { size: 20 });
    e.icon.className = `confirm-icon ${danger ? 'is-danger' : ''}`;
    e.ok.textContent = confirmLabel;
    e.ok.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
    e.cancel.textContent = cancelLabel;
    e.secondary.hidden = !secondaryLabel;
    e.secondary.textContent = secondaryLabel;
    e.require.hidden = !requireText;
    e.input.value = '';
    e.error.hidden = true;
    e.input.removeAttribute('aria-invalid');
    if (requireText) e['require-label'].textContent = `Type ${requireText} to confirm`;
    e.dialog.showModal();
    syncScrollLock();
    (requireText ? e.input : danger ? e.cancel : e.ok).focus();
  });
}

/* ---------- HTML builders ---------- */

export function progressBar(pct, label, { size = '' } = {}) {
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  return `<div class="progress ${size ? `progress-${size}` : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${v}" aria-label="${esc(label)}"><span class="progress-fill" style="width:${v}%"></span></div>`;
}

export function subjectChip(subject) {
  return `<span class="meta meta-subject"><i class="sdot" style="--c:${subjectColor(subject)}" aria-hidden="true"></i>${esc(subject || 'No subject')}</span>`;
}

export function priorityBadge(priority) {
  return `<span class="meta priority priority-${priority}">${icon('flag', { size: 13 })}${PRIORITY_LABEL[priority]}<span class="sr-only"> priority</span></span>`;
}

const STATUS_LABEL = { completed: 'Completed', overdue: 'Overdue', pending: 'Pending' };

/**
 * Task row used on every page.
 * opts: { today, showDate = true, compact = false, hideSubject = false, hideChapter = false }
 */
export function renderTaskItem(t, opts = {}) {
  const today = opts.today || todayKey();
  const status = taskStatus(t, today);
  const meta = [];
  if (!opts.hideSubject) meta.push(subjectChip(t.subject));
  if (t.chapter && !opts.hideChapter) meta.push(`<span class="meta">${icon('bookmark', { size: 13 })}${esc(t.chapter)}</span>`);
  if (opts.showDate !== false) {
    meta.push(`<span class="meta ${status === 'overdue' ? 'is-danger' : ''}">${icon('calendar', { size: 13 })}${esc(relativeDayLabel(t.dueDate, today))}</span>`);
  }
  meta.push(priorityBadge(t.priority));
  // Pending is the default state (the empty checkbox shows it), so only Completed / Overdue get a label.
  if (status !== 'pending') meta.push(`<span class="status status-${status}">${STATUS_LABEL[status]}</span>`);

  const title = esc(t.title);
  return `<li class="task is-${status}" data-task-id="${esc(t.id)}">
    <label class="check">
      <input type="checkbox" class="check-input" data-task-action="toggle" data-id="${esc(t.id)}" data-fk="toggle-${esc(t.id)}" ${t.completed ? 'checked' : ''} aria-label="${t.completed ? 'Mark as not done' : 'Mark as done'}: ${title}">
      <span class="check-box" aria-hidden="true">${icon('check', { size: 13 })}</span>
    </label>
    <div class="task-body">
      <p class="task-title">${title}</p>
      ${t.description && !opts.compact ? `<p class="task-desc">${esc(t.description)}</p>` : ''}
      <div class="task-meta">${meta.join('')}</div>
    </div>
    <div class="task-actions">
      <button type="button" class="icon-btn icon-btn-sm" data-task-action="edit" data-id="${esc(t.id)}" data-fk="edit-${esc(t.id)}" aria-label="Edit task: ${title}">${icon('pencil', { size: 15 })}</button>
      <button type="button" class="icon-btn icon-btn-sm icon-btn-danger" data-task-action="delete" data-id="${esc(t.id)}" aria-label="Delete task: ${title}">${icon('trash', { size: 15 })}</button>
    </div>
  </li>`;
}

export function emptyState({ iconName = 'inbox', title, text = '', action = '', compact = false }) {
  return `<div class="empty ${compact ? 'empty-compact' : ''}">
    <span class="empty-icon">${icon(iconName, { size: compact ? 18 : 22 })}</span>
    <p class="empty-title">${esc(title)}</p>
    ${text ? `<p class="empty-text">${esc(text)}</p>` : ''}
    ${action ? `<div class="empty-actions">${action}</div>` : ''}
  </div>`;
}

export function statCard({ label, value, unit = '', sub = '', iconName, extra = '' }) {
  return `<article class="stat">
    <div class="stat-head"><p class="stat-label">${esc(label)}</p><span class="stat-icon">${icon(iconName, { size: 16 })}</span></div>
    <p class="stat-value">${value}${unit ? `<span class="stat-unit">${esc(unit)}</span>` : ''}</p>
    ${sub ? `<p class="stat-sub">${sub}</p>` : ''}
    ${extra}
  </article>`;
}

export const addButton = (label = 'Add Task', attrs = 'data-action="add"', cls = 'btn btn-primary') =>
  `<button type="button" class="${cls}" ${attrs}>${icon('plus', { size: 16 })}<span>${esc(label)}</span></button>`;
