/**
 * app.js
 * Entry point. Loads data, decides between the welcome screen and the app shell,
 * mounts the page for the current route, and re-renders it whenever data changes.
 *
 * Page modules export mountX(rootElement, route) and return { update(), destroy?() }.
 */

import { hydrateIcons } from './icons.js';
import { state, initState, subscribe } from './state.js';
import { onStorageError, storageAvailable } from './storage.js';
import { parseHash, navigate, renderNav, setActiveNav, routeLabel, closeMoreSheet } from './navigation.js';
import { initConfirm, toast, setPageTitle } from './ui.js';
import { initTaskModal, initTaskActions, openTaskModal } from './modal.js';
import { todayKey, greetingFor, initials } from './utils.js';
import { initWelcome, resetWelcome } from './welcome.js';

import { mountDashboard } from './dashboard.js';
import { mountCalendar } from './calendar.js';
import { mountTasks } from './tasks.js';
import { mountSubjects } from './subjects.js';
import { mountProgress } from './progress.js';
import { mountSettings } from './settings.js';

const PAGES = {
  dashboard: mountDashboard,
  calendar: mountCalendar,
  tasks: mountTasks,
  subjects: mountSubjects,
  progress: mountProgress,
  settings: mountSettings,
};

const $ = (id) => document.getElementById(id);
let current = null;
let shellReady = false;
let firstRoute = true;
let clock = { day: todayKey(), greeting: greetingFor() };

/* ---------- Boot ---------- */

function boot() {
  hydrateIcons();
  onStorageError(() => toast('Your latest change could not be saved. Browser storage may be full or blocked.', { type: 'error', duration: 8000 }));

  initState();
  initConfirm();
  initTaskModal();
  initTaskActions();
  initWelcome(onWelcomeComplete);
  subscribe(onDataChange);

  if (state.profile?.name) showApp();
  else showWelcome();

  if (!storageAvailable) {
    const banner = $('storage-banner');
    banner.textContent = 'Browser storage is unavailable (for example, in some private windows). You can use the planner, but your tasks will be lost when you close this tab.';
    banner.hidden = false;
  }
  if (state.loadWarnings.length) {
    toast('Some saved records could not be read and were skipped. Everything else loaded normally.', { type: 'error', duration: 8000 });
  }

  // Refresh "today", greetings and overdue states when the clock crosses a boundary.
  window.setInterval(checkClock, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkClock(); });
}

function checkClock() {
  const next = { day: todayKey(), greeting: greetingFor() };
  if (next.day !== clock.day || next.greeting !== clock.greeting) {
    clock = next;
    current?.inst?.update?.({ type: 'clock' });
  }
}

/* ---------- Welcome ---------- */

function onWelcomeComplete() {
  window.history.replaceState(null, '', '#/dashboard');
  showApp();
}

function showWelcome() {
  current?.inst?.destroy?.();
  current = null;
  $('view').innerHTML = '';
  $('app').hidden = true;
  $('welcome').hidden = false;
  resetWelcome();
  setPageTitle('');
  window.requestAnimationFrame(() => $('welcome-name').focus());
}

/* ---------- App shell ---------- */

function showApp() {
  $('welcome').hidden = true;
  $('app').hidden = false;
  if (!shellReady) {
    setupShell();
    shellReady = true;
  }
  updateShell();
  firstRoute = true;
  route();
}

function setupShell() {
  renderNav();
  window.addEventListener('hashchange', route);

  $('quick-add').addEventListener('click', (e) => openTaskModal({ trigger: e.currentTarget, ...contextDefaults() }));
  $('search-trigger').addEventListener('click', openSearch);
  $('profile-btn').addEventListener('click', () => navigate('settings'));
  $('sidebar-profile').addEventListener('click', () => navigate('settings'));

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if ($('app').hidden || document.querySelector('dialog[open]')) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if (e.key === '/') { e.preventDefault(); openSearch(); }
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openTaskModal({ trigger: document.activeElement, ...contextDefaults() }); }
  });
}

/** Quick add from the header uses the page's context (selected calendar date, open subject). */
function contextDefaults() {
  return current?.inst?.addDefaults?.() || {};
}

function openSearch() {
  if (current?.id === 'tasks' && current.inst.focusSearch) current.inst.focusSearch();
  else navigate('tasks?focus=search');
}

function updateShell() {
  const name = state.profile?.name || '';
  const ini = initials(name);
  $('sidebar-avatar').textContent = ini;
  $('topbar-avatar').textContent = ini;
  $('sidebar-name').textContent = name;
  $('sidebar-track').textContent = `${state.settings.examTrack} course`;
  $('profile-btn').setAttribute('aria-label', `${name}: profile and settings`);
}

function route() {
  if ($('app').hidden) return;
  const r = parseHash();
  if (!window.location.hash.startsWith(`#/${r.id}`)) {
    window.history.replaceState(null, '', `#/${r.id}`);
  }

  current?.inst?.destroy?.();
  const view = $('view');
  view.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'page-root';
  view.appendChild(root);

  current = { id: r.id, inst: PAGES[r.id](root, r) || {} };
  hydrateIcons(root);
  setActiveNav(r.id);
  setPageTitle(routeLabel(r.id));
  closeMoreSheet();
  window.scrollTo(0, 0);

  if (!firstRoute) {
    const heading = root.querySelector('h1');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
  }
  firstRoute = false;
}

/* ---------- Data changes ---------- */

function onDataChange(e) {
  if (e.type === 'reset') {
    showWelcome();
    return;
  }
  updateShell();
  if (!current?.inst?.update) return;

  // Re-render the page, then return focus to the equivalent control if the old one was replaced.
  const active = document.activeElement;
  const fk = active?.dataset?.fk;
  current.inst.update(e);
  hydrateIcons($('view'));
  if (fk && !active.isConnected) {
    const next = document.querySelector(`[data-fk="${CSS.escape(fk)}"]`);
    if (next) next.focus({ preventScroll: true });
  }
}

boot();
