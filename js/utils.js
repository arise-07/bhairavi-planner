/**
 * utils.js
 * Pure helpers: local-date handling, formatting, ids and escaping.
 *
 * DATE RULE: calendar dates are always local "YYYY-MM-DD" strings built from
 * getFullYear()/getMonth()/getDate(). We never use toISOString() for a date key,
 * because that converts to UTC and can shift a task to the previous/next day
 * (e.g. 00:30 IST is still the previous day in UTC).
 */

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const pad2 = (n) => String(n).padStart(2, '0');

/* ---------- Local date keys ---------- */

export function toDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export const todayKey = () => toDateKey(new Date());

/** Parse "YYYY-MM-DD" into a local Date at midnight. */
export function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isValidDateKey(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  return toDateKey(parseDateKey(key)) === key; // rejects 2026-02-30 etc.
}

export function isValidTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function addDays(key, n) {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + n);
  return toDateKey(d);
}

/** Whole calendar days from `fromKey` to `toKey` (positive if toKey is later). */
export function diffDays(fromKey, toKey) {
  return Math.round((parseDateKey(toKey) - parseDateKey(fromKey)) / 86400000);
}

/** Days in a month. `monthIndex` is 0-based. Handles leap years (Feb 29). */
export function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function startOfWeekKey(key, weekStartsOn = 0) {
  const d = parseDateKey(key);
  d.setDate(d.getDate() - ((d.getDay() - weekStartsOn + 7) % 7));
  return toDateKey(d);
}

/** Local date key for an ISO timestamp (completion times, session times). */
export function keyFromISO(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : toDateKey(d);
}

/* ---------- Formatting ---------- */

export function formatLongDate(key) {
  const d = parseDateKey(key);
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatShortDate(key, withYear = false) {
  const d = parseDateKey(key);
  return `${WEEKDAYS_SHORT[d.getDay()]}, ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}${withYear ? ` ${d.getFullYear()}` : ''}`;
}

export function relativeDayLabel(key, today = todayKey()) {
  const diff = diffDays(today, key);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return formatShortDate(key, key.slice(0, 4) !== today.slice(0, 4));
}

export function relativeDistance(key, today = todayKey()) {
  const diff = diffDays(today, key);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return diff > 0 ? `In ${diff} days` : `${-diff} days ago`;
}

export function formatTime(hhmm) {
  if (!isValidTime(hhmm)) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${pad2(m)} ${h >= 12 ? 'PM' : 'AM'}`;
}

export function formatClock(date) {
  return formatTime(`${pad2(date.getHours())}:${pad2(date.getMinutes())}`);
}

/** "Today, 6:40 PM" style label for a timestamp. */
export function formatMoment(iso, today = todayKey()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${relativeDayLabel(toDateKey(d), today)}, ${formatClock(d)}`;
}

export function formatCountdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${pad2(m)}:${pad2(sec)}` : `${pad2(m)}:${pad2(sec)}`;
}

export function greetingFor(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/* ---------- Misc ---------- */

export function uid() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESC_MAP[c]);

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const percent = (part, total) => (total > 0 ? Math.round((part / total) * 100) : 0);

export function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

export const prefersReducedMotion = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
