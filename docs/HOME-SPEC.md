# Home spec: a cockpit page and a regrouped sidebar

Status: **built** (H1, H2 and H3), 2026-11-25; waiting for review and merge. The behaviour now lives in `docs/SPEC.md` §4.10 and Part 5 (Phase F); this file is the history of the decision. Where the build differs from the text below is listed in `docs/PROGRESS.md` under "Decisions to review" (the main one: §3.1 says no migration is needed, but prefs are columns, so migration 0010 adds two).

**What this is.** A new Home page that answers "what needs me right now?" across personal tasks and GitHub work, plus a sidebar regrouped around it. It is the written form of the clickable prototype the maintainer reviewed on 2026-11-24/25 (a private canvas, not in this repository). Where the prototype and this spec differ, this spec wins; the differences are listed in §7.

`docs/SPEC.md` §0.2 applies to every milestone: fictional data only (`acme/widgets`), one test per behaviour, mocks only for GitHub, and `SPEC.md` is updated when behaviour it describes changes. When H1 lands, this spec's content moves into `SPEC.md` as §4.10 "Home" and a Part 5 entry, and this file is kept only as the history of the decision.

---

## 0. Decisions to review

Each is the spec's default until the maintainer says otherwise. Marked **[Default]** where it appears below.

| # | Question | Default |
|---|---|---|
| H-A | Where does Deska open? | **Home**, for everyone, tasks-only mode included. Settings → General → "Start page" offers Home, My issues, Today. |
| H-B | Do the sprint tile and panel follow the default team scope? | **Yes**, like the sprint page: the scope chip shows on the panel and can be turned off there. |
| H-C | What is in the "Today" tab of My work? | **Tasks only** (due today or earlier). A task linked to an issue shows the issue's number and Status on its row. Issues have their own tab, "This sprint". |
| H-D | Can the sidebar groups be reordered? | **No.** Tasks, then GitHub. Inside a group the sub-sections reorder and any section can be hidden, as today. |
| H-E | When is one of my issues "quiet" (H2, Needs attention)? | Open, assigned to me, not updated for **14 days**. |
| H-F | Version | H1 ships as **1.5.0**; H2 and H3 as 1.5.x. |

---

## 1. Goals and non-goals

**Goals**
- One page that shows, without a click: what is due today, what is mine in the sprint, how the sprint is going, and what is waiting on me (triage, watched changes).
- Every number and row on Home leads to the page that owns it. Home summarises; it does not replace a page.
- Nothing in today's sidebar is lost. The sidebar gets a clearer shape: Home and the three most-used issue lists at the top, then a Tasks group and a GitHub group.

**Non-goals**
- No new GitHub calls and no new synced data. Home reads only what the client already has (the issue payload, tasks, watches, triage counts).
- No editing of issues from Home. The only change Home makes is completing a local task (with Undo), and opening existing dialogs (quick add, create issue, Plan my day).
- No AI run on its own: "Plan my day" runs only when clicked (SPEC §1.3, §4.9).
- No activity feed for the whole repository, no GitHub notifications inbox (fine-grained tokens cannot read them), no charts library, no multi-user panels (workload, members).

---

## 2. Sidebar

### 2.1 Layout

From top to bottom. Items in *italics* are unchanged from today and only move.

1. *Header*: project title and repository, New issue (+), notification bell. *Search or jump to… ⌘K.*
2. **Primary list**, no heading:
   - **Home** (new, `G H`).
   - *Triage* (count), *My issues* (count), *Watching* (unseen count). Hidden in tasks-only mode, as today.
3. **Tasks** group. The heading carries the existing Tasks actions: Ramble, Save view, New task.
   - *Inbox, Today, Upcoming, Completed*, then every *saved task view*.
   - *Projects* sub-section: + New project, the projects, *Archived* (collapsed).
   - *Labels* sub-section: + New label, the labels.
4. **GitHub** group. Hidden in tasks-only mode.
   - *All issues, Backlog, Releases, Current · \<sprint\>, Epics, Insights*. Backlog, Releases and Current show only with a mapped Sprint field, as today.
   - *Views* sub-section: + New view, every saved issue view (list, board or table icon).
   - *\<Dimension name\>* sub-section (today's "teams" section): the mapped dimension's options.
5. *Footer*: sync status, Shortcuts, Customize, user menu.

Drag-and-drop targets (Inbox, Today, Upcoming, projects, labels) keep working exactly as today.

### 2.2 Model

- The section IDs stay the same (`tasks`, `projects`, `labels`, `workspace`, `views`, `teams` in `lib/tasks/model.ts`), so stored layouts in `user_prefs.sidebar` stay valid and no migration is needed.
- A fixed map assigns sections to groups: Tasks = `tasks`, `projects`, `labels`; GitHub = `workspace`, `views`, `teams`. `tasks` and `workspace` are each group's lead: always first in the group, with no sub-heading (the group heading names them). **[Default H-D]**
- `resolveSidebar` keeps returning one ordered list; the sidebar partitions it by group, keeping the stored relative order of the non-lead sections. A stored order that put a GitHub section before a Tasks section is read as "Tasks first" without rewriting the stored value.
- Hiding: any section can be hidden in Customize, as today. A group heading shows only while at least one of its sections is visible.
- Customize sidebar shows the two groups as two lists; up/down moves a sub-section within its group only.

### 2.3 Tests
- Unit (`tests/tasks/`): the group partition keeps relative order, ignores cross-group order, keeps leads first, and hides a group whose sections are all hidden.
- e2e: update `sidebar-identity.spec.ts` and `task-views.spec.ts` for the new headings; extend `views.spec.ts` to create a view from the Views "+"; tasks-only mode shows no Triage/My issues/Watching and no GitHub group.

---

## 3. H1 — Home page

### 3.1 Route and start page
- New route `/home` (`app/(app)/home/page.tsx`, page component in `components/pages/home.tsx`).
- `/` redirects by the start page: Home → `/home`, My issues → `/my`, Today → `/tasks/today`. **[Default H-A]** Home is the default, tasks-only mode included.
- The start page is a new optional field in `user_prefs` (`startPage: "home" | "my" | "today"`, added to `prefsSchema`; absent means Home). It is local data, so backups and exports carry it. No migration: prefs are already one JSON value.
- Settings → General gets a "Start page" select next to the time zone.
- Palette: "Go to Home" (`G H`). `G H` is added to the G-chord map in `components/app/shortcuts.tsx` and the shortcuts help.

### 3.2 Layout
A page header, a row of tiles, then two columns (one column below ~900 px). At 390 px everything stacks and nothing scrolls sideways (SPEC test for the narrow layout).

### 3.3 Header
- "Good morning / afternoon / evening" (viewer's time zone, `user_prefs.tz`) and the date.
- One context line built from what is true, omitting parts that do not apply: "\<Sprint\> ends in N days · N issues need triage".
- Actions: **Plan my day** (opens the existing AI3 dialog; hidden when AI is off, as on Today), **Create issue** (hidden in tasks-only mode; disabled with the write reason when writes are off, as the sidebar's +), **Add task** (`Q`, opens quick add).

### 3.4 Tiles
Each tile is a button that opens its page. A tile's number must equal what that page shows (a test asserts this for each tile).

| Tile | Number | Second line | Opens | Shown when |
|---|---|---|---|---|
| Tasks due today | `dueCount` (same as the sidebar's Today and the Dock badge) | "N overdue" in the critical colour, or "Nothing overdue" | `/tasks/today` | always |
| My open issues | `counts.mine` | "N in \<current sprint\>" | `/my` | not tasks-only |
| Needs triage | the Needs triage queue count (`useTriageCount`) | "N new this week" (the New this week queue) | `/triage` | not tasks-only |
| Watching | unseen watched changes (`useWatchlist().unseen`) | "Unseen changes" or "Nothing new" | `/watching` | not tasks-only |
| \<Current sprint\> | done % | "X / Y done · N days left" (`sprintStats`, `sprintTiming`) | `/releases/[id]` | a Sprint field is mapped and a sprint is in progress |

The sprint tile follows the default team scope. **[Default H-B]**

### 3.5 My work panel
Three tabs with counts. Up to 8 rows each; more shows "View all N" linking to the owning page.

| Tab | Rows | Order | "View all" opens |
|---|---|---|---|
| Today | open tasks due today or earlier (the Today page's set) **[Default H-C]** | overdue first, then by time, then priority | `/tasks/today` |
| This sprint | open issues assigned to me in the current sprint | Status option order of the project, then Priority | `/releases/[id]` filtered to me |
| Upcoming | open tasks due tomorrow through the next 7 days | by date, then time, then priority | `/tasks/upcoming` |

- Task rows look like task rows today: a checkbox in the priority colour, title, project, due date. A linked task shows the issue's number and Status pill. Completing a task uses the task store's normal path, with the Undo toast; the tile and sidebar counts follow at once.
- Issue rows look like issue rows: number, title, Status pill, Priority. Clicking opens the side panel, as on lists.
- "This sprint" is hidden without a Sprint field or a current sprint; in tasks-only mode only Today and Upcoming show.
- The last tab chosen is remembered per install in `localStorage` (a convenience, not data; a blocked storage falls back to Today).
- Empty states: Today "Nothing due today", Upcoming "Nothing due this week", This sprint "Nothing assigned to you in \<sprint\>".

### 3.6 Current sprint panel
- Heading: sprint title, dates, "N days left".
- Done X / Y and %, then one bar split by Status option (project option colours), with a legend of counts. Not-planned issues are excluded, as on the sprint page (SPEC §4.5).
- "+N added since start" when scope was added (`useScopeAdded`).
- **At risk**, up to 5 rows from the existing release risk rules (`lib/client/risk.ts`): open top-Priority issues with nobody assigned, and issues added after the sprint started. Each row says which rule matched. No new risk rule in H1.
- Follows the default team scope with the scope chip **[Default H-B]**; filtered numbers say so ("Platform · 12 / 30"), as the sprint header does.
- Missing data: no Sprint field mapped → panel hidden; no sprint in progress → "No sprint in progress", the next sprint's start date when there is one, and a link to Releases.
- "Open sprint" links to the sprint page.

### 3.7 Data and code
- All selection logic lives in a pure module, `lib/client/home.ts`, taking the client payload, tasks, today and the default scope, and returning the tiles, tab rows and sprint summary. The page component only renders it. This is what the unit tests cover.
- It reuses, never re-implements: `dueCount`, `sidebarCounts`, `sprintStats`, `sprintTiming`, `releaseRisk`, `releasesOn`, `withDefaultScope`, the triage queue definitions and the watchlist store.
- Loading: the same skeleton as other pages while the payload loads; the connection banner and stale-data rules apply unchanged.

### 3.8 Tests
- Unit (`tests/client/home.test.ts`): each tile equals its page's count; tab contents and order; sprint parts absent without a Sprint field or current sprint; team scope applied and labelled; tasks-only drops GitHub parts; empty states.
- e2e (`tests/e2e/home.spec.ts`, demo dataset): `/` lands on Home; each tile navigates to the right page; tabs switch; completing a task updates the tile and sidebar and Undo restores it; `G H` and the palette open Home; Start page = My issues makes `/` open My issues; tasks-only mode shows only task parts.
- `a11y.spec.ts` covers `/home` (axe, both themes); `mobile.spec.ts` checks `/home` at 390 px.

---

## 4. H2 — What needs me

Two more panels in the right column and one under the sprint panel. Same rules as H1: cached data only, every row opens its page.

### 4.1 Needs attention
Up to 6 rows, each saying why it is there:
- **New in triage**: the newest 3 issues of the Needs triage queue. Opens the issue; the panel's "Open triage" link opens `/triage`.
- **Quiet**: my open issues not updated for 14 days **[Default H-E]** (existing `older_than_days` filter on `updated`).

Sprint risks stay in the sprint panel's At risk list and are not repeated here.

"Blocked by" is not used: it is read live, not synced (SPEC §4.8 note), so Home cannot list it without new calls.

### 4.2 What changed
- The unseen watched changes, newest first, up to 5, worded by `describeFieldChange` exactly as on the Watching page.
- "Mark all seen" calls the existing seen route; "Watching" opens the page.
- Empty: "Nothing new in the issues you watch."

### 4.3 Epics in this sprint
- Current-sprint issues that have sub-issues, with GitHub's progress (`50% · 2/4` and a bar, SPEC §4.4), lowest progress first, up to 5. "All epics" opens `/epics`.
- No children → not listed; progress not loaded → "— progress not loaded", as everywhere else.

### 4.4 Tests
Unit tests in `home.test.ts` for each list and its cap; e2e for "Mark all seen" and opening a row.

---

## 5. H3 — Make Home yours

- Customize Home: hide and reorder panels, same pattern and dialog style as Customize sidebar. Stored in `user_prefs` as `home: { order, hidden }`, validated like `sidebar`.
- Tiles are not separately configurable in H3.

---

## 6. Files expected to change

| Area | Files |
|---|---|
| Route and redirect | `app/(app)/page.tsx`, new `app/(app)/home/page.tsx` |
| Page | new `components/pages/home.tsx`, new `lib/client/home.ts` |
| Sidebar | `components/app/sidebar.tsx`, `components/app/sidebar-customize.tsx`, `lib/tasks/model.ts` (group map, `startPage` in prefs) |
| Navigation | `components/app/shortcuts.tsx`, `components/app/palette.tsx` |
| Settings | Settings → General (start page) |
| Docs | `docs/SPEC.md` (§4.10, Part 5, Part 6 tests), `docs/PROGRESS.md`, release notes |
| Tests | as listed in §2.3, §3.8, §4.4 |

---

## 7. Where this differs from the prototype

- Today tab: the prototype mixed in two issues; the spec keeps Today to tasks and shows a linked issue on the task row (H-C).
- At risk: the prototype showed "Not started", "No update in 5 days" and "Blocked by"; the spec uses only the existing risk rules, since the others need new rules or data Home does not have.
- Needs attention: "Blocked" is dropped (not synced); "new today" becomes "new this week" to match the existing triage queue.
- The prototype put the triage and watching counts in tiles with made-up second lines; the spec defines each from an existing count.
