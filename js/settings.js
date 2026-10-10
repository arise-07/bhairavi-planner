/**
 * settings.js
 * Profile, preferences, custom subjects and the student's data: progress report
 * (PDF), task spreadsheet (Excel), backup file for moving devices, and clear all.
 */

import {
  state, setProfileName, updateSettings, addCustomSubject, removeCustomSubject, importData,
  removeDemoData, hasDemoData, clearAllData,
} from './state.js';
import { buildBackup, parseBackup, storageUsageBytes, storageAvailable, CORE_SUBJECTS } from './storage.js';
import { subjectColor } from './stats.js';
import { todayKey, esc, plural, formatMoment } from './utils.js';
import { toast, confirmDialog, downloadBlob } from './ui.js';
import { icon } from './icons.js';
import { exportTasksToExcel } from './excel.js';
import { downloadProgressReport } from './report.js';

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export function mountSettings(root) {
  root.innerHTML = `
  <div class="page page-settings">
    <header class="page-head">
      <div>
        <h1 class="page-title">Settings</h1>
      </div>
    </header>

    <div class="settings-grid">
      <section class="card settings-section" aria-labelledby="set-profile-title">
        <h2 class="card-title" id="set-profile-title">Profile</h2>
        <form class="name-form" id="name-form" novalidate>
          <div class="field grow">
            <label class="field-label" for="set-name">Your name</label>
            <input id="set-name" class="input" type="text" maxlength="40" autocomplete="given-name" aria-describedby="set-name-error">
            <p class="field-error" id="set-name-error" hidden></p>
          </div>
          <button type="submit" class="btn btn-secondary">Save name</button>
        </form>
        <div class="field">
          <label class="field-label" for="set-track">Course</label>
          <select id="set-track" class="input select" data-setting="examTrack">
            <option value="NEET">NEET</option><option value="JEE">JEE</option><option value="Custom">Custom</option>
          </select>
        </div>
        <fieldset class="field" id="set-custom-wrap" hidden>
          <legend class="field-label">Custom course subjects</legend>
          <div class="chip-group">${CORE_SUBJECTS.map((s) => `<label class="chip-radio"><input type="checkbox" data-core="${s}"><span><i class="sdot" style="--c:${subjectColor(s)}" aria-hidden="true"></i>${s}</span></label>`).join('')}</div>
          <p class="field-hint">Add other subjects under Custom subjects.</p>
        </fieldset>
      </section>

      <section class="card settings-section" aria-labelledby="set-pref-title">
        <h2 class="card-title" id="set-pref-title">Preferences</h2>
        <div class="field-grid field-grid-2">
          <div class="field">
            <label class="field-label" for="set-week">Week starts on</label>
            <select id="set-week" class="input select" data-setting="weekStartsOn">
              <option value="0">Sunday</option><option value="1">Monday</option>
            </select>
          </div>
          <div class="field">
            <label class="field-label" for="set-calview">Calendar view</label>
            <select id="set-calview" class="input select" data-setting="calendarView">
              <option value="month">Month grid</option><option value="agenda">Agenda list</option>
            </select>
          </div>
        </div>
        <div class="switch-list">
          <label class="switch-row">
            <span class="switch-text"><span class="switch-title">Confirm before deleting tasks</span><span class="field-hint">When off, you can Undo a delete for a few seconds.</span></span>
            <input type="checkbox" class="switch" data-setting="confirmDelete">
          </label>
        </div>
      </section>

      <section class="card settings-section" aria-labelledby="set-subjects-title">
        <div class="section-head">
          <h2 class="card-title" id="set-subjects-title">Custom subjects</h2>
          <p class="card-sub">For example Mock Tests or English.</p>
        </div>
        <ul class="chip-list" id="custom-subjects"></ul>
        <form class="name-form" id="subject-form" novalidate>
          <div class="field grow">
            <label class="field-label" for="new-subject">New subject</label>
            <input id="new-subject" class="input" type="text" maxlength="40" placeholder="e.g. Mock Tests" autocomplete="off" aria-describedby="new-subject-error">
            <p class="field-error" id="new-subject-error" hidden></p>
          </div>
          <button type="submit" class="btn btn-secondary">${icon('plus', { size: 16 })}Add</button>
        </form>
      </section>

      <section class="card settings-section" aria-labelledby="set-data-title">
        <div class="section-head">
          <h2 class="card-title" id="set-data-title">Your data</h2>
          <p class="card-sub" id="data-meta"></p>
        </div>
        <div class="data-rows">
          <div class="data-row">
            <div><p class="data-title">Progress report</p><p class="field-hint">Your statistics as a PDF to keep or share.</p></div>
            <button type="button" class="btn btn-primary" data-action="report">${icon('download', { size: 16 })}Download PDF</button>
          </div>
          <div class="data-row">
            <div><p class="data-title">Task spreadsheet</p><p class="field-hint">All tasks as an Excel file.</p></div>
            <button type="button" class="btn btn-secondary" data-action="excel">${icon('file-spreadsheet', { size: 16 })}Export Excel</button>
          </div>
          <div class="data-row">
            <div><p class="data-title">Backup file</p><p class="field-hint">Save a backup to move your planner to another device.</p></div>
            <div class="data-actions">
              <button type="button" class="btn btn-secondary" data-action="export">${icon('download', { size: 16 })}Save</button>
              <button type="button" class="btn btn-secondary" data-action="import">${icon('upload', { size: 16 })}Restore</button>
            </div>
            <input type="file" id="import-file" accept="application/json,.json" hidden>
          </div>
          <div class="data-row" id="demo-row" hidden>
            <div><p class="data-title">Sample tasks</p><p class="field-hint" id="demo-hint"></p></div>
            <button type="button" class="btn btn-secondary" data-action="remove-demo">${icon('trash', { size: 16 })}Remove samples</button>
          </div>
          <div class="data-row data-row-danger">
            <div><p class="data-title">Clear all data</p><p class="field-hint">Delete everything from this device.</p></div>
            <button type="button" class="btn btn-danger-outline" data-action="clear">${icon('trash', { size: 16 })}Clear data</button>
          </div>
        </div>
      </section>
    </div>
  </div>`;

  const $ = (sel) => root.querySelector(sel);

  /* ---- Name ---- */
  $('#name-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#set-name');
    const err = $('#set-name-error');
    if (!input.value.trim()) {
      err.textContent = 'Your name cannot be empty.';
      err.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    if (input.value.trim() === state.profile?.name) { toast('Name is unchanged.', { duration: 2000 }); return; }
    setProfileName(input.value);
    toast('Name updated.', { type: 'success', duration: 2500 });
  });
  $('#set-name').addEventListener('input', () => { $('#set-name-error').hidden = true; $('#set-name').removeAttribute('aria-invalid'); });

  /* ---- Preferences ---- */
  root.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.core) {
      const picked = [...root.querySelectorAll('[data-core]:checked')].map((i) => i.dataset.core);
      updateSettings({ customTrackSubjects: picked });
      toast('Saved.', { duration: 1500 });
      return;
    }
    if (!el.dataset.setting) return;
    const key = el.dataset.setting;
    let value;
    if (el.type === 'checkbox') value = el.checked;
    else if (key === 'weekStartsOn') value = Number(el.value);
    else value = el.value;
    updateSettings({ [key]: value });
    toast('Saved.', { duration: 1500 });
  });

  /* ---- Custom subjects ---- */
  $('#subject-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#new-subject');
    const err = $('#new-subject-error');
    const name = input.value.trim();
    if (!name) {
      err.textContent = 'Enter a subject name.';
      err.hidden = false;
      input.focus();
      return;
    }
    const exists = state.settings.customSubjects.some((s) => s.toLowerCase() === name.toLowerCase());
    addCustomSubject(name);
    input.value = '';
    err.hidden = true;
    toast(exists ? `${name} is already in your subjects.` : `${name} added.`, { duration: 2200 });
    input.focus();
  });

  /* ---- Actions ---- */
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'remove-subject') {
      removeCustomSubject(btn.dataset.subject);
      toast(`${btn.dataset.subject} removed. Existing tasks keep this label.`, { duration: 2500 });
    }
    if (action === 'report') downloadProgressReport(btn);
    if (action === 'excel') exportTasksToExcel();
    if (action === 'export') exportBackup();
    if (action === 'import') $('#import-file').click();
    if (action === 'remove-demo') removeSamples();
    if (action === 'clear') clearEverything();
  });

  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await importBackup(file);
  });

  function exportBackup() {
    try {
      const blob = new Blob([JSON.stringify(buildBackup(state), null, 2)], { type: 'application/json' });
      downloadBlob(blob, `bhairavi-planner-backup-${todayKey()}.json`);
      toast('Backup saved. Use Restore on the other device to load it.', { type: 'success' });
    } catch {
      toast('The backup could not be created in this browser.', { type: 'error' });
    }
  }

  async function importBackup(file) {
    if (file.size > MAX_IMPORT_BYTES) {
      toast('This file is too large to be a planner backup.', { type: 'error' });
      return;
    }
    let text;
    try { text = await file.text(); } catch {
      toast('The file could not be read.', { type: 'error' });
      return;
    }
    const parsed = parseBackup(text);
    if (!parsed.ok) {
      toast(parsed.error, { type: 'error', duration: 6000 });
      return;
    }
    const { summary, data } = parsed;
    const from = data.exportedAt ? ` from ${formatMoment(data.exportedAt)}` : '';
    const skipped = summary.skipped ? ` ${plural(summary.skipped, 'invalid record')} will be skipped.` : '';
    const result = await confirmDialog({
      title: 'Restore this backup?',
      message: `The backup${from} has ${plural(summary.tasks, 'task')}.${skipped} Merge adds tasks that are not already here. Replace overwrites your current tasks and history.`,
      confirmLabel: 'Replace',
      secondaryLabel: 'Merge',
      danger: true,
    });
    if (result === 'confirm') {
      const n = importData(data, 'replace');
      toast(`Restored. ${plural(n, 'task')} loaded.`, { type: 'success' });
    } else if (result === 'secondary') {
      const n = importData(data, 'merge');
      toast(n ? `${plural(n, 'new task')} added.` : 'No new tasks: everything in the backup was already here.', { type: 'success' });
    }
  }

  async function removeSamples() {
    const r = await confirmDialog({
      title: 'Remove sample tasks?',
      message: 'All sample tasks and their history will be removed. Your own tasks are not affected.',
      confirmLabel: 'Remove samples',
      danger: true,
    });
    if (r === 'confirm') { removeDemoData(); toast('Sample tasks removed.', { type: 'success' }); }
  }

  async function clearEverything() {
    const r = await confirmDialog({
      title: 'Clear all planner data?',
      message: `This permanently deletes your name, ${plural(state.tasks.length, 'task')}, history and settings from this device. Download a backup first if you may need them.`,
      confirmLabel: 'Clear everything',
      danger: true,
      requireText: 'CLEAR',
    });
    if (r === 'confirm') clearAllData();
  }

  /* ---- Render ---- */
  function fillFields() {
    const s = state.settings;
    const set = (el, v) => { if (document.activeElement !== el) el.value = v; };
    if (document.activeElement !== $('#set-name')) $('#set-name').value = state.profile?.name || '';
    set($('#set-track'), s.examTrack);
    $('#set-custom-wrap').hidden = s.examTrack !== 'Custom';
    root.querySelectorAll('[data-core]').forEach((i) => { i.checked = s.customTrackSubjects.includes(i.dataset.core); });
    set($('#set-week'), String(s.weekStartsOn));
    set($('#set-calview'), s.calendarView);
    root.querySelector('[data-setting="confirmDelete"]').checked = s.confirmDelete;
  }

  function update() {
    fillFields();
    const subs = state.settings.customSubjects;
    $('#custom-subjects').innerHTML = subs.length
      ? subs.map((s) => `<li class="chip">${esc(s)}<button type="button" class="chip-remove" data-action="remove-subject" data-subject="${esc(s)}" aria-label="Remove ${esc(s)}">${icon('x', { size: 13 })}</button></li>`).join('')
      : '<li class="chip-empty">No custom subjects yet.</li>';

    const demoCount = state.tasks.filter((t) => t.demo).length;
    $('#demo-row').hidden = !hasDemoData();
    $('#demo-hint').textContent = `${plural(demoCount, 'sample task')} from an earlier version of the planner.`;

    const kb = Math.max(1, Math.round(storageUsageBytes() / 1024));
    $('#data-meta').textContent = storageAvailable
      ? `${plural(state.tasks.length, 'task')} saved on this device (about ${kb} KB).`
      : 'Browser storage is unavailable. Changes will be lost when you close this tab.';
  }

  update();
  return { update };
}
