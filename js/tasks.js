/**
 * tasks.js
 * My Tasks page: search, view tabs, filters and sorting. All of these only
 * change what is displayed, never the stored tasks.
 */

import { state } from './state.js';
import { todayKey, plural, esc, isValidDateKey } from './utils.js';
import { isOverdue, compareByDue, PRIORITY_RANK, overviewSubjects } from './stats.js';
import { renderTaskItem, emptyState, addButton } from './ui.js';
import { icon } from './icons.js';
import { openTaskModal } from './modal.js';
import { exportTasksToExcel } from './excel.js';

const VIEWS = [
  { id: 'all', label: 'All Tasks' },
  { id: 'today', label: 'Today' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'completed', label: 'Completed' },
];

const DEFAULT_FILTERS = { view: 'all', q: '', subject: '', priority: '', status: '', date: '', sort: 'due' };
// Module-level so filters survive switching pages during a session.
const f = { ...DEFAULT_FILTERS };

function inView(t, view, today) {
  switch (view) {
    case 'today': return t.dueDate === today;
    case 'upcoming': return !t.completed && t.dueDate > today;
    case 'overdue': return isOverdue(t, today);
    case 'completed': return t.completed;
    default: return true;
  }
}

const SORTERS = {
  due: compareByDue,
  priority: (a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || compareByDue(a, b),
  created: (a, b) => b.createdAt.localeCompare(a.createdAt),
  title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
};

function applyFilters(tasks, today) {
  const words = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return tasks.filter((t) => {
    if (!inView(t, f.view, today)) return false;
    if (f.subject === '__none__' ? t.subject : f.subject && t.subject !== f.subject) return false;
    if (f.priority && t.priority !== f.priority) return false;
    if (f.status === 'pending' && t.completed) return false;
    if (f.status === 'completed' && !t.completed) return false;
    if (f.date && t.dueDate !== f.date) return false;
    if (words.length) {
      const hay = `${t.title} ${t.description} ${t.subject} ${t.chapter}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  }).sort(SORTERS[f.sort] || compareByDue);
}

const filtersActive = () => f.q || f.subject || f.priority || f.status || f.date;

export function mountTasks(root, { query }) {
  const qv = query.get('view');
  if (VIEWS.some((v) => v.id === qv)) f.view = qv;
  if (query.has('q')) f.q = query.get('q');

  root.innerHTML = `
  <div class="page page-tasks">
    <header class="page-head">
      <div>
        <h1 class="page-title">My Tasks</h1>
        <p class="page-sub" id="tasks-count"></p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-secondary" data-action="excel">${icon('file-spreadsheet', { size: 16 })}<span>Export to Excel</span></button>
        ${addButton('Add Task')}
      </div>
    </header>

    <section class="card toolbar-card" aria-label="Search and filters">
      <div class="search-field">
        ${icon('search', { size: 16 })}
        <label class="sr-only" for="task-search">Search tasks</label>
        <input id="task-search" class="input" type="search" placeholder="Search titles, descriptions, subjects or chapters" autocomplete="off" spellcheck="false">
      </div>

      <div class="tabs" role="group" aria-label="Task views" id="task-tabs"></div>

      <div class="filter-row">
        <div class="filter">
          <label class="filter-label" for="flt-subject">Subject</label>
          <select id="flt-subject" class="input select select-sm" data-filter="subject"></select>
        </div>
        <div class="filter">
          <label class="filter-label" for="flt-priority">Priority</label>
          <select id="flt-priority" class="input select select-sm" data-filter="priority">
            <option value="">Any</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
          </select>
        </div>
        <div class="filter">
          <label class="filter-label" for="flt-status">Status</label>
          <select id="flt-status" class="input select select-sm" data-filter="status">
            <option value="">Any</option><option value="pending">Pending</option><option value="completed">Completed</option>
          </select>
        </div>
        <div class="filter">
          <label class="filter-label" for="flt-date">Due date</label>
          <input id="flt-date" class="input select-sm" type="date" data-filter="date">
        </div>
        <div class="filter">
          <label class="filter-label" for="flt-sort">Sort by</label>
          <select id="flt-sort" class="input select select-sm" data-filter="sort">
            <option value="due">Due date</option><option value="priority">Priority</option>
            <option value="created">Recently created</option><option value="title">Title (A–Z)</option>
          </select>
        </div>
        <button type="button" class="btn btn-ghost btn-sm filter-clear" data-action="clear" hidden>${icon('x', { size: 14 })}Clear filters</button>
      </div>
    </section>

    <section class="card list-card" aria-labelledby="results-title">
      <div class="results-head">
        <h2 class="card-title" id="results-title"></h2>
        <p class="card-sub" id="results-count" aria-live="polite"></p>
      </div>
      <div id="task-results"></div>
    </section>
  </div>`;

  const $ = (sel) => root.querySelector(sel);
  const search = $('#task-search');
  search.value = f.q;
  root.querySelectorAll('[data-filter]').forEach((el) => { el.value = f[el.dataset.filter]; });

  search.addEventListener('input', () => { f.q = search.value; renderResults(); });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && search.value) { e.preventDefault(); search.value = ''; f.q = ''; renderResults(); }
  });

  root.addEventListener('change', (e) => {
    const key = e.target.dataset.filter;
    if (!key) return;
    f[key] = key === 'date' && !isValidDateKey(e.target.value) ? '' : e.target.value;
    renderResults();
  });

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'excel') exportTasksToExcel();
    if (btn.dataset.action === 'add') openTaskModal({ trigger: btn, ...(f.date ? { date: f.date } : {}) });
    if (btn.dataset.action === 'view') { f.view = btn.dataset.view; renderResults(); }
    if (btn.dataset.action === 'clear') {
      Object.assign(f, { ...DEFAULT_FILTERS, view: f.view, sort: f.sort });
      search.value = '';
      root.querySelectorAll('[data-filter]').forEach((el) => { el.value = f[el.dataset.filter]; });
      renderResults();
      search.focus();
    }
  });

  function fillSubjectFilter() {
    const sel = $('#flt-subject');
    const subjects = overviewSubjects(state.settings, state.tasks);
    const hasNone = state.tasks.some((t) => !t.subject);
    const html = `<option value="">All subjects</option>${subjects.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}${hasNone ? '<option value="__none__">No subject</option>' : ''}`;
    if (sel.dataset.html !== html) {
      sel.innerHTML = html;
      sel.dataset.html = html;
    }
    if (f.subject && ![...sel.options].some((o) => o.value === f.subject)) f.subject = '';
    sel.value = f.subject;
  }

  function renderResults() {
    const today = todayKey();
    const total = state.tasks.length;
    const pending = state.tasks.filter((t) => !t.completed).length;
    $('#tasks-count').textContent = total ? `${plural(total, 'task')} · ${pending} pending` : 'No tasks yet';

    $('#task-tabs').innerHTML = VIEWS.map((v) => {
      const n = state.tasks.filter((t) => inView(t, v.id, today)).length;
      return `<button type="button" class="tab${v.id === f.view ? ' is-active' : ''}${v.id === 'overdue' && n ? ' has-alert' : ''}" data-action="view" data-view="${v.id}" data-fk="tab-${v.id}" aria-pressed="${v.id === f.view}">${v.label}<span class="tab-count">${n}</span></button>`;
    }).join('');

    const list = applyFilters(state.tasks, today);
    const viewLabel = VIEWS.find((v) => v.id === f.view).label;
    $('#results-title').textContent = viewLabel;
    $('#results-count').textContent = `Showing ${plural(list.length, 'task')}`;
    root.querySelector('.filter-clear').hidden = !filtersActive();

    let body;
    if (!total) {
      body = emptyState({
        iconName: 'list-checks',
        title: 'No tasks yet',
        text: 'Create your first study task to start planning.',
        action: addButton('Add Task'),
      });
    } else if (!list.length) {
      const reason = f.q ? `No tasks match "${f.q.trim()}"` : 'No tasks match these filters';
      body = emptyState({
        iconName: 'search-x',
        title: f.view !== 'all' && !filtersActive() ? `No ${viewLabel.toLowerCase()} tasks` : reason,
        text: filtersActive() ? 'Try a different search term or clear the filters.' : 'Tasks will appear here when they match this view.',
        action: filtersActive() ? '<button type="button" class="btn btn-secondary" data-action="clear">Clear filters</button>' : '',
      });
    } else {
      body = `<ul class="task-list">${list.map((t) => renderTaskItem(t, { today })).join('')}</ul>`;
    }
    $('#task-results').innerHTML = body;
  }

  function update() {
    fillSubjectFilter();
    renderResults();
  }

  update();
  if (query.get('focus') === 'search') window.requestAnimationFrame(() => search.focus());

  return {
    update,
    focusSearch() { search.focus(); search.select(); },
    addDefaults: () => (f.date ? { date: f.date } : {}),
  };
}
