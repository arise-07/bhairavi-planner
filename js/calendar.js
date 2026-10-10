/**
 * calendar.js
 * Month grid calculations, the full Monthly Calendar page, and the compact
 * calendar used on the dashboard.
 *
 * Monthly statistics count tasks DUE in the displayed month.
 */

import { state } from './state.js';
import {
  MONTHS, WEEKDAYS_SHORT, toDateKey, todayKey, parseDateKey, isValidDateKey, addDays, diffDays,
  daysInMonth, formatLongDate, relativeDayLabel, plural, pad2, esc,
} from './utils.js';
import { groupByDate, sortForDay, summarize, monthStats, taskStatus } from './stats.js';
import { renderTaskItem, emptyState, progressBar, addButton } from './ui.js';
import { icon } from './icons.js';
import { openTaskModal } from './modal.js';

/* ---------- Month calculations ---------- */

/**
 * Cells for a month view, including leading/trailing days from adjacent months
 * to complete each week. Uses as many weeks as the month needs (4–6).
 */
export function monthMatrix(year, monthIndex, weekStartsOn = 0) {
  const offset = (new Date(year, monthIndex, 1).getDay() - weekStartsOn + 7) % 7;
  const total = Math.ceil((offset + daysInMonth(year, monthIndex)) / 7) * 7;
  const cells = [];
  for (let i = 0; i < total; i++) {
    const d = new Date(year, monthIndex, 1 - offset + i);
    cells.push({ key: toDateKey(d), day: d.getDate(), inMonth: d.getMonth() === monthIndex });
  }
  return cells;
}

export function weekdayLabels(weekStartsOn = 0) {
  return [...WEEKDAYS_SHORT.slice(weekStartsOn), ...WEEKDAYS_SHORT.slice(0, weekStartsOn)];
}

/** Worst status wins: overdue > pending > completed. */
function dayStatus(list, today) {
  const statuses = list.map((t) => taskStatus(t, today));
  if (statuses.includes('overdue')) return 'overdue';
  if (statuses.includes('pending')) return 'pending';
  return 'completed';
}

function dayAriaLabel(key, list, today) {
  const base = `${formatLongDate(key)}${key === today ? ', today' : ''}`;
  if (!list.length) return `${base}, no tasks`;
  const s = summarize(list, today);
  const parts = [];
  if (s.completed) parts.push(`${s.completed} completed`);
  if (s.pending - s.overdue) parts.push(`${s.pending - s.overdue} pending`);
  if (s.overdue) parts.push(`${s.overdue} overdue`);
  return `${base}, ${plural(list.length, 'task')}: ${parts.join(', ')}`;
}

const legend = () => `<div class="cal-legend" aria-hidden="true">
  <span><i class="dot dot-pending"></i>Pending</span>
  <span><i class="dot dot-completed"></i>Completed</span>
  <span><i class="dot dot-overdue"></i>Overdue</span>
</div>`;

/* ---------- Compact calendar (dashboard) ---------- */

export function renderMiniCalendar({ year, month, today, tasks, weekStartsOn }) {
  const byDate = groupByDate(tasks);
  const cells = monthMatrix(year, month, weekStartsOn);
  return `<div class="mini-cal">
    <div class="mini-cal-head">
      <p class="mini-cal-title">${MONTHS[month]} ${year}</p>
      <div class="mini-cal-nav">
        <button type="button" class="icon-btn icon-btn-sm" data-action="mini-prev" aria-label="Previous month">${icon('chevron-left', { size: 16 })}</button>
        <button type="button" class="icon-btn icon-btn-sm" data-action="mini-next" aria-label="Next month">${icon('chevron-right', { size: 16 })}</button>
      </div>
    </div>
    <div class="mini-cal-grid" role="group" aria-label="${MONTHS[month]} ${year}">
      ${weekdayLabels(weekStartsOn).map((w) => `<span class="mini-cal-wd" aria-hidden="true">${w.slice(0, 2)}</span>`).join('')}
      ${cells.map((c) => {
        const list = byDate.get(c.key) || [];
        return `<button type="button" class="mini-cal-day${c.inMonth ? '' : ' is-out'}${c.key === today ? ' is-today' : ''}" data-action="mini-date" data-date="${c.key}" aria-label="${esc(dayAriaLabel(c.key, list, today))}">
          <span>${c.day}</span>${list.length ? `<i class="dot dot-${dayStatus(list, today)}"></i>` : ''}
        </button>`;
      }).join('')}
    </div>
    ${legend()}
  </div>`;
}

/* ---------- Monthly Calendar page ---------- */

// Kept at module level so the calendar remembers the month/date between visits.
let view = null; // { y, m }
let selected = null;
let mode = null;

export function mountCalendar(root, { query }) {
  const today = todayKey();
  if (!view) { const d = new Date(); view = { y: d.getFullYear(), m: d.getMonth() }; }
  if (!selected) selected = today;
  if (!mode) mode = state.settings.calendarView;

  const qd = query.get('date');
  if (qd && isValidDateKey(qd)) {
    selected = qd;
    const d = parseDateKey(qd);
    view = { y: d.getFullYear(), m: d.getMonth() };
  }

  root.innerHTML = `
  <div class="page page-calendar">
    <header class="page-head">
      <div>
        <h1 class="page-title">Monthly Calendar</h1>
        <p class="page-sub">Plan, review and manage your study tasks by date.</p>
      </div>
      <div class="page-actions">
        <div class="segmented" role="group" aria-label="Calendar view">
          <button type="button" class="seg-btn" data-action="mode" data-mode="month">Month</button>
          <button type="button" class="seg-btn" data-action="mode" data-mode="agenda">Agenda</button>
        </div>
        ${addButton('Add Task')}
      </div>
    </header>

    <div class="cal-layout">
      <section class="card cal-card" aria-labelledby="cal-title">
        <div class="cal-toolbar">
          <h2 class="cal-title" id="cal-title" aria-live="polite"></h2>
          <div class="cal-nav">
            <button type="button" class="icon-btn" data-action="prev" aria-label="Previous month">${icon('chevron-left')}</button>
            <button type="button" class="btn btn-secondary btn-sm" data-action="today">Today</button>
            <button type="button" class="icon-btn" data-action="next" aria-label="Next month">${icon('chevron-right')}</button>
          </div>
        </div>
        <div id="cal-summary"></div>
        <div id="cal-body"></div>
      </section>

      <aside class="card day-panel" id="day-panel" aria-label="Tasks for selected date"></aside>
    </div>
  </div>`;

  const $ = (sel) => root.querySelector(sel);

  function select(key, { focus = false } = {}) {
    selected = key;
    const d = parseDateKey(key);
    view = { y: d.getFullYear(), m: d.getMonth() };
    update();
    if (focus) root.querySelector(`[data-fk="cal-${key}"]`)?.focus();
  }

  function shiftMonth(delta) {
    const d = new Date(view.y, view.m + delta, 1);
    view = { y: d.getFullYear(), m: d.getMonth() };
    // Keep the selection inside the visible month: same day number, clamped to month length.
    const day = Math.min(parseDateKey(selected).getDate(), daysInMonth(view.y, view.m));
    selected = `${view.y}-${pad2(view.m + 1)}-${pad2(day)}`;
    update();
  }

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    switch (btn.dataset.action) {
      case 'prev': shiftMonth(-1); break;
      case 'next': shiftMonth(1); break;
      case 'today': select(todayKey()); break;
      case 'select': select(btn.dataset.date); break;
      case 'mode': mode = btn.dataset.mode; update(); break;
      case 'add': openTaskModal({ date: btn.dataset.date || selected, trigger: btn }); break;
      default: break;
    }
  });

  // Arrow-key navigation between days (roving tabindex).
  root.addEventListener('keydown', (e) => {
    const cell = e.target.closest('.cal-cell');
    if (!cell) return;
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (delta) {
      e.preventDefault();
      select(addDays(cell.dataset.date, delta), { focus: true });
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      shiftMonth(e.key === 'PageUp' ? -1 : 1);
      root.querySelector(`[data-fk="cal-${selected}"]`)?.focus();
    }
  });

  function update() {
    const now = todayKey();
    $('#cal-title').textContent = `${MONTHS[view.m]} ${view.y}`;
    root.querySelectorAll('[data-action="mode"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    $('#cal-summary').innerHTML = renderSummary(now);
    $('#cal-body').innerHTML = mode === 'agenda' ? renderAgenda(now) : renderMonth(now);
    $('#day-panel').innerHTML = renderDayPanel(now);
  }

  update();
  return {
    update,
    addDefaults: () => ({ date: selected }),
  };
}

function renderSummary(today) {
  const s = monthStats(state.tasks, view.y, view.m, today);
  return `<div class="cal-summary">
    <div class="sum-item"><span class="sum-label">Scheduled</span><span class="sum-value">${s.total}</span></div>
    <div class="sum-item"><span class="sum-label">Completed</span><span class="sum-value">${s.completed}</span></div>
    <div class="sum-item"><span class="sum-label">Pending</span><span class="sum-value">${s.pending}</span></div>
    <div class="sum-item"><span class="sum-label">Overdue</span><span class="sum-value${s.overdue ? ' is-danger' : ''}">${s.overdue}</span></div>
    <div class="sum-progress">
      <div class="sum-progress-row"><span class="sum-label">Completion</span><span class="sum-pct">${s.pct}%</span></div>
      ${progressBar(s.pct, `${MONTHS[view.m]} completion ${s.pct}%`)}
    </div>
  </div>`;
}

function renderMonth(today) {
  const cells = monthMatrix(view.y, view.m, state.settings.weekStartsOn);
  const byDate = groupByDate(state.tasks);
  const tabKey = cells.some((c) => c.key === selected) ? selected : cells.find((c) => c.inMonth).key;

  return `<div class="cal-weekdays" aria-hidden="true">${weekdayLabels(state.settings.weekStartsOn).map((w) => `<span>${w}</span>`).join('')}</div>
  <div class="cal-grid" role="group" aria-label="${MONTHS[view.m]} ${view.y}. Use arrow keys to move between days.">
    ${cells.map((c) => {
      const list = sortForDay(byDate.get(c.key) || []);
      const cls = ['cal-cell'];
      if (!c.inMonth) cls.push('is-out');
      if (c.key === today) cls.push('is-today');
      if (c.key === selected) cls.push('is-selected');
      const items = list.slice(0, 2).map((t) => `<span class="cal-item is-${taskStatus(t, today)}">${esc(t.title)}</span>`).join('');
      const more = list.length > 2 ? `<span class="cal-more">+${list.length - 2} more</span>` : '';
      const dots = list.length
        ? `<span class="cal-dots">${list.slice(0, 3).map((t) => `<i class="dot dot-${taskStatus(t, today)}"></i>`).join('')}${list.length > 3 ? `<span class="cal-dot-count">+${list.length - 3}</span>` : ''}</span>`
        : '';
      return `<button type="button" class="${cls.join(' ')}" data-action="select" data-date="${c.key}" data-fk="cal-${c.key}"
        tabindex="${c.key === tabKey ? '0' : '-1'}" aria-pressed="${c.key === selected}" aria-label="${esc(dayAriaLabel(c.key, list, today))}">
        <span class="cal-num">${c.day}</span>
        ${list.length ? `<span class="cal-items" aria-hidden="true">${items}${more}</span>${dots.replace('class="cal-dots"', 'class="cal-dots" aria-hidden="true"')}` : ''}
      </button>`;
    }).join('')}
  </div>
  ${legend()}`;
}

function renderAgenda(today) {
  const prefix = `${view.y}-${pad2(view.m + 1)}-`;
  const inMonth = state.tasks.filter((t) => t.dueDate.startsWith(prefix));
  if (!inMonth.length) {
    return emptyState({
      iconName: 'calendar',
      title: `No tasks scheduled in ${MONTHS[view.m]}`,
      text: 'Switch to the month view to pick a date, or add a task now.',
      action: addButton('Add Task', `data-action="add" data-date="${selected.startsWith(prefix) ? selected : `${prefix}01`}"`, 'btn btn-secondary'),
    });
  }
  const groups = [...groupByDate(inMonth).entries()].sort(([a], [b]) => a.localeCompare(b));
  return `<div class="agenda">${groups.map(([key, list]) => {
    const s = summarize(list, today);
    return `<section class="agenda-day${key === selected ? ' is-selected' : ''}${key === today ? ' is-today' : ''}">
      <button type="button" class="agenda-date" data-action="select" data-date="${key}" aria-pressed="${key === selected}">
        <span class="agenda-day-num">${parseDateKey(key).getDate()}</span>
        <span class="agenda-day-text"><span class="agenda-rel">${esc(relativeDayLabel(key, today))}</span><span class="agenda-long">${formatLongDate(key)}</span></span>
        <span class="agenda-count">${s.completed}/${s.total} done</span>
      </button>
      <ul class="task-list">${sortForDay(list).map((t) => renderTaskItem(t, { today, showDate: false, compact: true })).join('')}</ul>
    </section>`;
  }).join('')}</div>`;
}

function renderDayPanel(today) {
  const list = sortForDay(state.tasks.filter((t) => t.dueDate === selected));
  const s = summarize(list, today);
  const diff = diffDays(today, selected);
  const tag = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : diff > 0 ? `In ${diff} days` : `${-diff} days ago`;

  return `<div class="day-panel-head">
      <p class="eyebrow">${tag}</p>
      <h2 class="day-panel-title">${formatLongDate(selected)}</h2>
    </div>
    <dl class="day-stats">
      <div><dt>Scheduled</dt><dd>${s.total}</dd></div>
      <div><dt>Completed</dt><dd>${s.completed}</dd></div>
      <div><dt>Pending</dt><dd>${s.pending}</dd></div>
    </dl>
    ${addButton('Add task for this date', `data-action="add" data-date="${selected}"`, 'btn btn-secondary btn-block')}
    ${list.length
      ? `<ul class="task-list">${list.map((t) => renderTaskItem(t, { today, showDate: false, compact: true })).join('')}</ul>`
      : emptyState({
        iconName: 'calendar',
        title: 'No tasks on this day',
        text: selected < today ? 'Nothing was scheduled for this date.' : 'Add a task to plan this day.',
        compact: true,
      })}`;
}
