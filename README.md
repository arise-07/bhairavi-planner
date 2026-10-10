# Bhairavi Study Planner

A study planner for Bhairavi Academy NEET and JEE students. Plain HTML, CSS and vanilla JavaScript (ES modules). Data is saved in the browser with `localStorage`. No framework, no backend, no build step.

## Run it locally

The app uses ES modules, so it must be served over HTTP. Opening `index.html` directly (`file://`) will not work.

```bash
cd bhairavi-study-planner
npx serve .            # or: python3 -m http.server 5500
```

Then open the printed URL (for example http://localhost:3000 or http://localhost:5500). The VS Code "Live Server" extension also works.

**Deploy:** drag the folder into Netlify, or push to GitHub and import it on Vercel as a static site (no build command, output directory `.`). Routing is hash-based (`#/calendar`), so no rewrite rules are needed.

## File structure

```
bhairavi-study-planner/
├── index.html            App shell, welcome screen, task modal, confirm dialog
├── css/
│   ├── style.css         Design tokens and every component
│   └── responsive.css    Tablet (icon rail), mobile (bottom nav), small-mobile rules
├── js/
│   ├── app.js            Entry point: boot, routing, re-render on data change
│   ├── welcome.js        First-run setup: name and course (NEET, JEE, Custom)
│   ├── navigation.js     Hash router, sidebar, bottom nav, mobile "More" sheet
│   ├── storage.js        localStorage keys, validation, safe writes, backup import/export
│   ├── state.js          In-memory store and all data mutations (single source of truth)
│   ├── stats.js          Derived numbers: overdue, streaks, monthly and subject stats
│   ├── utils.js          Local-date helpers, formatting, ids, HTML escaping
│   ├── ui.js             Toasts, confirm dialog, task row and empty-state builders
│   ├── modal.js          Add/Edit Task dialog, delete flow, global task actions
│   ├── icons.js          Inline Lucide SVG icons
│   ├── dashboard.js      Dashboard page
│   ├── calendar.js       Month math, Monthly Calendar page, compact calendar
│   ├── tasks.js          My Tasks page (search, views, filters, sorting)
│   ├── subjects.js       Subjects overview and subject detail
│   ├── progress.js       My Progress page
│   ├── settings.js       Settings page, downloads, backup restore, clear data
│   ├── report.js         Progress report PDF, built in the browser with no library
│   └── excel.js          Excel (.xlsx) export, built in the browser with no library
└── assets/
    ├── logo.png          Original Bhairavi Academy logo (source for the files below)
    ├── logo-full.png     Full logo, transparent (welcome screen, sidebar)
    ├── logo-mark.png     "B" mark only, transparent (mobile top bar, narrow sidebar)
    ├── favicon.svg       Browser tab icon: calendar with a check mark on orange
    ├── favicon-32.png    Tab icon PNG fallback (32px); favicon.png is the 192px version
    ├── apple-touch-icon.png  Home-screen icon for iPhone and iPad (180px, square)
    └── logo-report.jpg   Full logo on black (PDF report header)
```

Icons are inline SVG in `js/icons.js` instead of an `assets/icons/` folder, so there are no extra requests.

Every page module exports `mountX(root, route)` and returns `{ update() }`. Pages read from `state` and call functions in `state.js` to change data. This maps directly to React components plus a store or context, and `storage.js` is the only file that would change to call an API.

## Features

- **Welcome (setup):** name and course: NEET (Physics, Chemistry, Biology), JEE (Physics, Chemistry, Mathematics) or Custom (pick any core subjects and add your own). Validated, saved locally, then opens the dashboard.
- **Dashboard:** live summary cards (today's tasks, completed, overdue, streak), My Subjects tiles for the chosen course (completion %, done and overdue counts), today's plan with progress bar and all-done state, overdue notice, high-priority tasks, deadlines for the next 7 days, recent completions, and a compact calendar that opens the full calendar on the chosen date.
- **Monthly Calendar:** correct month grids (28–31 days, leap years, adjacent-month days), today and selected-date highlights, task titles on desktop and status dots on mobile, previous/next/Today, arrow-key and PageUp/PageDown navigation, a selected-date panel with add/complete/edit/delete, a monthly summary, and an Agenda view.
- **My Tasks:** instant search across title, description, subject and chapter; All, Today, Upcoming, Overdue and Completed views with counts; subject, priority, status and due-date filters; four sort orders. Filters never change stored data. **Export to Excel** downloads every task as an .xlsx file.
- **Add/Edit Task modal:** reachable from every page. Preselects the date (calendar) or subject (subject view). Validates required fields. Escape and backdrop clicks ask before discarding unsaved changes. Focus is trapped and returned to the trigger.
- **Subjects:** NEET, JEE and Custom tracks, plus Revision, Personal and your own subjects. Cards show real stats. The detail view groups tasks by chapter and lists deadlines and completions.
- **My Progress:** statistics: completion rate, on-time completion rate, overdue, pending, current and best streak, completed this week and today, this month's completion rate, a 7-day chart, subject-wise and priority breakdowns, overdue tasks and recent completions. **Download Report (PDF)** saves the same statistics as a readable report with the Academy logo.
- **Settings:** name, course (and Custom course subjects), week start, calendar view, delete confirmation, custom subjects, and Your data: progress report (PDF), task spreadsheet (Excel), backup file to move to another device (save, then restore with merge or replace), and clear all data (requires typing CLEAR).
- **Shortcuts:** `/` opens task search and `n` adds a task.

## Data model

| Key | Contents |
| --- | --- |
| `bhairavi_profile_v1` | `{ name, createdAt }` |
| `bhairavi_tasks_v1` | Array of tasks (below) |
| `bhairavi_settings_v1` | Preferences and custom subjects |
| `bhairavi_completion_history_v1` | Completion events `{ id, taskId, title, subject, dueDate, completedAt }` |

Task:

```js
{
  id, title, description, subject, chapter,
  dueDate: 'YYYY-MM-DD',   // local calendar date, never converted through UTC
  priority: 'low' | 'medium' | 'high',
  completed, createdAt, updatedAt, completedAt  // ISO timestamps
}
```

Data is validated every time it loads. If one record has a bad optional field, only that field falls back to a default; a record is skipped only when it cannot be recovered (for example, a task with no title). Duplicate ids are dropped. Failed writes show an error message.

## Rules the app follows

- **Overdue:** a task has no due time. It is due until the end of its due date. If it is not completed by then, it moves to Overdue (not completed and due date before today). The app rechecks the date every 30 seconds, so this happens at midnight without a refresh.
- **Excel export:** an .xlsx file with Summary, All Tasks, Overdue (with days overdue), Pending and Completed sheets. Dates are real Excel dates, headers are frozen and filterable, and cell text is never treated as a formula.
- **Monthly statistics:** count tasks *due* in the month.
- **Completed today / this week:** count tasks by the date they were ticked.
- **Streak:** consecutive days with at least one completed task. Before you complete a task today, the streak through yesterday still counts.
- **Reopening a task:** removes its completion from history.
- **Deleting a completed task:** keeps its completion in history, because the work happened.
- **On-time completion:** a completed task counts as on time when it was ticked on or before its due date.
- **Progress report:** every number in the PDF comes from the same function (`progressStats` in `stats.js`) as the My Progress page.

## Known limitations

- Data lives in one browser on one device. There is no sync or account. Use Export/Import to move data.
- The name is a convenience label, not authentication. Anyone using the same browser sees the same planner.
- Clearing browser data, or using some private windows, erases or disables storage. A banner appears if storage is unavailable.
- The Inter font loads from Google Fonts. When offline, the app falls back to the system font and otherwise works fully.
- The PDF report uses the standard PDF fonts, which only cover Latin letters. Text in other scripts (for example Hindi) appears as "?" in the PDF; it shows normally in the app and in the Excel file.
- The Focus Room (timer) was removed. Old focus-session data is not shown, and "Clear all data" still removes it.

## Testing checklist

1. First visit shows the welcome screen. An empty or space-only name shows an error. A valid name opens the dashboard with the right greeting.
2. Refresh: the dashboard opens directly and the name is kept.
3. Add a task from the header, dashboard, calendar (date preselected), My Tasks and a subject page (subject preselected).
4. Try to save with no title. It is blocked with a message.
5. Type in the modal and press Escape. It asks before discarding.
6. Tick a task on the dashboard. The progress bar, stat cards, calendar dot, subject card and progress page all update. Untick it and the history entry is removed.
7. Edit a task and change its date. It moves on the calendar.
8. Delete a task. Confirm it, and check it disappears everywhere. Turn off delete confirmation in Settings, delete, and use Undo.
9. Calendar: previous/next across December to January, Today, select dates, arrow keys, Agenda view, February in a leap year (2028).
10. My Tasks: search, each view tab, each filter, each sort, Clear filters, and the no-results message.
11. Subjects: switch NEET, JEE and Custom. Open a subject and filter by Pending and Completed.
12. My Progress: check the statistics, then Download Report (PDF) and open it. The logo, numbers, subject table and overdue list should match the page.
13. Settings: change the name (tasks unchanged), set the week to start Monday (calendar updates), export to Excel (open the file and check the Overdue sheet), save a backup, restore it with Merge (no duplicates), restore an invalid file (rejected), and clear all data (requires typing CLEAR, then returns to the welcome screen).
14. Resize to about 390px wide. Check the bottom nav, the More menu, compact calendar cells, the bottom-sheet modal, and that nothing scrolls sideways.
15. Keep DevTools open throughout. The console should show no errors.
