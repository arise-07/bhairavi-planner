/**
 * navigation.js
 * Hash-based client-side routing (works on any static host, no server rewrites)
 * and rendering of the sidebar, mobile bottom navigation and "More" sheet.
 *
 * Routes: #/dashboard  #/calendar?date=YYYY-MM-DD  #/tasks?view=overdue
 *         #/subjects   #/subjects/<name>  #/progress  #/settings
 */

import { icon } from './icons.js';
import { syncScrollLock } from './ui.js';

export const ROUTES = [
  { id: 'dashboard', label: 'Dashboard', short: 'Home', icon: 'layout-dashboard' },
  { id: 'calendar', label: 'Monthly Calendar', short: 'Calendar', icon: 'calendar' },
  { id: 'tasks', label: 'My Tasks', short: 'Tasks', icon: 'list-checks' },
  { id: 'subjects', label: 'Subjects', short: 'Subjects', icon: 'book-open' },
  { id: 'progress', label: 'My Progress', short: 'Progress', icon: 'chart-column' },
  { id: 'settings', label: 'Settings', short: 'Settings', icon: 'settings' },
];

const MOBILE_PRIMARY = ['dashboard', 'calendar', 'tasks', 'progress'];

export const routeLabel = (id) => ROUTES.find((r) => r.id === id)?.label || 'Dashboard';

export function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [pathPart = '', queryPart = ''] = raw.split('?');
  const segs = pathPart.split('/').filter(Boolean).map((s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  });
  const id = ROUTES.some((r) => r.id === segs[0]) ? segs[0] : 'dashboard';
  return { id, segs: segs.slice(1), query: new URLSearchParams(queryPart) };
}

export function navigate(path) {
  const target = `#/${String(path).replace(/^#?\/?/, '')}`;
  if (window.location.hash === target) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else window.location.hash = target;
}

export function renderNav() {
  const side = document.getElementById('side-nav');
  const bottom = document.getElementById('bottom-nav');
  const sheet = document.getElementById('sheet-nav');

  side.innerHTML = ROUTES.map((r) => `
    <a class="nav-link" href="#/${r.id}" data-route="${r.id}" title="${r.label}">
      ${icon(r.icon, { size: 18 })}<span class="nav-label">${r.label}</span>
    </a>`).join('');

  bottom.innerHTML = `${MOBILE_PRIMARY.map((id) => {
    const r = ROUTES.find((x) => x.id === id);
    return `<a class="bottom-link" href="#/${r.id}" data-route="${r.id}">${icon(r.icon, { size: 20 })}<span>${r.short}</span></a>`;
  }).join('')}
    <button type="button" class="bottom-link" id="more-btn" aria-haspopup="dialog" aria-controls="more-sheet">
      ${icon('more-horizontal', { size: 20 })}<span>More</span>
    </button>`;

  sheet.innerHTML = ROUTES.filter((r) => !MOBILE_PRIMARY.includes(r.id)).map((r) => `
    <a class="sheet-link" href="#/${r.id}" data-route="${r.id}">
      ${icon(r.icon, { size: 18 })}<span>${r.label}</span>${icon('chevron-right', { size: 16, cls: 'sheet-chevron' })}
    </a>`).join('');

  const sheetDlg = document.getElementById('more-sheet');
  document.getElementById('more-btn').addEventListener('click', () => {
    sheetDlg.showModal();
    syncScrollLock();
  });
  sheetDlg.querySelector('[data-close-sheet]').addEventListener('click', closeMoreSheet);
  sheetDlg.addEventListener('click', (e) => { if (e.target === sheetDlg) closeMoreSheet(); });
  sheetDlg.addEventListener('close', syncScrollLock);
}

export function closeMoreSheet() {
  const sheetDlg = document.getElementById('more-sheet');
  if (sheetDlg?.open) sheetDlg.close();
}

export function setActiveNav(id) {
  document.querySelectorAll('[data-route]').forEach((a) => {
    const on = a.dataset.route === id;
    a.classList.toggle('is-active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const more = document.getElementById('more-btn');
  if (more) more.classList.toggle('is-active', !MOBILE_PRIMARY.includes(id));
  const crumb = document.getElementById('crumb-current');
  if (crumb) crumb.textContent = routeLabel(id);
}
