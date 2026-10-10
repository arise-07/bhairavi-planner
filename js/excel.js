/**
 * excel.js
 * Builds a real .xlsx workbook in the browser (no library, no network) and downloads it.
 *
 * Sheets: Summary, All Tasks, Overdue, Pending, Completed.
 * Status uses the same rule as the rest of the app: a task is due until the end of its
 * due day, and becomes Overdue once that day has passed without it being completed.
 *
 * An .xlsx file is a ZIP of XML parts. Entries are stored uncompressed, which every
 * spreadsheet app accepts and keeps this file small.
 */

import { state } from './state.js';
import { compareByDue, taskStatus, PRIORITY_LABEL } from './stats.js';
import { diffDays, todayKey, plural } from './utils.js';
import { toast, downloadBlob } from './ui.js';

/* ---------- ZIP (stored, no compression) ---------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function zip(files) {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  const chunks = [];
  const central = [];
  let offset = 0;

  files.forEach(({ name, content }) => {
    const nameBytes = enc.encode(name);
    const data = enc.encode(content);
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034B50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, data);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014B50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, dosTime, true);
    dir.setUint16(14, dosDate, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, data.length, true);
    dir.setUint16(28, nameBytes.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), nameBytes);

    offset += 30 + nameBytes.length + data.length;
  });

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054B50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/* ---------- Cells ---------- */

// Characters XML 1.0 does not allow (control characters other than tab/newline/CR).
// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
const xml = (v) => String(v).replace(INVALID_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const colName = (i) => (i < 26 ? String.fromCharCode(65 + i) : colName(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));

// Style indexes in styles.xml (cellXfs).
const S = { text: 0, header: 1, date: 2, dateTime: 3, number: 4, overdue: 5, completed: 6, title: 7 };

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/** Excel serial number for a local "YYYY-MM-DD" date key. */
function dateSerial(key) {
  const [y, m, d] = key.split('-').map(Number);
  return (Date.UTC(y, m - 1, d) - EXCEL_EPOCH) / 86400000;
}

/** Excel serial number (with time of day) for an ISO timestamp, in local time. */
function dateTimeSerial(iso) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  const local = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate(), t.getHours(), t.getMinutes(), t.getSeconds());
  return (local - EXCEL_EPOCH) / 86400000;
}

/** A cell is { v, s } where v is a string, number or null. */
function cellXml(cell, ref) {
  if (cell == null || cell.v == null || cell.v === '') return cell?.s ? `<c r="${ref}" s="${cell.s}"/>` : '';
  const s = cell.s ? ` s="${cell.s}"` : '';
  if (typeof cell.v === 'number') return `<c r="${ref}"${s}><v>${cell.v}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xml(cell.v)}</t></is></c>`;
}

function sheetXml({ rows, widths, filter = false, freeze = false, selected = false }) {
  const lastCol = colName(Math.max(1, widths.length) - 1);
  const pane = freeze ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : '';
  const body = rows.map((row, r) => `<row r="${r + 1}">${row.map((c, i) => cellXml(c, `${colName(i)}${r + 1}`)).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"${selected ? ' tabSelected="1"' : ''}>${pane}</sheetView></sheetViews>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
<sheetData>${body}</sheetData>
${filter ? `<autoFilter ref="A1:${lastCol}${Math.max(1, rows.length)}"/>` : ''}
</worksheet>`;
}

/* ---------- Workbook content ---------- */

const STATUS_LABEL = { completed: 'Completed', overdue: 'Overdue', pending: 'Pending' };
const TASK_HEADERS = ['Title', 'Subject', 'Chapter / topic', 'Due date', 'Status', 'Days overdue', 'Priority', 'Completed on', 'Description'];
const TASK_WIDTHS = [42, 16, 26, 13, 12, 13, 10, 18, 50];

function taskRow(t, today) {
  const status = taskStatus(t, today);
  const completedOn = t.completedAt ? dateTimeSerial(t.completedAt) : null;
  return [
    { v: t.title },
    { v: t.subject || 'No subject' },
    { v: t.chapter },
    { v: dateSerial(t.dueDate), s: S.date },
    { v: STATUS_LABEL[status], s: status === 'overdue' ? S.overdue : status === 'completed' ? S.completed : S.text },
    { v: status === 'overdue' ? diffDays(t.dueDate, today) : null, s: S.number },
    { v: PRIORITY_LABEL[t.priority] },
    { v: completedOn, s: S.dateTime },
    { v: t.description },
  ];
}

function taskSheet(list, today) {
  return sheetXml({
    rows: [TASK_HEADERS.map((h) => ({ v: h, s: S.header })), ...list.map((t) => taskRow(t, today))],
    widths: TASK_WIDTHS,
    filter: true,
    freeze: true,
  });
}

function summarySheet({ name, today, all, overdue, pending, completed }) {
  const pct = all.length ? Math.round((completed.length / all.length) * 100) : 0;
  const rows = [
    [{ v: 'Bhairavi Study Planner: task report', s: S.title }],
    [],
    [{ v: 'Student', s: S.header }, { v: name || '' }],
    [{ v: 'Exported on', s: S.header }, { v: dateSerial(today), s: S.date }],
    [],
    [{ v: 'Total tasks', s: S.header }, { v: all.length, s: S.number }],
    [{ v: 'Completed', s: S.header }, { v: completed.length, s: S.number }],
    [{ v: 'Pending (due today or later)', s: S.header }, { v: pending.length, s: S.number }],
    [{ v: 'Overdue (past due date, not done)', s: S.header }, { v: overdue.length, s: S.number }],
    [{ v: 'Completion rate', s: S.header }, { v: `${pct}%` }],
    [],
    [{ v: 'A task is due until the end of its due date. If it is not completed by then, it is listed as Overdue.' }],
  ];
  return sheetXml({ rows, widths: [34, 22], selected: true });
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="dd mmm yyyy"/><numFmt numFmtId="165" formatCode="dd mmm yyyy hh:mm"/></numFmts>
<fonts count="5">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFB42318"/><name val="Calibri"/></font>
<font><sz val="11"/><color rgb="FF067647"/><name val="Calibri"/></font>
<font><b/><sz val="14"/><name val="Calibri"/></font>
</fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3E3CF"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** Build the workbook Blob for the given tasks. */
export function buildTasksWorkbook({ tasks, name = '', today = todayKey() }) {
  const all = tasks.slice().sort(compareByDue);
  const overdue = all.filter((t) => taskStatus(t, today) === 'overdue');
  const pending = all.filter((t) => taskStatus(t, today) === 'pending');
  const completed = all.filter((t) => t.completed)
    .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));

  const sheets = [
    { title: 'Summary', xml: summarySheet({ name, today, all, overdue, pending, completed }) },
    { title: 'All Tasks', xml: taskSheet(all, today), rows: all.length },
    { title: 'Overdue', xml: taskSheet(overdue, today), rows: overdue.length },
    { title: 'Pending', xml: taskSheet(pending, today), rows: pending.length },
    { title: 'Completed', xml: taskSheet(completed, today), rows: completed.length },
  ];

  const lastCol = colName(TASK_HEADERS.length - 1);
  const definedNames = sheets
    .map((s, i) => (s.rows === undefined ? '' : `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${s.title}'!$A$1:$${lastCol}$${s.rows + 1}</definedName>`))
    .join('');

  const files = [
    {
      name: '[Content_Types].xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
</Types>`,
    },
    {
      name: '_rels/.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets.map((s, i) => `<sheet name="${xml(s.title)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
<definedNames>${definedNames}</definedNames>
</workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    { name: 'xl/styles.xml', content: STYLES },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, content: s.xml })),
  ];

  return zip(files);
}

/** Build and download the workbook. Returns the counts used in the confirmation toast. */
function downloadTasksWorkbook({ tasks, name }) {
  const today = todayKey();
  downloadBlob(buildTasksWorkbook({ tasks, name, today }), `bhairavi-tasks-${today}.xlsx`);
  return {
    total: tasks.length,
    overdue: tasks.filter((t) => taskStatus(t, today) === 'overdue').length,
  };
}

/** Download every task as an Excel workbook (Summary, All, Overdue, Pending, Completed sheets). */
export function exportTasksToExcel() {
  if (!state.tasks.length) {
    toast('There are no tasks to export yet.', { type: 'error' });
    return;
  }
  try {
    const { total, overdue } = downloadTasksWorkbook({ tasks: state.tasks, name: state.profile?.name });
    toast(`Excel file downloaded with ${plural(total, 'task')}${overdue ? ` (${overdue} overdue)` : ''}.`, { type: 'success' });
  } catch {
    toast('The Excel file could not be created in this browser.', { type: 'error' });
  }
}
