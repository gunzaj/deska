# Calendar spec: meetings on Home, and tasks planned into the day and week

Status: **ready to build**, 2026-11-27 (every decision settled by the maintainer the same day). Nothing is built. When C1 lands, the behaviour moves into `docs/SPEC.md` (a new §4.11 "Calendar" and a Part 5 phase), and this file stays as the history of the decision, as `HOME-SPEC.md` does.

**What this is.** Deska shows the user's own meetings next to their tasks and GitHub work, and lets them drag a task onto a time slot to plan the day and the week. It answers "what is my day going to look like, and when will I do this?" without switching to a calendar app.

`docs/SPEC.md` §0.2 applies to every milestone: fictional data only (`acme/widgets`, people `alice`, `bob`, `carol`, `dave`), one test per behaviour, mocks for everything external, and `SPEC.md` is updated when behaviour it describes changes. Calendar fixtures are fictional too: no real meeting titles, attendees, rooms or links.

---

## 0. Decisions to review

Marked **[Default C-x]** where it appears below. "Decided" means the maintainer confirmed it on 2026-11-27.

| # | Question | Answer |
|---|---|---|
| C-A | Where do the meetings come from? | **The calendars already in macOS Calendar** (EventKit), read through a small helper bundled in the app. No Google or Microsoft sign-in in Deska, no OAuth (§2). The permission prompt that may come back after an update while the app is ad-hoc signed is **accepted** (decided, §2.4). |
| C-B | Is a subscribed ICS address offered as well? | **Not in C1.** Kept as a possible later source for a Mac without the account in Calendar (§2.3). |
| C-C | Does dragging a task onto the calendar create a real calendar event? | **Only when the user turns it on** (decided). Off: the task gets a time and a length in Deska only (C2), nothing is added to any calendar. On: Deska adds a **generic busy block** that never shows the task's title or any other content (C3, §5). |
| C-D | Default length of a task dropped on the calendar | **30 minutes**; resize in 15-minute steps. |
| C-E | Which events show? | Every event on the chosen calendars, **except ones the user declined**. All-day events in a band above the grid. |
| C-F | Are meeting details stored in Deska's database? | **No.** Events are read from macOS on demand and kept in memory. Not in backups, exports or AI input (unless C4 is turned on). |
| C-G | Can a meeting link (video call) be opened from Deska? | **Yes, a "Join" button** (decided). It opens links on a short list of video-call sites in the default browser; any other link only shows as text. "Open in Calendar" always works. Widens the §2.2 navigation rule (§6). |
| C-H | Version | C1 as **1.5.0** (decided: a new integration is the "something major" bar for a minor bump); C2–C4 as 1.5.x. |
| C-I | Week start and working hours | Week starts **Monday**; the grid opens on **08:00–18:00** and scrolls to the full day. Both in Settings → Calendar. |

---

## 1. Goals and non-goals

**Goals**
- Home shows today's meetings and the next one coming up, next to the tasks due today.
- A Planner page shows the day or the week as a time grid: meetings and timed tasks together, with free time obvious.
- Dragging a task from a list (or from the Planner's own side list) onto a slot gives it that date, time and a length. Dragging it again moves it; dragging it off the grid unschedules it. Every change has Undo.
- Works in tasks-only mode. The calendar needs no GitHub connection.

**Non-goals**
- No calendar app. No creating, editing, accepting or declining meetings in Deska. "Open in Calendar" hands over to the system app.
- No OAuth flow, client ID or hosted service of Deska's own (`SPEC.md` §1.3 stays true).
- No other people's calendars, free/busy lookup or scheduling for others.
- No Windows or Linux source (the app is macOS only, `SPEC.md` §1.3).
- No AI run on its own. Plan my day uses meetings only when the user turns that on (C4) and clicks it.

---

## 2. Where the meetings come from

### 2.1 Options considered

| Option | How | For | Against |
|---|---|---|---|
| **A. macOS Calendar (EventKit)** **[Default C-A]** | A bundled Swift helper reads the calendars the user already has in Calendar.app: Google, iCloud, Exchange/Microsoft 365, CalDAV | No sign-in and no network from Deska; covers every account type at once; offline; fits §1.3 (no OAuth of our own); can also write (C3) | Needs a native helper and the macOS Calendars permission; the account must be added in System Settings → Internet Accounts; ad-hoc signing makes the permission fragile (§2.4) |
| B. Subscribed ICS address | The user pastes a calendar's secret iCal address; the server fetches it every few minutes | Simple, no native code | Read-only, so no C3; the address is a credential; many company accounts turn secret addresses off; minutes behind; recurrence and time-zone rules to parse ourselves |
| C. Google Calendar / Microsoft Graph API | OAuth sign-in, API calls | Full data, write support | An OAuth app and flow of Deska's own (§1.3 rules it out); Google's verification for calendar scopes; tokens to store and refresh; one integration per provider |

A is the default: it is the only option that is read-write, provider-neutral and needs no OAuth. B stays a possible later fallback **[Default C-B]**. C is not planned.

### 2.2 The helper

- A small Swift command-line tool, `deska-calendar`, built in CI and placed in `Deska.app/Contents/Resources/`. Main spawns it (never the renderer, never the server with a shell), talks JSON lines over stdin/stdout, and keeps it running while the app runs.
- Commands (the whole interface; anything else is refused):
  - `status` → `notDetermined | denied | restricted | fullAccess | writeOnly`.
  - `requestAccess` → asks macOS for full access (macOS 14+ `requestFullAccessToEvents`). Only sent after the user clicks "Connect calendars".
  - `calendars` → `[{ id, title, color, source, allowsWrite }]`.
  - `events { from, to, calendarIds }` → `[{ id, calendarId, title, start, end, allDay, timeZone, location, url, myStatus, organizerIsMe, attendeeCount, isRecurring, occurrenceDate }]`. Window up to 42 days. Notes are **not** read.
  - `changed` (pushed by the helper) on `EKEventStoreChangedNotification`, so Deska refreshes when Calendar syncs.
  - C3 only: `upsertDeskaEvent`, `removeDeskaEvent`, writing only the generic fields of §5.2.
- `Info.plist` gets `NSCalendarsFullAccessUsageDescription` ("Deska shows your meetings next to your tasks.") through `extendInfo` in `desktop/build/electron-builder.json`; the entitlements file gets `com.apple.security.personal-information.calendars`.
- Main passes event data to the server over the existing IPC channel. The server serves it to the renderer at `GET /api/calendar/events?from&to` (same per-launch secret and host checks as every route, `SPEC.md` §2.2).
- Tests and dev never run the helper: `DESKA_CALENDAR_FIXTURE=<file>` makes main serve fictional events from a JSON file instead (like `DESKA_GITHUB_API_URL`). Ignored in a packaged build.

### 2.3 Later source: ICS address (not in C1)

If added, it is a second provider behind the same `events` shape: `https` only, the address treated as a secret (`safeStorage`, redacted, never in backups), fetched every 5 minutes while the app runs, read-only. Recorded here so C1's code keeps the provider boundary.

### 2.4 Permission and signing

- macOS ties the Calendars permission to the app's code signature. With the current **ad-hoc** signature (`SPEC.md` §1.3, D14) the permission may be asked again after every update. The maintainer accepted this (C-A). Settings explains this when access is `denied` or `notDetermined` after an update and links to System Settings → Privacy & Security → Calendars. A Developer ID signature fixes it; until then this is a known rough edge, listed in the release notes.
- `denied` / `restricted`: the Home panel and Planner show "Deska can't read your calendars" with "Open System Settings" and hide nothing else.

---

## 3. C1 — Meetings on Home (read-only)

### 3.1 Settings → Calendar (new page)
- **Connect calendars**: asks macOS for access (§2.2). Then lists the calendars grouped by account, each with its colour and a checkbox. **[Default]** All calendars on, except subscribed holiday and birthday calendars.
- "Hide declined events" (on) **[Default C-E]**, "Week starts on" (Monday) and "Working hours" (08:00–18:00) **[Default C-I]**.
- "Disconnect" stops reading and forgets the chosen calendars. It does not change macOS permissions.
- Stored in `app_settings` as `calendar.prefs` (`{ enabled, calendarIds, hideDeclined, weekStart, workStart, workEnd }`); calendar IDs are per Mac and are dropped on import if unknown. In backups and exports like other settings.

### 3.2 Home: Calendar panel
- A new Home panel `calendar` (added to `HOME_PANELS` in `lib/tasks/model.ts`, so Customize Home can hide and move it). Placed in the narrow column, first, by default.
- Header: "Today" and the date; "Next: \<title\> in 25 min" when a meeting starts in the next 2 hours; "Free until 14:00" otherwise.
- Body: today as a compact time grid from the working-hours start (or the first event, if earlier) to the end, with a now-line. Overlapping events sit side by side. All-day events in a band at the top.
- Today's **timed tasks** (from C2 on) show in the same grid, styled as tasks (checkbox, priority colour), not as events.
- Clicking an event opens a small popover: title, time, calendar, location, number of attendees, "Join" (allowlisted meeting link, **[Default C-G]**) and "Open in Calendar". Nothing is editable.
- "Open planner" links to `/planner` (C2). Arrows step to tomorrow and back.
- The Header context line (`HOME-SPEC.md` §3.3) gains "N meetings today" when the calendar is on.
- Not connected: the panel shows one line, "See your meetings here", and "Connect calendars". Hidden for good from the panel's ⋯ menu (Customize Home).

### 3.3 Refresh
- Read on page load, on `changed` from the helper, on window focus, and every 5 minutes. A failed read keeps the last result, marked stale, as the GitHub cache is (`SPEC.md` §3.3: an error is never shown as an empty list).

### 3.4 Time zones
- Events are shown in the viewer's zone (`user_prefs.tz`). An event created in another zone shows its own zone in the popover. All-day events are dates, never shifted. DST changes are covered by tests.

### 3.5 Tests
- Unit (`tests/calendar/layout.test.ts`): overlap columns, all-day band, declined filtered, working-hours window grows to fit early/late events, DST day, events crossing midnight.
- Unit (`tests/calendar/settings.test.ts`): prefs schema, unknown calendar IDs dropped on import.
- e2e (`tests/e2e/calendar-home.spec.ts`, fixture events): panel lists today's events in order; "Next" line; popover; not connected and denied states; tasks-only mode shows the panel.
- `a11y.spec.ts` covers the panel in both themes; `mobile.spec.ts` at 390 px.

---

## 4. C2 — Planner: drag tasks into the day and week

### 4.1 Task model
- Tasks already have `due_date`, `due_time` and `due_tz`. C2 adds **`duration_min`** (smallint, nullable, 5–720) with a Drizzle migration. A task with a time and no duration counts as 30 minutes on the grid **[Default C-D]** but keeps `null` until resized.
- Quick add learns durations: `for 45m`, `for 1h30` (parser in `lib/tasks/quick-add.ts`, chip shows "45 min"). The task panel gets a Duration picker next to the time.
- Recurring tasks: scheduling one sets the time and duration for the series, exactly as editing the due time in the task panel does today. **[Default]**
- Backups and exports carry the new column; an older backup reads it as `null`.

### 4.2 The Planner page
Both surfaces, decided 2026-11-27: the Home panel covers today, the Planner page covers the week (and a single day in more room).

- Route `/planner` (`app/(app)/planner/page.tsx`, `components/pages/planner.tsx`), sidebar item **Planner** in the Tasks section (between Today and Upcoming), `G P` and the palette. Day and Week toggle (`D` / `W`), Today button, arrows.
- Layout: a side list on the left, the grid on the right.
  - **Side list** (tabs): *To plan* (open tasks due on the shown day(s) or overdue, without a time), *Inbox*, *Upcoming* (next 7 days). Each row is a normal task row and can be dragged.
  - **Grid**: 15-minute slots; meetings as read-only blocks in their calendar colour; timed tasks as task blocks with a checkbox. Week view: 7 columns (or 5 with "Hide weekends"), all-day band on top.
  - A per-day footer: "4 h 30 min in meetings · 2 h planned · 1 h 30 min free in working hours".

### 4.3 Drag and drop
Uses the native drag already used by task rows (`components/tasks/task-row.tsx`, `components/tasks/drop.tsx`), so a task can also be dragged from Today, Upcoming, a project, or Home's My work panel onto the Home Calendar panel or the Planner.

| Gesture | Result |
|---|---|
| Drop a task on a slot | `due_date` = that day, `due_time` = slot start (snapped to 15 min), `due_tz` = viewer's zone, `duration_min` kept or 30 |
| Drag a task block to another slot or day | Moves it, keeps its duration |
| Drag a block's bottom edge | Changes `duration_min` in 15-min steps (min 15, max 12 h) |
| Drop a block on the side list | Clears `due_time` and `duration_min`, keeps the date |
| Drop on the all-day band | Sets the date, clears the time |
| Drop a task over a meeting | Allowed; the task sits beside the meeting. Overlap is shown, not refused |
| `Esc` while dragging | Cancels |

- Every change is one normal task edit through the task service, with the Undo toast. Sidebar counts, Dock badge and reminders follow at once (a reminder relative to the due time moves with it).
- Keyboard: a focused task block moves with ⌥↑/⌥↓ (15 min) and ⌥←/⌥→ (a day); ⌥⇧↓/↑ changes duration. Screen readers get "Moved \<task\> to Tuesday 14:00".
- Meetings cannot be dragged or resized.
- Completed tasks stay on the grid, dimmed, so the day reads as it happened.

### 4.4 Home in C2
- Home's Calendar panel accepts drops (same rules as the Planner's day view) and shows timed tasks.
- My work → Today rows show their time and duration ("14:00 · 45 min").

### 4.5 Code
- Pure modules, unit-tested: `lib/calendar/layout.ts` (columns, all-day band, free time), `lib/calendar/drop.ts` (pointer position → date, time, snap; resize; keyboard moves), `lib/calendar/summary.ts` (meeting, planned and free time per day). The page components only render.
- Reuses `lib/tasks/dates.ts` for zones and the task service for every edit; no new write path.

### 4.6 Tests
- Unit: drop math across DST, midnight and week boundaries; snap; resize limits; side-list membership; footer totals; quick-add `for 45m`.
- Migration test for `duration_min`; backup round-trip with and without it.
- e2e (`tests/e2e/planner.spec.ts`): drag from To plan onto 10:00 sets the time; move to Wednesday; resize to 1 h; drag back to the list unschedules; Undo restores each; drag from Today onto the Home panel; keyboard move; tasks-only mode.

---

## 5. C3 — Block the time on my real calendar (opt-in, private)

So that colleagues see the time as busy, without seeing what the task is. **[Decided C-C]**

### 5.1 The setting
- Settings → Calendar → **"Block planned tasks on my calendar"**, a toggle, **off** by default, plus a picker of calendars that allow writing (none pre-selected; the toggle can't be turned on without one).
- **Off:** scheduling a task (C2) changes only the task in Deska. Nothing is added to, changed on or removed from any calendar.
- **On:** each task with a time gets one block on the chosen calendar, kept in step with the task (§5.3).
- Turning it on applies to tasks scheduled **from then on**; Settings offers "Also block the N tasks already planned from today on" as a separate button. Turning it off asks "Remove the N blocks Deska added?" (Remove / Keep them).

### 5.2 What the block reveals: nothing about the task
The block is **generic**. It is the same for every task, so someone who can see the calendar learns only that the time is taken.

| Event field | Value |
|---|---|
| Title | A fixed text from Settings, **"Busy"** by default (the user can change it once, e.g. "Focus time"; never per task, never filled from the task) |
| Start, end | The task's time and duration |
| Availability | Busy |
| Notes, location, URL | **Empty** |
| Attendees, alarms | None |

- Never written: the task's title, description, project, labels, priority, linked issue number, comments, or the task's ID.
- The link between a task and its block lives only in Deska's local database (§5.3), so the calendar holds nothing that points back to the task.
- Inside Deska the block is recognised through that link and drawn as the task itself, so the user doesn't see each task twice.
- A test asserts the exact field values Deska sends to the helper for a task with a title, description, labels and a linked issue, and fails if any of that text appears.

### 5.3 Keeping it in step
- Deska stores the pairing in a new local table `task_calendar_events` (`task_id`, `calendar_id`, `event_id`, `last_written_at`) and only ever changes events listed there. It never edits or removes any other event.
- Moving or resizing the task moves or resizes its block. Unscheduling or deleting the task removes the block. Completing keeps it (the time was spent) **[Default]**.
- A block the user moved in Calendar.app wins: Deska notices on `changed` and moves the task to match (with a toast and Undo). A block the user deleted in Calendar.app is not recreated for that task until it is scheduled again.
- Writes go through the helper's two commands only (`upsertDeskaEvent`, `removeDeskaEvent`). The helper itself refuses to change an event it was not given in the pairing list. A test fails if the helper gains any other write command.
- The pairing table is in backups; the blocks are not. After a restore on another Mac the pairings are dropped (calendar IDs differ) and blocks are recreated on the next change.

### 5.4 Effort and security
- **Effort:** moderate, and mostly in C1/C2 already. Reading needs macOS "full access" to calendars, which also allows writing, so C3 asks for **no new permission**. The new work is two helper commands, the pairing table, the setting, and handling blocks moved or deleted in Calendar.app.
- **Risks and how they are handled:**
  - *Changing someone's meeting by mistake:* only events in the pairing table can be changed, checked in Deska and again in the helper.
  - *Leaking task content to people who can see the calendar:* the block is generic (§5.2), with a test.
  - *Shared or work calendars:* a block on a work calendar is visible to whoever sees that calendar's free/busy or details, as for any event. That is the point of the feature; Settings says which calendar it writes to.
  - *Backup or export leaking event IDs:* IDs only, no content, and they mean nothing outside this Mac.

Tests: unit for the pairing rules and the generic fields; e2e with the fixture helper for toggle off (no write at all), toggle on, move, resize, unschedule, complete, delete, block moved or deleted in Calendar, and turning the toggle off with Remove and with Keep.

---

## 6. Security and privacy

- **No new network access.** EventKit is local; macOS syncs the accounts. `SPEC.md` §2.2's "nothing is loaded from the network" stays true.
- **Navigation (C-G).** §2.2 allows only `https://github.com/*` to open externally. "Join" widens it to a fixed allowlist of meeting hosts (`meet.google.com`, `*.zoom.us`, `teams.microsoft.com`, `teams.live.com`, `*.webex.com`), `https` only, matched exactly in main, with a test. Any other URL in an event shows as plain text. The link is taken from the event's URL field, or else the first allowlisted link in its location.
- **Least data.** The helper never reads event notes or attendee names and emails, only a count. Titles and locations are held in memory, never written to the database, logs or backups **[Default C-F]**.
- **AI.** Event data is not sent to any AI feature unless C4 is turned on; Settings → AI lists it per feature when it is.
- **Preload bridge.** One addition: `calendar.connect()` (triggers the permission request) and `calendar.status()`. No event data passes through the bridge; the renderer reads it from the server route.
- `docs/security.md` gets a Calendar section: the permission, what the helper reads, the write limits of C3 (only Deska's own generic blocks) and the navigation allowlist.

---

## 7. C4 — Plan my day knows my meetings (optional)

- Settings → AI → Plan my day: "Include my meetings" (off). When on, the AI3 input adds today's events as `{ start, end, busy }`, plus titles only if "Include meeting titles" is also on.
- The suggestion can then propose times and durations for tasks in free slots; Accept applies them as C2 edits with Undo. Nothing runs unless the user clicks Plan my day (`SPEC.md` §4.9).

---

## 8. Milestones

| Milestone | Scope | Depends on |
|---|---|---|
| **C1** | Helper (read), Settings → Calendar, Home Calendar panel, fixture mode, security doc | — |
| **C2** | `duration_min`, quick-add durations, Planner page, drag and drop (Planner and Home), keyboard moves | C1 |
| **C3** | Opt-in generic busy blocks for planned tasks on one calendar, pairing table | C2, maintainer's go (writes outside Deska) |
| **C4** | Plan my day with meetings | C2, AI on |

C3 writes to the user's real calendar, so like Phase C for GitHub it starts only when the maintainer says go.

---

## 9. Files expected to change

| Area | Files |
|---|---|
| Native helper | new `desktop/calendar/` (Swift package), build step in CI and `desktop/build/electron-builder.json` (`extendInfo`, resources), `desktop/assets/entitlements.mac.plist` |
| Main process | new `desktop/calendar.ts` (spawn, JSON lines, fixture mode), `desktop/bridge.ts`, `desktop/navigation.ts` (C-G) |
| Server | new `app/api/calendar/events/route.ts`, `lib/calendar/` (provider, layout, drop, summary) |
| Home | `lib/tasks/model.ts` (`calendar` in `HOME_PANELS`), `components/pages/home.tsx`, `lib/client/home.ts` |
| Planner | new `app/(app)/planner/page.tsx`, `components/pages/planner.tsx`, sidebar, shortcuts, palette |
| Tasks | migration for `duration_min`, `lib/tasks/model.ts`, `lib/tasks/quick-add.ts`, task panel, backup tables |
| Settings | new Settings → Calendar page |
| Docs | `docs/SPEC.md` (§4.11, Part 5, Part 6, §2.2 if C-G), `docs/security.md`, `docs/PROGRESS.md`, release notes |
| Tests | as listed in §3.5, §4.6, §5 |

---

## 10. Open questions for the maintainer

Settled on 2026-11-27: the ad-hoc signing rough edge is accepted (C-A), "Join" goes in (C-G), C1 ships as 1.5.0 (C-H), and C3 is built only as an opt-in, generic busy block (C-C, §5).

Also settled: both a Home panel and a Planner page. Home shows today (§3.2, §4.4); the Planner page is for the week (§4.2).

Nothing is open.
