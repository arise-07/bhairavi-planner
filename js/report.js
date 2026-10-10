/**
 * report.js
 * Downloadable progress report as a real PDF, built in the browser with no
 * library or network access (the logo is read from assets/logo-report.jpg).
 *
 * Uses the PDF standard fonts Helvetica / Helvetica-Bold with WinAnsi encoding,
 * so text is limited to Latin characters; anything else is shown as "?".
 * All figures come from progressStats() in stats.js, the same numbers shown
 * on the My Progress page.
 */

import { state } from './state.js';
import { progressStats, subjectColor, PRIORITY_LABEL } from './stats.js';
import { todayKey, parseDateKey, formatClock, MONTHS, MONTHS_SHORT, WEEKDAYS_SHORT, plural } from './utils.js';
import { toast, downloadBlob } from './ui.js';

/* ---------- Page geometry & colours (points, A4) ---------- */

const PW = 595.28;
const PH = 841.89;
const M = 40;
const CW = PW - 2 * M;
const FOOTER = 52;

const C = {
  ink: '#16161A',
  muted: '#5B5B66',
  faint: '#8A8A94',
  line: '#E4E4E8',
  soft: '#F4F4F6',
  track: '#E9E9EE',
  orange: '#F29B38',
  orangeSoft: '#F8CB97',
  success: '#2F8F62',
  danger: '#C93D3D',
  warning: '#B7791F',
  black: '#000000',
  white: '#FFFFFF',
};

/* ---------- Text encoding & measuring ---------- */

// Advance widths (1/1000 em) for characters 32–126.
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const HELV_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
const HIGH_WIDTHS = { 0x85: [1000, 1000], 0x91: [222, 278], 0x92: [222, 278], 0x93: [333, 500], 0x94: [333, 500], 0x95: [350, 350], 0x96: [556, 556], 0x97: [1000, 1000], 0xA0: [278, 278], 0xB7: [278, 278] };

// Unicode characters that exist in WinAnsi outside Latin-1.
const WIN_ANSI = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8A, '‹': 0x8B, 'Œ': 0x8C, 'Ž': 0x8E,
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9A, '›': 0x9B, 'œ': 0x9C, 'ž': 0x9E, 'Ÿ': 0x9F,
};

/** Convert any string to WinAnsi bytes (as a string of char codes 0–255). */
function toWinAnsi(value) {
  let out = '';
  for (const ch of String(value ?? '').normalize('NFC')) {
    const code = ch.codePointAt(0);
    if (code === 9 || code === 10 || code === 13) out += ' ';
    else if (code >= 32 && code < 127) out += ch;
    else if (code >= 160 && code <= 255) out += ch;
    else if (WIN_ANSI[ch]) out += String.fromCharCode(WIN_ANSI[ch]);
    else if (ch === '₹') out += 'Rs';
    else {
      const plain = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      out += /^[\x20-\x7e]+$/.test(plain) ? plain : '?';
    }
  }
  return out;
}

function charWidth(code, bold) {
  if (code >= 32 && code <= 126) return (bold ? HELV_BOLD : HELV)[code - 32];
  if (HIGH_WIDTHS[code]) return HIGH_WIDTHS[code][bold ? 1 : 0];
  return 556;
}

/** Width in points of an already-encoded string. */
function measure(enc, size, bold = false) {
  let w = 0;
  for (let i = 0; i < enc.length; i++) w += charWidth(enc.charCodeAt(i), bold);
  return (w * size) / 1000;
}

/** Shorten an encoded string with an ellipsis so it fits `maxW`. */
function fit(enc, size, bold, maxW) {
  if (measure(enc, size, bold) <= maxW) return enc;
  const ell = '\x85';
  let s = enc;
  while (s.length && measure(s + ell, size, bold) > maxW) s = s.slice(0, -1);
  return s.trimEnd() + ell;
}

const pdfEscape = (enc) => enc.replace(/[\\()]/g, (c) => `\\${c}`);
const num = (n) => (Math.round(n * 100) / 100).toString();
const rgb = (hex) => {
  const v = parseInt(hex.slice(1), 16);
  return `${num(((v >> 16) & 255) / 255)} ${num(((v >> 8) & 255) / 255)} ${num((v & 255) / 255)}`;
};

/* ---------- Drawing (top-left origin, y grows downward) ---------- */

class Doc {
  constructor(runningTitle) {
    this.pages = [];
    this.runningTitle = runningTitle;
    this.addPage();
  }

  addPage() {
    this.ops = [];
    this.pages.push(this.ops);
    this.y = M;
    if (this.pages.length > 1) {
      this.text(this.runningTitle, M, 28, { size: 8, color: C.faint });
      this.y = M + 8;
    }
  }

  /** Start a new page when fewer than `h` points remain. */
  ensure(h) {
    if (this.y + h > PH - FOOTER) this.addPage();
  }

  rect(x, y, w, h, fill) {
    this.ops.push(`${rgb(fill)} rg ${num(x)} ${num(PH - y - h)} ${num(w)} ${num(h)} re f`);
  }

  roundRect(x, y, w, h, r, fill) {
    const k = r * 0.4477;
    const b = PH - y - h;
    const t = PH - y;
    this.ops.push([
      `${rgb(fill)} rg`,
      `${num(x + r)} ${num(b)} m`,
      `${num(x + w - r)} ${num(b)} l`,
      `${num(x + w - k)} ${num(b)} ${num(x + w)} ${num(b + k)} ${num(x + w)} ${num(b + r)} c`,
      `${num(x + w)} ${num(t - r)} l`,
      `${num(x + w)} ${num(t - k)} ${num(x + w - k)} ${num(t)} ${num(x + w - r)} ${num(t)} c`,
      `${num(x + r)} ${num(t)} l`,
      `${num(x + k)} ${num(t)} ${num(x)} ${num(t - k)} ${num(x)} ${num(t - r)} c`,
      `${num(x)} ${num(b + r)} l`,
      `${num(x)} ${num(b + k)} ${num(x + k)} ${num(b)} ${num(x + r)} ${num(b)} c`,
      'f',
    ].join(' '));
  }

  line(x1, y1, x2, y2, color = C.line, width = 0.75) {
    this.ops.push(`${rgb(color)} RG ${num(width)} w ${num(x1)} ${num(PH - y1)} m ${num(x2)} ${num(PH - y2)} l S`);
  }

  /** Draw text with its baseline at `y`. Options: size, bold, color, align, maxW. */
  text(value, x, y, { size = 10, bold = false, color = C.ink, align = 'left', maxW = 0 } = {}) {
    let enc = toWinAnsi(value);
    if (maxW) enc = fit(enc, size, bold, maxW);
    const w = measure(enc, size, bold);
    const tx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${rgb(color)} rg ${num(tx)} ${num(PH - y)} Td (${pdfEscape(enc)}) Tj ET`);
  }

  image(x, y, w, h) {
    this.ops.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(PH - y - h)} cm /Im1 Do Q`);
  }
}

/* ---------- PDF file assembly ---------- */

function jpegInfo(bytes) {
  if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xFF) return null;
    const marker = bytes[i + 1];
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker)) {
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8], components: bytes[i + 9] };
    }
    i += 2 + len;
  }
  return null;
}

function pdfDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function assemble(pages, logo, title) {
  const objs = [];
  const add = (body) => { objs.push(body); return objs.length; };
  const catalogId = add('');
  const pagesId = add('');
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const imgId = logo
    ? add(`<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /${logo.components === 1 ? 'DeviceGray' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.data.length} >>\nstream\n${logo.data}\nendstream`)
    : 0;
  const infoId = add(`<< /Title (${pdfEscape(toWinAnsi(title))}) /Producer (Bhairavi Academy Study Planner) /CreationDate (${pdfDate(new Date())}) >>`);

  const resources = `<< /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >>${imgId ? ` /XObject << /Im1 ${imgId} 0 R >>` : ''} >>`;
  const kids = pages.map((ops) => {
    const content = ops.join('\n');
    const contentId = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    return add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources ${resources} /Contents ${contentId} 0 R >>`);
  });
  objs[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = objs.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xFF;
  return new Blob([bytes], { type: 'application/pdf' });
}

async function loadLogo() {
  try {
    const res = await fetch('assets/logo-report.jpg');
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const info = jpegInfo(bytes);
    if (!info) return null;
    let data = '';
    for (let i = 0; i < bytes.length; i += 0x8000) data += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { ...info, data };
  } catch {
    return null;
  }
}

/* ---------- Report sections ---------- */

const fmtDate = (key) => { const d = parseDateKey(key); return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`; };
const fmtDateTime = (iso) => { const d = new Date(iso); return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}, ${formatClock(d)}`; };

function header(doc, { name, track, today, logo }) {
  const H = 96;
  doc.rect(0, 0, PW, H, C.black);
  doc.rect(0, H, PW, 3, C.orange);
  if (logo) {
    const h = 60;
    doc.image(M - 10, (H - h) / 2, (h * logo.width) / logo.height, h);
  } else {
    doc.text('Bhairavi Academy', M, 54, { size: 20, bold: true, color: C.white });
  }
  doc.text('Progress Report', PW - M, 40, { size: 16, bold: true, color: C.white, align: 'right' });
  doc.text(name || 'Student', PW - M, 58, { size: 10.5, color: '#E4E4E8', align: 'right', maxW: 240 });
  doc.text(`${track} course  ·  ${fmtDate(today)}`, PW - M, 74, { size: 8.5, color: '#A1A1AA', align: 'right' });
  doc.y = H + 3 + 26;
}

/** `keep` is the space the section needs, so short sections never start at the bottom of a page. */
function sectionTitle(doc, title, note = '', keep = 64) {
  doc.ensure(Math.max(64, keep + 32));
  doc.text(title, M, doc.y + 12, { size: 12.5, bold: true });
  if (note) doc.text(note, PW - M, doc.y + 12, { size: 8.5, color: C.faint, align: 'right' });
  doc.line(M, doc.y + 20, PW - M, doc.y + 20);
  doc.y += 32;
}

function statBoxes(doc, boxes) {
  const cols = 4;
  const gap = 10;
  const w = (CW - gap * (cols - 1)) / cols;
  const h = 66;
  for (let i = 0; i < boxes.length; i += cols) {
    doc.ensure(h + gap);
    boxes.slice(i, i + cols).forEach((b, j) => {
      const x = M + j * (w + gap);
      const y = doc.y;
      doc.roundRect(x, y, w, h, 6, C.soft);
      doc.rect(x, y + 10, 2.5, h - 20, b.accent || C.orange);
      doc.text(b.label, x + 12, y + 18, { size: 8, color: C.muted, maxW: w - 20 });
      doc.text(b.value, x + 12, y + 41, { size: 19, bold: true, color: b.color || C.ink, maxW: w - 20 });
      doc.text(b.sub, x + 12, y + 56, { size: 7.5, color: C.faint, maxW: w - 20 });
    });
    doc.y += h + gap;
  }
  doc.y += 8;
}

function weekChart(doc, days, today) {
  const h = 128;
  doc.ensure(h + 10);
  const top = doc.y;
  doc.roundRect(M, top, CW, h, 6, C.soft);
  const max = Math.max(1, ...days.map((d) => d.count));
  const colW = CW / days.length;
  const barMax = 68;
  const base = top + 96;
  days.forEach((d, i) => {
    const cx = M + colW * i + colW / 2;
    const bh = d.count ? Math.max(4, (d.count / max) * barMax) : 0;
    const isToday = d.key === today;
    doc.rect(cx - 14, base - barMax, 28, barMax, C.track);
    if (bh) doc.rect(cx - 14, base - bh, 28, bh, isToday ? C.orange : C.orangeSoft);
    doc.text(String(d.count), cx, base - barMax - 6, { size: 9, bold: true, color: d.count ? C.ink : C.faint, align: 'center' });
    const date = parseDateKey(d.key);
    doc.text(isToday ? 'Today' : WEEKDAYS_SHORT[date.getDay()], cx, base + 14, { size: 8.5, bold: isToday, color: isToday ? C.ink : C.muted, align: 'center' });
    doc.text(`${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`, cx, base + 25, { size: 7.5, color: C.faint, align: 'center' });
  });
  doc.y = top + h + 18;
}

/**
 * columns: [{ title, w, align }]; rows: arrays of cells.
 * A cell is a string, or { text, color, bold }, or { pct } for a progress bar.
 */
function table(doc, columns, rows, empty) {
  const rowH = 21;
  const drawHead = () => {
    doc.rect(M, doc.y, CW, rowH, C.soft);
    let x = M;
    columns.forEach((c) => {
      const tx = c.align === 'right' ? x + c.w - 8 : x + 8;
      doc.text(c.title, tx, doc.y + 14, { size: 8, bold: true, color: C.muted, align: c.align === 'right' ? 'right' : 'left', maxW: c.w - 12 });
      x += c.w;
    });
    doc.y += rowH;
  };

  doc.ensure(rowH * 2);
  drawHead();
  if (!rows.length) {
    doc.text(empty.text, M + 8, doc.y + 15, { size: 9, color: empty.color || C.muted });
    doc.y += rowH + 4;
    doc.line(M, doc.y - 4, PW - M, doc.y - 4);
    doc.y += 14;
    return;
  }
  rows.forEach((cells) => {
    if (doc.y + rowH > PH - FOOTER) { doc.addPage(); drawHead(); }
    let x = M;
    cells.forEach((cell, i) => {
      const c = columns[i];
      const cellObj = typeof cell === 'object' && cell !== null ? cell : { text: cell };
      if (cellObj.pct !== undefined) {
        const barW = c.w - 52;
        doc.roundRect(x + 8, doc.y + 8, barW, 5, 2.5, C.track);
        if (cellObj.pct > 0) doc.roundRect(x + 8, doc.y + 8, Math.max(5, (barW * cellObj.pct) / 100), 5, 2.5, cellObj.color || C.orange);
        doc.text(`${cellObj.pct}%`, x + c.w - 8, doc.y + 14, { size: 9, bold: true, align: 'right' });
      } else {
        let tx = c.align === 'right' ? x + c.w - 8 : x + 8;
        if (cellObj.dot) {
          doc.roundRect(tx, doc.y + 7.5, 6, 6, 3, cellObj.dot);
          tx += 11;
        }
        doc.text(cellObj.text ?? '', tx, doc.y + 14, {
          size: 9, bold: !!cellObj.bold, color: cellObj.color || C.ink,
          align: c.align === 'right' ? 'right' : 'left', maxW: c.w - 16 - (cellObj.dot ? 11 : 0),
        });
      }
      x += c.w;
    });
    doc.y += rowH;
    doc.line(M, doc.y, PW - M, doc.y);
  });
  doc.y += 18;
}

const cols = (spec) => {
  const fixed = spec.reduce((n, c) => n + (c.w || 0), 0);
  const flex = spec.filter((c) => !c.w).length;
  return spec.map((c) => ({ ...c, w: c.w || (CW - fixed) / flex }));
};

function footer(doc) {
  const total = doc.pages.length;
  doc.pages.forEach((ops, i) => {
    doc.ops = ops;
    doc.line(M, PH - 38, PW - M, PH - 38);
    doc.text('Bhairavi Academy  ·  Study Planner', M, PH - 24, { size: 8, color: C.faint });
    doc.text(`Page ${i + 1} of ${total}`, PW - M, PH - 24, { size: 8, color: C.faint, align: 'right' });
  });
}

/* ---------- Build & download ---------- */

export async function buildProgressReport({ tasks, history, settings, profile }, today = todayKey()) {
  const s = progressStats({ tasks, history, settings }, today);
  const logo = await loadLogo();
  const name = profile?.name || '';
  const doc = new Doc(`Progress report  ·  ${name}  ·  ${fmtDate(today)}`);
  const o = s.overall;
  const upcoming = o.pending - o.overdue;

  header(doc, { name, track: settings.examTrack, today, logo });

  sectionTitle(doc, 'Overview', `${plural(o.total, 'task')} in the planner`);
  statBoxes(doc, [
    { label: 'Completion rate', value: `${o.pct}%`, sub: `${o.completed} of ${plural(o.total, 'task')} done` },
    { label: 'On-time completion', value: `${s.onTimePct}%`, sub: `${s.onTime} on time  ·  ${s.late} late`, accent: C.success },
    { label: 'Overdue now', value: String(o.overdue), sub: o.overdue ? 'Past due date, not done' : 'Nothing overdue', color: o.overdue ? C.danger : C.ink, accent: C.danger },
    { label: 'Pending', value: String(upcoming), sub: 'Due today or later', accent: C.muted },
    { label: 'Current streak', value: plural(s.streak.current, 'day'), sub: `Best: ${plural(s.streak.best, 'day')}` },
    { label: 'Completed this week', value: String(s.completedThisWeek), sub: `${fmtDate(s.weekStart)} – ${fmtDate(s.weekEnd)}` },
    { label: `${MONTHS[s.monthIndex]} completion`, value: `${s.month.pct}%`, sub: `${s.month.completed} of ${plural(s.month.total, 'task')} due this month` },
    { label: 'Completed today', value: String(s.completedToday), sub: fmtDate(today) },
  ]);

  sectionTitle(doc, 'Last 7 days', `${s.last7.reduce((n, d) => n + d.count, 0)} tasks completed`, 146);
  weekChart(doc, s.last7, today);

  sectionTitle(doc, 'Subject-wise progress');
  table(doc, cols([{ title: 'Subject' }, { title: 'Total', w: 52, align: 'right' }, { title: 'Done', w: 52, align: 'right' }, { title: 'Pending', w: 58, align: 'right' }, { title: 'Overdue', w: 58, align: 'right' }, { title: 'Completion', w: 150 }]),
    s.subjects.map((x) => [
      { text: x.name || 'No subject', dot: subjectColor(x.name) },
      String(x.total), String(x.completed), String(x.pending - x.overdue),
      { text: String(x.overdue), color: x.overdue ? C.danger : C.ink },
      { pct: x.pct },
    ]),
    { text: 'No tasks yet.' });

  sectionTitle(doc, 'By priority', '', 21 * 4 + 18);
  table(doc, cols([{ title: 'Priority' }, { title: 'Total', w: 52, align: 'right' }, { title: 'Done', w: 52, align: 'right' }, { title: 'Pending', w: 58, align: 'right' }, { title: 'Overdue', w: 58, align: 'right' }, { title: 'Completion', w: 150 }]),
    s.priorities.filter((p) => p.total).map((p) => [
      { text: PRIORITY_LABEL[p.priority], bold: p.priority === 'high' },
      String(p.total), String(p.completed), String(p.pending - p.overdue),
      { text: String(p.overdue), color: p.overdue ? C.danger : C.ink },
      { pct: p.pct },
    ]),
    { text: 'No tasks yet.' });

  sectionTitle(doc, 'Overdue tasks', s.overdue.length ? plural(s.overdue.length, 'task') : '');
  table(doc, cols([{ title: 'Task' }, { title: 'Subject', w: 100 }, { title: 'Priority', w: 62 }, { title: 'Due date', w: 82 }, { title: 'Days overdue', w: 78, align: 'right' }]),
    s.overdue.map((t) => [
      t.title, t.subject || 'No subject', PRIORITY_LABEL[t.priority], fmtDate(t.dueDate),
      { text: String(t.daysOverdue), color: C.danger, bold: true },
    ]),
    { text: 'No overdue tasks. Well done!', color: C.success });

  sectionTitle(doc, 'Recently completed', s.recent.length ? `Last ${s.recent.length}` : '');
  table(doc, cols([{ title: 'Task' }, { title: 'Subject', w: 92 }, { title: 'Due date', w: 78 }, { title: 'Completed', w: 120 }, { title: 'Status', w: 58 }]),
    s.recent.map((r) => [
      r.deleted ? `${r.title} (deleted)` : r.title, r.subject || 'No subject',
      r.dueDate ? fmtDate(r.dueDate) : '',
      fmtDateTime(r.completedAt),
      r.late ? { text: 'Late', color: C.warning, bold: true } : { text: 'On time', color: C.success, bold: true },
    ]),
    { text: 'No completed tasks yet.' });

  footer(doc);
  return assemble(doc.pages, logo, `Progress Report - ${name}`);
}

/** Build the PDF for the current student and download it. */
export async function downloadProgressReport(button = null) {
  if (button) button.disabled = true;
  try {
    const today = todayKey();
    const blob = await buildProgressReport(state, today);
    downloadBlob(blob, `bhairavi-progress-report-${today}.pdf`);
    toast('Progress report downloaded (PDF).', { type: 'success' });
  } catch (err) {
    console.error('[report]', err);
    toast('The progress report could not be created in this browser.', { type: 'error' });
  } finally {
    if (button) button.disabled = false;
  }
}
