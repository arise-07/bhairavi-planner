/**
 * subjects.js
 * Subjects overview (track selection + subject cards) and the subject
 * detail view (#/subjects/<name>) with chapters, deadlines and completed tasks.
 */

import { state, updateSettings } from './state.js';
import { todayKey, esc, plural, formatShortDate } from './utils.js';
import {
  overviewSubjects, subjectStats, subjectColor, summarize, sortForDay, compareByDue, UNASSIGNED_ROUTE, TRACK_SUBJECTS, trackSubjects,
} from './stats.js';
import { renderTaskItem, emptyState, progressBar, addButton, toast } from './ui.js';
import { icon } from './icons.js';
import { openTaskModal } from './modal.js';

export function mountSubjects(root, { segs }) {
  if (segs[0]) return mountDetail(root, segs[0]);
  return mountOverview(root);
}

/* ---------- Overview ---------- */

function courseHelp(settings) {
  const core = trackSubjects(settings);
  const list = core.length ? core.join(', ') : 'No core subjects';
  return settings.examTrack === 'Custom'
    ? `${list}, plus your own subjects. Change them in Settings.`
    : `${list}, plus Revision and Personal.`;
}

function mountOverview(root) {
  root.innerHTML = `
  <div class="page page-subjects">
    <header class="page-head">
      <div>
        <h1 class="page-title">Subjects</h1>
        <p class="page-sub">Progress for each subject, calculated from your tasks.</p>
      </div>
      <div class="page-actions">${addButton('Add Task')}</div>
    </header>

    <section class="card track-card" aria-labelledby="track-title">
      <div>
        <h2 class="card-title" id="track-title">Course</h2>
        <p class="card-sub" id="track-help"></p>
      </div>
      <div class="segmented" role="group" aria-label="Course" id="track-switch">
        ${Object.keys(TRACK_SUBJECTS).map((k) => `<button type="button" class="seg-btn" data-action="track" data-track="${k}" data-fk="track-${k}">${k}</button>`).join('')}
      </div>
    </section>

    <div class="subject-grid" id="subject-grid"></div>
    <p class="page-note">Add your own subjects from <a href="#/settings">Settings</a> or with "Add new subject" in the task form.</p>
  </div>`;

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'track' && btn.dataset.track !== state.settings.examTrack) {
      updateSettings({ examTrack: btn.dataset.track });
      toast(`Course set to ${btn.dataset.track}.`, { duration: 2500 });
    }
    if (btn.dataset.action === 'add') {
      openTaskModal({ trigger: btn, ...(btn.dataset.subject !== undefined ? { subject: btn.dataset.subject } : {}) });
    }
  });

  function update() {
    const today = todayKey();
    const track = state.settings.examTrack;
    root.querySelector('#track-help').textContent = courseHelp(state.settings);
    root.querySelectorAll('[data-action="track"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.track === track)));

    const subjects = overviewSubjects(state.settings, state.tasks);
    const cards = subjects.map((name) => subjectCard(name, subjectStats(state.tasks, name, today), name));
    const unassigned = state.tasks.filter((t) => !t.subject);
    if (unassigned.length) {
      const s = summarize(unassigned, today);
      cards.push(subjectCard('No subject', { ...s, upcoming: unassigned.filter((t) => !t.completed && t.dueDate >= today).length }, ''));
    }
    root.querySelector('#subject-grid').innerHTML = cards.join('');
  }

  update();
  return { update };
}

function subjectCard(label, s, subject) {
  const href = `#/subjects/${encodeURIComponent(subject || UNASSIGNED_ROUTE)}`;
  return `<article class="card subject-card" style="--c:${subjectColor(subject)}">
    <div class="subject-card-head">
      <span class="subject-swatch" aria-hidden="true"></span>
      <h2 class="subject-name"><a class="stretched-link" href="${href}">${esc(label)}</a></h2>
      <button type="button" class="icon-btn icon-btn-sm subject-add" data-action="add" data-subject="${esc(subject)}" aria-label="Add a ${esc(label)} task">${icon('plus', { size: 16 })}</button>
    </div>
    <div class="subject-pct"><span class="pct-value">${s.pct}%</span><span class="pct-label">complete</span></div>
    ${progressBar(s.pct, `${label} completion ${s.pct}%`)}
    <dl class="mini-stats">
      <div><dt>Total</dt><dd>${s.total}</dd></div>
      <div><dt>Completed</dt><dd>${s.completed}</dd></div>
      <div><dt>Pending</dt><dd>${s.pending}</dd></div>
    </dl>
    <p class="subject-foot">${icon('calendar', { size: 14 })}${plural(s.upcoming, 'upcoming task')}${s.overdue ? ` · <span class="text-danger">${s.overdue} overdue</span>` : ''}</p>
  </article>`;
}

/* ---------- Detail ---------- */

function mountDetail(root, param) {
  const subject = param === UNASSIGNED_ROUTE ? '' : param;
  const label = subject || 'No subject';
  let filter = 'all';

  root.innerHTML = `
  <div class="page page-subject-detail" style="--c:${subjectColor(subject)}">
    <a class="back-link" href="#/subjects">${icon('arrow-left', { size: 16 })}All subjects</a>
    <header class="page-head">
      <div class="subject-title-wrap">
        <span class="subject-swatch subject-swatch-lg" aria-hidden="true"></span>
        <div>
          <h1 class="page-title">${esc(label)}</h1>
          <p class="page-sub" id="sd-sub"></p>
        </div>
      </div>
      <div class="page-actions">${addButton(`Add ${label === 'No subject' ? '' : `${label} `}Task`.replace('  ', ' '), `data-action="add"`)}</div>
    </header>

    <section class="stat-grid stat-grid-4" id="sd-stats" aria-label="Subject summary"></section>

    <div class="detail-grid">
      <section class="card" aria-labelledby="sd-chapters-title">
        <div class="card-head">
          <h2 class="card-title" id="sd-chapters-title">Tasks by chapter</h2>
          <div class="segmented segmented-sm" role="group" aria-label="Filter tasks">
            <button type="button" class="seg-btn" data-action="filter" data-filter="all">All</button>
            <button type="button" class="seg-btn" data-action="filter" data-filter="pending">Pending</button>
            <button type="button" class="seg-btn" data-action="filter" data-filter="completed">Completed</button>
          </div>
        </div>
        <div id="sd-chapters"></div>
      </section>

      <div class="dash-col">
        <section class="card" aria-labelledby="sd-upcoming-title">
          <div class="card-head"><h2 class="card-title" id="sd-upcoming-title">Upcoming deadlines</h2></div>
          <div id="sd-upcoming"></div>
        </section>
        <section class="card" aria-labelledby="sd-done-title">
          <div class="card-head"><h2 class="card-title" id="sd-done-title">Recently completed</h2></div>
          <div id="sd-done"></div>
        </section>
      </div>
    </div>
  </div>`;

  const $ = (sel) => root.querySelector(sel);

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'add') openTaskModal({ subject, trigger: btn });
    if (btn.dataset.action === 'filter') { filter = btn.dataset.filter; update(); }
  });

  function update() {
    const today = todayKey();
    const list = state.tasks.filter((t) => t.subject === subject);
    const s = summarize(list, today);
    const upcoming = list.filter((t) => !t.completed).sort(compareByDue);

    $('#sd-sub').textContent = list.length ? `${plural(s.total, 'task')} · ${s.pct}% complete` : 'No tasks in this subject yet';
    $('#sd-stats').innerHTML = `
      <article class="stat"><p class="stat-label">Total</p><p class="stat-value">${s.total}</p></article>
      <article class="stat"><p class="stat-label">Completed</p><p class="stat-value">${s.completed}</p></article>
      <article class="stat"><p class="stat-label">Pending</p><p class="stat-value">${s.pending}</p></article>
      <article class="stat"><p class="stat-label">Completion</p><p class="stat-value">${s.pct}<span class="stat-unit">%</span></p>${progressBar(s.pct, `${label} completion ${s.pct}%`, { size: 'thin' })}</article>`;

    root.querySelectorAll('[data-action="filter"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === filter)));

    const shown = list.filter((t) => (filter === 'pending' ? !t.completed : filter === 'completed' ? t.completed : true));
    if (!list.length) {
      $('#sd-chapters').innerHTML = emptyState({
        iconName: 'book-open',
        title: `No ${label === 'No subject' ? 'unassigned' : label} tasks yet`,
        text: 'Add a task and give it a chapter to see it grouped here.',
        action: addButton('Add Task', 'data-action="add"', 'btn btn-secondary'),
      });
    } else if (!shown.length) {
      $('#sd-chapters').innerHTML = emptyState({ iconName: 'list-checks', title: `No ${filter} tasks`, compact: true });
    } else {
      const groups = new Map();
      shown.forEach((t) => {
        const k = t.chapter || '';
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(t);
      });
      const keys = [...groups.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
      $('#sd-chapters').innerHTML = keys.map((k) => {
        const items = sortForDay(groups.get(k));
        const all = list.filter((t) => (t.chapter || '') === k);
        const done = all.filter((t) => t.completed).length;
        return `<section class="chapter">
          <h3 class="chapter-title"><span>${esc(k || 'No chapter')}</span><span class="chapter-count">${done}/${all.length} done</span></h3>
          <ul class="task-list">${items.map((t) => renderTaskItem(t, { today, hideSubject: true, hideChapter: true })).join('')}</ul>
        </section>`;
      }).join('');
    }

    $('#sd-upcoming').innerHTML = upcoming.length
      ? `<ul class="task-list task-list-tight">${upcoming.slice(0, 5).map((t) => renderTaskItem(t, { today, compact: true, hideSubject: true })).join('')}</ul>`
      : emptyState({ iconName: 'calendar', title: 'No pending deadlines', compact: true });

    const done = list.filter((t) => t.completed).sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
    $('#sd-done').innerHTML = done.length
      ? `<ul class="recent-list">${done.slice(0, 5).map((t) => `<li class="recent"><span class="recent-icon">${icon('check', { size: 13 })}</span><span class="recent-body"><span class="recent-title">${esc(t.title)}</span><span class="recent-meta">${t.chapter ? `${esc(t.chapter)} · ` : ''}Due ${formatShortDate(t.dueDate)}</span></span></li>`).join('')}</ul>`
      : emptyState({ iconName: 'circle-check', title: 'Nothing completed yet', compact: true });
  }

  update();
  return {
    update,
    addDefaults: () => ({ subject }),
  };
}
