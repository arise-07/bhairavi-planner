/**
 * welcome.js
 * First-run setup: the student's name and course (NEET, JEE or Custom).
 * For Custom, the student picks core subjects and can add their own.
 * The chosen course decides which subjects the dashboard, Subjects page and
 * task form show (see trackSubjects() in stats.js).
 */

import { state, setProfileName, updateSettings } from './state.js';
import { COURSES, TRACK_SUBJECTS, subjectColor } from './stats.js';
import { CORE_SUBJECTS } from './storage.js';
import { esc, prefersReducedMotion } from './utils.js';
import { icon } from './icons.js';

const MAX_OWN = 10;
const $ = (id) => document.getElementById(id);
let own = [];
let submitting = false;

const selectedCourse = () => document.querySelector('#course-options input:checked')?.value || '';
const pickedCore = () => [...document.querySelectorAll('#custom-core input:checked')].map((i) => i.value);

function showError(id, message, input = null) {
  const el = $(id);
  el.textContent = message;
  el.hidden = false;
  if (input) input.setAttribute('aria-invalid', 'true');
}

function clearError(id, input = null) {
  $(id).hidden = true;
  if (input) input.removeAttribute('aria-invalid');
}

function renderOwn() {
  $('welcome-own-list').innerHTML = own.map((s) => `<li class="chip"><i class="sdot" style="--c:${subjectColor(s)}" aria-hidden="true"></i>${esc(s)}<button type="button" class="chip-remove" data-remove="${esc(s)}" aria-label="Remove ${esc(s)}">${icon('x', { size: 13 })}</button></li>`).join('');
}

function syncCustomPanel() {
  $('custom-panel').hidden = selectedCourse() !== 'Custom';
}

function addOwnSubject() {
  const input = $('welcome-own-subject');
  const name = input.value.trim().replace(/\s+/g, ' ');
  if (!name) { input.focus(); return; }
  const all = [...CORE_SUBJECTS, ...own].map((s) => s.toLowerCase());
  if (all.includes(name.toLowerCase())) {
    showError('welcome-subjects-error', `${name} is already in the list.`);
  } else if (own.length >= MAX_OWN) {
    showError('welcome-subjects-error', `You can add up to ${MAX_OWN} subjects here. Add more later in Settings.`);
  } else {
    own.push(name);
    renderOwn();
    clearError('welcome-subjects-error');
  }
  input.value = '';
  input.focus();
}

export function initWelcome(onComplete) {
  $('course-options').innerHTML = COURSES.map((c) => `
    <label class="course-option">
      <input type="radio" name="course" value="${c.id}">
      <span class="course-card">
        <span class="course-top"><span class="course-title">${c.title}</span><span class="course-check" aria-hidden="true">${icon('check', { size: 12 })}</span></span>
        <span class="course-sub">${c.sub}</span>
        <span class="course-subjects">${c.id === 'Custom'
          ? '<span class="course-subject">Any subjects you pick</span>'
          : TRACK_SUBJECTS[c.id].map((s) => `<span class="course-subject"><i class="sdot" style="--c:${subjectColor(s)}" aria-hidden="true"></i>${s}</span>`).join('')}</span>
      </span>
    </label>`).join('');

  $('custom-core').innerHTML = CORE_SUBJECTS.map((s) => `
    <label class="chip-radio"><input type="checkbox" name="core" value="${s}" checked><span><i class="sdot" style="--c:${subjectColor(s)}" aria-hidden="true"></i>${s}</span></label>`).join('');

  const form = $('welcome-form');
  const name = $('welcome-name');

  name.addEventListener('input', () => clearError('welcome-name-error', name));
  form.addEventListener('change', (e) => {
    if (e.target.name === 'course') { clearError('welcome-course-error'); syncCustomPanel(); }
    if (e.target.name === 'core') clearError('welcome-subjects-error');
  });
  $('welcome-add-subject').addEventListener('click', addOwnSubject);
  $('welcome-own-subject').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addOwnSubject(); }
  });
  $('welcome-own-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    own = own.filter((s) => s !== btn.dataset.remove);
    renderOwn();
    $('welcome-own-subject').focus();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (submitting) return;

    const invalid = [];
    const studentName = name.value.trim();
    if (!studentName) { showError('welcome-name-error', 'Please enter your name.', name); invalid.push(name); }

    const course = selectedCourse();
    if (!course) { showError('welcome-course-error', 'Choose your course.'); invalid.push(document.querySelector('#course-options input')); }

    const core = pickedCore();
    if (course === 'Custom' && !core.length && !own.length) {
      showError('welcome-subjects-error', 'Pick at least one subject, or add your own.');
      invalid.push(document.querySelector('#custom-core input'));
    }
    if (invalid.length) { invalid[0].focus(); return; }

    submitting = true;
    $('welcome-submit').disabled = true;
    const patch = { examTrack: course };
    if (course === 'Custom') {
      patch.customTrackSubjects = core;
      patch.customSubjects = [...new Set([...state.settings.customSubjects, ...own])];
    }
    updateSettings(patch);
    setProfileName(studentName);

    const welcome = $('welcome');
    welcome.classList.add('is-leaving');
    window.setTimeout(() => {
      welcome.classList.remove('is-leaving');
      submitting = false;
      $('welcome-submit').disabled = false;
      onComplete();
    }, prefersReducedMotion() ? 0 : 220);
  });
}

/** Empty the form, e.g. after "Clear all data". */
export function resetWelcome() {
  $('welcome-form').reset();
  own = [];
  renderOwn();
  syncCustomPanel();
  ['welcome-name-error', 'welcome-course-error', 'welcome-subjects-error'].forEach((id) => clearError(id));
  $('welcome-name').removeAttribute('aria-invalid');
}
