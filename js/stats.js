/**
 * stats.js
 * Derived numbers and subject helpers. Everything here is computed from stored
 * data; nothing is hardcoded or estimated.
 *
 * Definitions used everywhere in the app:
 *  - Overdue: not completed and due date is before today.
 *  - Monthly statistics: tasks DUE in that month (not tasks created in it).
 *  - Completed today / this week: completion events from history, by local completion date.
 *  - Streak: consecutive calendar days with at least one completed task. If nothing is
 *    completed yet today, the streak ending yesterday still counts until today ends.
 */

import { addDays, diffDays, keyFromISO, pad2, percent, startOfWeekKey } from './utils.js';
import { CORE_SUBJECTS } from './storage.js';

export const PRIORITY_RANK = { high: 3, medium: 2, low: 1 };
export const PRIORITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };

/* ---------- Task status ---------- */

export const isOverdue = (t, today) => !t.completed && t.dueDate < today;

export function taskStatus(t, today) {
  if (t.completed) return 'completed';
  return isOverdue(t, today) ? 'overdue' : 'pending';
}

export function compareByDue(a, b) {
  return a.dueDate.localeCompare(b.dueDate)
    || PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]
    || a.title.localeCompare(b.title);
}

/** Pending first, then by time and priority. */
export function sortForDay(list) {
  return list.slice().sort((a, b) => Number(a.completed) - Number(b.completed) || compareByDue(a, b));
}

export function groupByDate(tasks) {
  const map = new Map();
  tasks.forEach((t) => {
    if (!map.has(t.dueDate)) map.set(t.dueDate, []);
    map.get(t.dueDate).push(t);
  });
  return map;
}

export function summarize(list, today) {
  const completed = list.filter((t) => t.completed).length;
  const overdue = list.filter((t) => isOverdue(t, today)).length;
  return {
    total: list.length,
    completed,
    pending: list.length - completed,
    overdue,
    pct: percent(completed, list.length),
  };
}

export function monthStats(tasks, year, monthIndex, today) {
  const prefix = `${year}-${pad2(monthIndex + 1)}-`;
  return summarize(tasks.filter((t) => t.dueDate.startsWith(prefix)), today);
}

/* ---------- Completion history ---------- */

export function completionDayKeys(history) {
  const days = new Set();
  history.forEach((h) => { const k = keyFromISO(h.completedAt); if (k) days.add(k); });
  return days;
}

export const completedOnDay = (history, key) =>
  history.filter((h) => keyFromISO(h.completedAt) === key).length;

export const completedBetween = (history, startKey, endKey) =>
  history.filter((h) => { const k = keyFromISO(h.completedAt); return k && k >= startKey && k <= endKey; }).length;

export function streaks(history, today) {
  const days = completionDayKeys(history);
  if (!days.size) return { current: 0, best: 0 };
  const sorted = [...days].filter((k) => k <= today).sort();
  let best = 0;
  let run = 0;
  sorted.forEach((k, i) => {
    run = i > 0 && diffDays(sorted[i - 1], k) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  });
  let current = 0;
  let cursor = days.has(today) ? today : addDays(today, -1);
  while (days.has(cursor)) { current++; cursor = addDays(cursor, -1); }
  return { current, best: Math.max(best, current) };
}

export function lastNDays(history, today, n = 7) {
  const counts = new Map();
  history.forEach((h) => {
    const k = keyFromISO(h.completedAt);
    if (k) counts.set(k, (counts.get(k) || 0) + 1);
  });
  return Array.from({ length: n }, (_, i) => {
    const key = addDays(today, i - (n - 1));
    return { key, count: counts.get(key) || 0 };
  });
}

export const recentCompletions = (history, limit) =>
  history.slice().sort((a, b) => b.completedAt.localeCompare(a.completedAt)).slice(0, limit);

/* ---------- Subjects ---------- */

export const TRACK_SUBJECTS = {
  NEET: ['Physics', 'Chemistry', 'Biology'],
  JEE: ['Physics', 'Chemistry', 'Mathematics'],
  Custom: CORE_SUBJECTS,
};
export const COURSES = [
  { id: 'NEET', title: 'NEET', sub: 'Medical entrance' },
  { id: 'JEE', title: 'JEE', sub: 'Engineering entrance' },
  { id: 'Custom', title: 'Custom', sub: 'Choose your own subjects' },
];

/** Core subjects of the chosen course (for Custom, the ones the student picked). */
export function trackSubjects(settings) {
  if (settings.examTrack === 'Custom') return CORE_SUBJECTS.filter((s) => settings.customTrackSubjects.includes(s));
  return TRACK_SUBJECTS[settings.examTrack] || TRACK_SUBJECTS.NEET;
}

/** Every subject that belongs to the student's course: core subjects plus their own. */
export const courseSubjects = (settings) => [...new Set([...trackSubjects(settings), ...settings.customSubjects])];
export const GENERAL_SUBJECTS = ['Revision', 'Personal'];
export const UNASSIGNED_ROUTE = '~unassigned';

const SUBJECT_COLORS = {
  Physics: '#7FA2F0',
  Chemistry: '#5EBFA8',
  Biology: '#9CCB6E',
  Mathematics: '#C49AE6',
  Revision: '#D9BE73',
  Personal: '#A1A1AA',
};
const EXTRA_COLORS = ['#E58E9F', '#6FC3D6', '#D8A26B', '#9DA9F0', '#82C79A', '#D49ADB'];

export function subjectColor(name) {
  if (!name) return '#71717A';
  if (SUBJECT_COLORS[name]) return SUBJECT_COLORS[name];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return EXTRA_COLORS[h % EXTRA_COLORS.length];
}

/** Grouped options for the task modal's subject select. */
export function subjectGroups(settings, tasks = []) {
  const track = settings.examTrack === 'Custom' ? courseSubjects(settings) : trackSubjects(settings);
  const used = new Set([...track, ...GENERAL_SUBJECTS]);
  const other = [];
  [...CORE_SUBJECTS, ...settings.customSubjects, ...tasks.map((t) => t.subject)].forEach((s) => {
    if (s && !used.has(s)) { used.add(s); other.push(s); }
  });
  return [
    { label: settings.examTrack === 'Custom' ? 'My subjects' : `${settings.examTrack} subjects`, items: track },
    { label: 'General', items: GENERAL_SUBJECTS },
    { label: 'Other subjects', items: other },
  ].filter((g) => g.items.length);
}

/** Subjects shown on the Subjects and Progress pages. */
export function overviewSubjects(settings, tasks) {
  const list = [...trackSubjects(settings), ...GENERAL_SUBJECTS, ...settings.customSubjects];
  const seen = new Set(list);
  tasks.forEach((t) => { if (t.subject && !seen.has(t.subject)) { seen.add(t.subject); list.push(t.subject); } });
  return [...new Set(list)];
}

export function subjectStats(tasks, subject, today) {
  const list = tasks.filter((t) => t.subject === subject);
  const s = summarize(list, today);
  return { ...s, upcoming: list.filter((t) => !t.completed && t.dueDate >= today).length };
}

/* ---------- Progress report ---------- */

/**
 * Every figure on the My Progress page and in the downloadable PDF report,
 * computed in one place so both always agree.
 *  - On time: completed on or before the due date (by local completion date).
 */
export function progressStats({ tasks, history, settings }, today) {
  const done = tasks.filter((t) => t.completed);
  const onTime = done.filter((t) => { const k = keyFromISO(t.completedAt); return k && k <= t.dueDate; }).length;
  const weekStart = startOfWeekKey(today, settings.weekStartsOn);
  const [year, month] = today.split('-').map(Number);

  const subjects = overviewSubjects(settings, tasks)
    .map((name) => ({ name, ...subjectStats(tasks, name, today) }))
    .filter((s) => s.total > 0);
  if (tasks.some((t) => !t.subject)) subjects.push({ name: '', ...subjectStats(tasks, '', today) });

  return {
    today,
    overall: summarize(tasks, today),
    onTime,
    late: done.length - onTime,
    onTimePct: percent(onTime, done.length),
    completedToday: completedOnDay(history, today),
    weekStart,
    weekEnd: addDays(weekStart, 6),
    completedThisWeek: completedBetween(history, weekStart, addDays(weekStart, 6)),
    year,
    monthIndex: month - 1,
    month: monthStats(tasks, year, month - 1, today),
    streak: streaks(history, today),
    last7: lastNDays(history, today, 7),
    subjects,
    priorities: ['high', 'medium', 'low'].map((p) => ({ priority: p, ...summarize(tasks.filter((t) => t.priority === p), today) })),
    overdue: tasks.filter((t) => isOverdue(t, today)).sort(compareByDue)
      .map((t) => ({ ...t, daysOverdue: diffDays(t.dueDate, today) })),
    recent: recentCompletions(history, 12).map((h) => {
      const t = tasks.find((x) => x.id === h.taskId);
      const dueDate = t ? t.dueDate : h.dueDate;
      const doneKey = keyFromISO(h.completedAt);
      return {
        title: t ? t.title : h.title,
        subject: t ? t.subject : h.subject,
        dueDate,
        completedAt: h.completedAt,
        late: !!(dueDate && doneKey && doneKey > dueDate),
        deleted: !t,
      };
    }),
  };
}
