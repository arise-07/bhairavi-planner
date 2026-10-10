/**
 * dashboard.js
 * Landing page: greeting, live summary cards, today's plan, priorities,
 * deadlines, recent completions and a compact calendar.
 */

import { state } from './state.js';
import {
  todayKey, greetingFor, formatLongDate, addDays, diffDays, parseDateKey, plural,
  formatMoment, esc, MONTHS_SHORT,
} from './utils.js';
import {
  summarize, sortForDay, compareByDue, isOverdue, completedOnDay, streaks,
  recentCompletions, subjectColor, courseSubjects, subjectStats,
} from './stats.js';
import { renderTaskItem, emptyState, progressBar, statCard, addButton } from './ui.js';
import { icon } from './icons.js';
import { openTaskModal } from './modal.js';
import { navigate } from './navigation.js';
import { renderMiniCalendar } from './calendar.js';

const MESSAGES = [
  'Small, steady sessions add up to strong results.',
  'Finish one task completely before starting the next.',
  'Revise today what you learned yesterday.',
  'Consistency beats intensity. Show up again today.',
  'Start with the hardest task while your focus is fresh.',
  'Every problem you solve now is practice for the exam hall.',
  'Plan the day, then trust the plan.',
  'Progress is built one chapter at a time.',
  'Short breaks keep long study days productive.',
  'Mark what you finish. Visible progress keeps you going.',
  'Strong basics make difficult questions easier.',
  'Today\'s effort becomes tomorrow\'s confidence.',
  'Review your mistakes. They show you what to study next.',
  'One focused hour is worth more than three distracted ones.',
];

function dailyMessage(key) {
  const d = parseDateKey(key);
  const dayOfYear = Math.round((d - new Date(d.getFullYear(), 0, 1)) / 86400000);
  return MESSAGES[(dayOfYear + d.getFullYear()) % MESSAGES.length];
}

export function mountDashboard(root) {
  const now = new Date();
  let mini = { y: now.getFullYear(), m: now.getMonth() };

  root.innerHTML = `
  <div class="page page-dashboard">
    <header class="page-head dash-head">
      <div>
        <p class="eyebrow" id="dash-date"></p>
        <h1 class="page-title page-title-lg" id="dash-greeting"></h1>
        <p class="page-sub" id="dash-message"></p>
      </div>
      <div class="page-actions">${addButton('Add Task')}</div>
    </header>

    <section class="stat-grid" id="dash-stats" aria-label="Summary"></section>

    <section class="card" id="dash-subjects" aria-labelledby="dash-subjects-title"></section>

    <div class="dash-grid">
      <div class="dash-col">
        <section class="card" id="dash-today" aria-labelledby="dash-today-title"></section>
        <section class="card" id="dash-priority" aria-labelledby="dash-priority-title"></section>
      </div>
      <div class="dash-col dash-side">
        <section class="card" id="dash-cal" aria-labelledby="dash-cal-title"></section>
        <section class="card" id="dash-upcoming" aria-labelledby="dash-upcoming-title"></section>
        <section class="card" id="dash-recent" aria-labelledby="dash-recent-title"></section>
      </div>
    </div>
  </div>`;

  const $ = (sel) => root.querySelector(sel);

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'add') openTaskModal({ date: btn.dataset.date || todayKey(), trigger: btn });
    if (action === 'mini-prev' || action === 'mini-next') {
      const d = new Date(mini.y, mini.m + (action === 'mini-prev' ? -1 : 1), 1);
      mini = { y: d.getFullYear(), m: d.getMonth() };
      renderCalendarCard(todayKey());
      root.querySelector(`[data-action="${action}"]`)?.focus();
    }
    if (action === 'mini-date') navigate(`calendar?date=${btn.dataset.date}`);
  });

  function renderCalendarCard(today) {
    $('#dash-cal').innerHTML = `
      <div class="card-head">
        <h2 class="card-title" id="dash-cal-title">Calendar</h2>
        <a class="link-btn" href="#/calendar">Open calendar ${icon('arrow-right', { size: 14 })}</a>
      </div>
      ${renderMiniCalendar({ year: mini.y, month: mini.m, today, tasks: state.tasks, weekStartsOn: state.settings.weekStartsOn })}`;
  }

  function update() {
    const today = todayKey();
    const name = state.profile?.name || '';
    $('#dash-date').textContent = formatLongDate(today);
    $('#dash-greeting').textContent = `${greetingFor()}, ${name}.`;
    $('#dash-message').textContent = dailyMessage(today);

    renderStats(today);
    renderSubjects(today);
    renderToday(today);
    renderPriority(today);
    renderUpcoming(today);
    renderCalendarCard(today);
    renderRecent(today);
  }

  function renderStats(today) {
    const todays = state.tasks.filter((t) => t.dueDate === today);
    const s = summarize(todays, today);
    const doneToday = completedOnDay(state.history, today);
    const totalDone = state.tasks.filter((t) => t.completed).length;
    const overdue = state.tasks.filter((t) => isOverdue(t, today)).length;
    const streak = streaks(state.history, today);

    $('#dash-stats').innerHTML = [
      statCard({
        label: "Today's Tasks", value: s.total, iconName: 'list-checks',
        sub: s.total ? `${s.pending} pending · ${s.completed} done` : 'Nothing scheduled yet',
      }),
      statCard({
        label: 'Completed Tasks', value: totalDone, iconName: 'circle-check',
        sub: `${doneToday} completed today`,
      }),
      statCard({
        label: 'Overdue Tasks', value: `<span class="${overdue ? 'text-danger' : ''}">${overdue}</span>`, iconName: 'alert-triangle',
        sub: overdue ? '<a class="stat-link" href="#/tasks?view=overdue">Past due date, not done</a>' : 'Nothing overdue',
      }),
      statCard({
        label: 'Current Study Streak', value: streak.current, unit: streak.current === 1 ? 'day' : 'days', iconName: 'flame',
        sub: streak.best ? `Best streak: ${plural(streak.best, 'day')}` : 'Complete a task to start one',
      }),
    ].join('');
  }

  function renderSubjects(today) {
    const course = state.settings.examTrack;
    const subjects = courseSubjects(state.settings);
    const tiles = subjects.map((name) => {
      const s = subjectStats(state.tasks, name, today);
      const meta = s.total
        ? `${s.completed} of ${s.total} done${s.overdue ? ` · <span class="text-danger">${s.overdue} overdue</span>` : ''}`
        : 'No tasks yet';
      return `<a class="subj-tile" href="#/subjects/${encodeURIComponent(name)}" style="--c:${subjectColor(name)}" aria-label="${esc(name)}: ${s.pct}% complete, ${s.completed} of ${s.total} tasks done${s.overdue ? `, ${s.overdue} overdue` : ''}">
        <span class="subj-tile-head"><span class="subj-tile-name"><i class="sdot" aria-hidden="true"></i>${esc(name)}</span><span class="subj-tile-pct">${s.pct}%</span></span>
        <span class="subj-tile-bar" aria-hidden="true"><span style="width:${s.pct}%"></span></span>
        <span class="subj-tile-meta">${meta}</span>
      </a>`;
    });
    $('#dash-subjects').innerHTML = `
      <div class="card-head">
        <div>
          <h2 class="card-title" id="dash-subjects-title">My Subjects <span class="course-badge">${esc(course)}</span></h2>
          <p class="card-sub">${course === 'Custom' ? 'Your custom course' : `${course} course`}</p>
        </div>
        <a class="link-btn" href="#/subjects">All subjects ${icon('arrow-right', { size: 14 })}</a>
      </div>
      ${tiles.length
        ? `<div class="subj-grid">${tiles.join('')}</div>`
        : emptyState({ iconName: 'book-open', title: 'No subjects in your course', text: 'Choose your subjects in Settings.', action: '<a class="btn btn-secondary" href="#/settings">Open Settings</a>', compact: true })}`;
  }

  function renderToday(today) {
    const todays = sortForDay(state.tasks.filter((t) => t.dueDate === today));
    const s = summarize(todays, today);
    const overdue = state.tasks.filter((t) => isOverdue(t, today)).length;

    let body;
    if (!state.tasks.length) {
      body = emptyState({
        iconName: 'calendar-check',
        title: 'Plan your first study task',
        text: 'Add a chapter to read, a problem set to solve or a revision block. Your dashboard fills in as you go.',
        action: addButton('Add Task'),
      });
    } else if (!todays.length) {
      body = emptyState({
        iconName: 'calendar',
        title: 'Nothing scheduled for today',
        text: 'Add a task for today, or check what is coming up this week.',
        action: addButton('Add task for today', 'data-action="add"', 'btn btn-secondary'),
        compact: true,
      });
    } else {
      body = `${s.pending === 0 ? `<div class="done-banner">${icon('circle-check', { size: 20 })}<div><p class="done-title">Every task for today is complete.</p><p class="done-text">Good work. Plan tomorrow or review a chapter.</p></div></div>` : ''}
        <ul class="task-list">${todays.map((t) => renderTaskItem(t, { today, showDate: false, compact: true })).join('')}</ul>`;
    }

    $('#dash-today').innerHTML = `
      <div class="card-head">
        <div>
          <h2 class="card-title" id="dash-today-title">Today's Study Plan</h2>
          <p class="card-sub">${todays.length ? `${s.completed} of ${s.total} completed` : formatLongDate(today)}</p>
        </div>
        ${todays.length ? addButton('Add', 'data-action="add" aria-label="Add task for today"', 'btn btn-secondary btn-sm') : ''}
      </div>
      ${todays.length ? `<div class="progress-row">${progressBar(s.pct, `Today's completion ${s.pct}%`)}<span class="progress-value">${s.pct}%</span></div>` : ''}
      ${overdue ? `<a class="notice notice-danger" href="#/tasks?view=overdue">${icon('alert-triangle', { size: 16 })}<span>${plural(overdue, 'overdue task')} ${overdue === 1 ? 'needs' : 'need'} attention</span>${icon('chevron-right', { size: 16, cls: 'notice-chevron' })}</a>` : ''}
      ${body}`;
  }

  function renderPriority(today) {
    const list = state.tasks.filter((t) => !t.completed && t.priority === 'high').sort(compareByDue);
    $('#dash-priority').innerHTML = `
      <div class="card-head">
        <h2 class="card-title" id="dash-priority-title">High Priority</h2>
        <span class="count-badge">${list.length}</span>
      </div>
      ${list.length
        ? `<ul class="task-list task-list-tight">${list.slice(0, 5).map((t) => renderTaskItem(t, { today, compact: true })).join('')}</ul>
           ${list.length > 5 ? `<a class="link-btn" href="#/tasks">View all ${list.length} ${icon('arrow-right', { size: 14 })}</a>` : ''}`
        : emptyState({ iconName: 'flag', title: 'No high-priority tasks pending', compact: true })}`;
  }

  function renderUpcoming(today) {
    const end = addDays(today, 7);
    const list = state.tasks.filter((t) => !t.completed && t.dueDate > today && t.dueDate <= end).sort(compareByDue);
    $('#dash-upcoming').innerHTML = `
      <div class="card-head">
        <div>
          <h2 class="card-title" id="dash-upcoming-title">Upcoming Deadlines</h2>
          <p class="card-sub">Next 7 days</p>
        </div>
      </div>
      ${list.length
        ? `<ul class="deadline-list">${list.slice(0, 5).map((t) => {
            const d = parseDateKey(t.dueDate);
            const days = diffDays(today, t.dueDate);
            return `<li>
              <button type="button" class="deadline" data-task-action="edit" data-id="${esc(t.id)}" aria-label="Edit ${esc(t.title)}, due ${days === 1 ? 'tomorrow' : `in ${days} days`}">
                <span class="deadline-date"><b>${d.getDate()}</b><small>${MONTHS_SHORT[d.getMonth()]}</small></span>
                <span class="deadline-body">
                  <span class="deadline-title">${esc(t.title)}</span>
                  <span class="deadline-meta"><i class="sdot" style="--c:${subjectColor(t.subject)}" aria-hidden="true"></i>${esc(t.subject || 'No subject')} · ${days === 1 ? 'Tomorrow' : `In ${days} days`}</span>
                </span>
                ${t.priority === 'high' ? `<span class="priority priority-high">${icon('flag', { size: 13 })}</span>` : ''}
              </button>
            </li>`;
          }).join('')}</ul>`
        : emptyState({ iconName: 'calendar', title: 'No deadlines this week', compact: true })}`;
  }

  function renderRecent(today) {
    const list = recentCompletions(state.history, 5);
    $('#dash-recent').innerHTML = `
      <div class="card-head">
        <h2 class="card-title" id="dash-recent-title">Recently Completed</h2>
        <a class="link-btn" href="#/progress">Progress ${icon('arrow-right', { size: 14 })}</a>
      </div>
      ${list.length
        ? `<ul class="recent-list">${list.map((h) => {
            const task = state.tasks.find((t) => t.id === h.taskId);
            const title = task ? task.title : h.title;
            const subject = task ? task.subject : h.subject;
            return `<li class="recent">
              <span class="recent-icon">${icon('check', { size: 13 })}</span>
              <span class="recent-body">
                <span class="recent-title">${esc(title)}</span>
                <span class="recent-meta">${esc(subject || 'No subject')} · ${esc(formatMoment(h.completedAt, today))}</span>
              </span>
            </li>`;
          }).join('')}</ul>`
        : emptyState({ iconName: 'circle-check', title: 'No completed tasks yet', text: 'Tick off a task and it will appear here.', compact: true })}`;
  }

  update();
  return { update };
}
