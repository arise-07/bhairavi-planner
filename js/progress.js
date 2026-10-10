/**
 * progress.js
 * My Progress page: the student's study statistics, plus downloads of the
 * same figures as a PDF report or an Excel file. Every number comes from
 * progressStats() in stats.js.
 */

import { state } from './state.js';
import {
  todayKey, parseDateKey, formatShortDate, formatMoment, WEEKDAYS_SHORT, MONTHS, plural, esc,
} from './utils.js';
import { progressStats, subjectColor, PRIORITY_LABEL } from './stats.js';
import { statCard, emptyState, progressBar, renderTaskItem } from './ui.js';
import { icon } from './icons.js';
import { downloadProgressReport } from './report.js';
import { exportTasksToExcel } from './excel.js';

const PRIORITY_COLOR = { high: 'var(--danger)', medium: 'var(--warning)', low: 'var(--text-3)' };

export function mountProgress(root) {
  root.innerHTML = `
  <div class="page page-progress">
    <header class="page-head">
      <div>
        <h1 class="page-title">My Progress</h1>
        <p class="page-sub" id="pg-sub"></p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-secondary" data-action="excel">${icon('file-spreadsheet', { size: 16 })}<span>Excel</span></button>
        <button type="button" class="btn btn-primary" data-action="report">${icon('download', { size: 16 })}<span>Download Report (PDF)</span></button>
      </div>
    </header>

    <section class="stat-grid" id="pg-stats" aria-label="Progress statistics"></section>

    <div class="progress-grid">
      <section class="card" aria-labelledby="pg-week-title">
        <div class="card-head">
          <div>
            <h2 class="card-title" id="pg-week-title">Last 7 days</h2>
            <p class="card-sub">Tasks completed per day</p>
          </div>
        </div>
        <div id="pg-week"></div>
      </section>

      <section class="card" aria-labelledby="pg-subjects-title">
        <div class="card-head"><h2 class="card-title" id="pg-subjects-title">Subject-wise progress</h2></div>
        <div id="pg-subjects"></div>
      </section>

      <section class="card" aria-labelledby="pg-priority-title">
        <div class="card-head"><h2 class="card-title" id="pg-priority-title">By priority</h2></div>
        <div id="pg-priority"></div>
      </section>

      <section class="card" aria-labelledby="pg-overdue-title">
        <div class="card-head">
          <h2 class="card-title" id="pg-overdue-title">Overdue tasks</h2>
          <span class="count-badge" id="pg-overdue-count"></span>
        </div>
        <div id="pg-overdue"></div>
      </section>
    </div>

    <section class="card" aria-labelledby="pg-history-title">
      <div class="card-head"><h2 class="card-title" id="pg-history-title">Recently completed</h2></div>
      <div id="pg-history"></div>
    </section>
  </div>`;

  const $ = (sel) => root.querySelector(sel);

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'report') downloadProgressReport(btn);
    if (btn.dataset.action === 'excel') exportTasksToExcel();
  });

  function update() {
    const today = todayKey();
    const s = progressStats(state, today);
    const o = s.overall;

    $('#pg-sub').textContent = o.total
      ? `${plural(o.total, 'task')} · ${o.completed} completed · ${o.overdue} overdue`
      : 'Your statistics appear here once you add tasks.';

    $('#pg-stats').innerHTML = [
      statCard({
        label: 'Completion rate', value: o.pct, unit: '%', iconName: 'circle-check',
        sub: `${o.completed} of ${plural(o.total, 'task')} done`,
        extra: progressBar(o.pct, `Completion rate ${o.pct}%`, { size: 'thin' }),
      }),
      statCard({ label: 'On-time completion', value: s.onTimePct, unit: '%', iconName: 'calendar-check', sub: `${s.onTime} on time · ${s.late} late` }),
      statCard({
        label: 'Overdue now', value: `<span class="${o.overdue ? 'text-danger' : ''}">${o.overdue}</span>`, iconName: 'alert-triangle',
        sub: o.overdue ? '<a class="stat-link" href="#/tasks?view=overdue">View overdue tasks</a>' : 'Nothing overdue',
      }),
      statCard({ label: 'Pending', value: o.pending - o.overdue, iconName: 'list-checks', sub: 'Due today or later' }),
      statCard({ label: 'Current streak', value: s.streak.current, unit: s.streak.current === 1 ? 'day' : 'days', iconName: 'flame', sub: `Best: ${plural(s.streak.best, 'day')}` }),
      statCard({ label: 'Completed this week', value: s.completedThisWeek, iconName: 'chart-column', sub: `${formatShortDate(s.weekStart)} – ${formatShortDate(s.weekEnd)}` }),
      statCard({
        label: `${MONTHS[s.monthIndex]} completion`, value: s.month.pct, unit: '%', iconName: 'calendar',
        sub: s.month.total ? `${s.month.completed} of ${plural(s.month.total, 'task')} due this month` : 'No tasks due this month',
      }),
      statCard({ label: 'Completed today', value: s.completedToday, iconName: 'check', sub: formatShortDate(today) }),
    ].join('');

    renderWeek(s, today);
    renderBreakdown($('#pg-subjects'), s.subjects.map((x) => ({ ...x, label: x.name || 'No subject', color: subjectColor(x.name) })), 'book-open', 'No subject data yet');
    renderBreakdown($('#pg-priority'), s.priorities.filter((p) => p.total).map((p) => ({ ...p, label: PRIORITY_LABEL[p.priority], color: PRIORITY_COLOR[p.priority] })), 'flag', 'No tasks yet');
    renderOverdue(s, today);
    renderHistory(s, today);
  }

  function renderWeek(s, today) {
    const total = s.last7.reduce((n, d) => n + d.count, 0);
    const max = Math.max(1, ...s.last7.map((d) => d.count));
    const summary = s.last7.map((d) => `${formatShortDate(d.key)}: ${d.count}`).join('; ');
    $('#pg-week').innerHTML = `
      <p class="chart-total"><span class="chart-total-value">${total}</span> ${total === 1 ? 'task' : 'tasks'} completed</p>
      <div class="chart" role="img" aria-label="Tasks completed per day. ${esc(summary)}">
        ${s.last7.map((d) => {
          const date = parseDateKey(d.key);
          const h = d.count ? Math.max(6, Math.round((d.count / max) * 100)) : 0;
          return `<div class="chart-col${d.key === today ? ' is-today' : ''}">
            <span class="chart-value">${d.count}</span>
            <div class="chart-track"><span class="chart-bar" style="height:${h}%"></span></div>
            <span class="chart-label">${d.key === today ? 'Today' : WEEKDAYS_SHORT[date.getDay()]}</span>
            <span class="chart-sublabel">${date.getDate()}</span>
          </div>`;
        }).join('')}
      </div>`;
  }

  function renderBreakdown(el, rows, iconName, emptyTitle) {
    el.innerHTML = rows.length
      ? `<ul class="subject-rows">${rows.map((r) => `
        <li class="subject-row">
          <div class="subject-row-head">
            <span class="subject-row-name"><i class="sdot" style="--c:${r.color}" aria-hidden="true"></i>${esc(r.label)}</span>
            <span class="subject-row-pct">${r.pct}%</span>
          </div>
          ${progressBar(r.pct, `${r.label} completion ${r.pct}%`, { size: 'thin' })}
          <p class="subject-row-meta">${r.completed} done · ${r.pending - r.overdue} pending${r.overdue ? ` · <span class="text-danger">${r.overdue} overdue</span>` : ''} · ${r.total} total</p>
        </li>`).join('')}</ul>`
      : emptyState({ iconName, title: emptyTitle, compact: true });
  }

  function renderOverdue(s, today) {
    $('#pg-overdue-count').textContent = s.overdue.length;
    $('#pg-overdue').innerHTML = s.overdue.length
      ? `<ul class="task-list task-list-tight">${s.overdue.slice(0, 5).map((t) => renderTaskItem(t, { today, compact: true })).join('')}</ul>
         ${s.overdue.length > 5 ? `<a class="link-btn" href="#/tasks?view=overdue">View all ${s.overdue.length} ${icon('arrow-right', { size: 14 })}</a>` : ''}`
      : emptyState({ iconName: 'circle-check', title: 'No overdue tasks', text: 'Everything past its due date is done.', compact: true });
  }

  function renderHistory(s, today) {
    $('#pg-history').innerHTML = s.recent.length
      ? `<ul class="history-list">${s.recent.map((r) => `
        <li class="history-item">
          <span class="recent-icon">${icon('check', { size: 13 })}</span>
          <div class="history-body">
            <p class="history-title">${esc(r.title)}${r.deleted ? ' <span class="tag">Deleted</span>' : ''}</p>
            <p class="history-meta">
              <span><i class="sdot" style="--c:${subjectColor(r.subject)}" aria-hidden="true"></i>${esc(r.subject || 'No subject')}</span>
              <span>Completed ${esc(formatMoment(r.completedAt, today))}</span>
              ${r.dueDate ? `<span>Due ${formatShortDate(r.dueDate)}${r.late ? ' · <span class="text-warning">late</span>' : ''}</span>` : ''}
            </p>
          </div>
        </li>`).join('')}</ul>`
      : emptyState({ iconName: 'circle-check', title: 'No completed tasks yet', text: 'Tick off a task and it will appear here.', compact: true });
  }

  update();
  return { update };
}
