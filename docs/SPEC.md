# Deska — product and technical spec

> The source of truth for Deska. Coding agents build from it, one milestone at a time (§9).
> **[Verify]** marks something a milestone must check, NOT guess.

---

## 1. Problem

- Teams that plan in **GitHub Issues + an org GitHub Project** get weak filtering, no clear progress on parent/overview issues, and no easy view of what's done vs remaining in a sprint.
- Triage on a big repo is slow in GitHub's UI: lots of clicking, page loads and context switches.
- People mix GitHub work with personal to-dos ("update this ticket", "finish the spec for #1234") but have to keep them in a separate app.
- Hosted tools on top of GitHub need a server, an OAuth app and an org approval for both. That's a lot of surface for a small team tool.

## 2. Goal

**Deska** (Czech for "board") is a standalone **macOS desktop app** that:

1. Reads one GitHub repository and one **org Project (v2)** directly from GitHub with the user's **fine-grained personal access token** (PAT). No backend, no hosting.
2. Gives better filtering, fast triage, **parent issue progress** and a **sprint view**.
3. Has Todoist-like **personal tasks**, stored locally, linkable to GitHub issues.
4. Is **read-only first**. Writes (planning edits, close/reopen, create issue) are opt-in and work only with a token that has write permissions.

GitHub stays the shared source of truth. Anyone without Deska can open every issue on GitHub.

### NOT in scope

- Pull requests in any form.
- Sharing or assigning tasks to other people, shared saved views, any multi-user feature.
- A hosted server, OAuth app or backend of any kind.
- Windows and Linux builds (later, from the same code).
- Multiple repositories or projects at once. User-owned (non-org) projects **[later, §12 Q1]**.
- Deleting issues, ever. Creating, renaming or deleting project fields, options or iterations. Removing project items.
- Editing issue title/body, posting GitHub comments, editing parent/sub-issue relationships.
- Auto-update (v1 is a manual download from GitHub Releases).

---

## 3. Starting point

The code is ported from a **private predecessor**: a hosted Next.js web app (Postgres, OAuth, background worker) with the same issue, triage and task features. Milestone D0 imports it into this repo, scrubbed (§4). The maintainer gives the agent doing D0 local access to it.

What the predecessor has and where it goes:

| Area | Predecessor | Deska desktop |
|---|---|---|
| Runtime | Next.js 15 web app, hosted, background worker / cron | Same Next.js app run **locally inside Electron** (§5) |
| Storage | Postgres via `pg` + Drizzle, ~30 migrations, `pg_trgm` | **PGlite** (embedded Postgres) via Drizzle, same migrations **[Verify in D2]** |
| Auth | GitHub OAuth, allowlist, org access mode, encrypted tokens in DB | **Gone.** One local user = the PAT owner. Token in Keychain-backed storage |
| Sync | REST change check + GraphQL detail + project item scan + nightly reconcile, Postgres advisory lock | Same code, **in-process** while the app runs, in-process lock |
| Writes | Outbox + worker + env write switch; built and tested, never enabled | Kept, simplified to one process, behind the §6.4 gate |
| Field model | Fixed logical fields (Status, Priority, two extra single-selects, an iteration field), matched by name | **Mapped by the user** in onboarding (§7.1) |
| Issues | Explorer (list/board/table, filters, grouping, URL state), saved views, triage queues + triage mode + snoozes, sprint pages + planning + risk, epics, insights, watchlist, release notes draft, possible duplicates | **All kept**, minus PR parts |
| Parent progress | Counted from cached children only, so children outside the cache window are missing | GitHub's own `subIssuesSummary` (§7.4) |
| Tasks | Inbox/Today/Upcoming, projects, labels, natural-language quick add, recurrence, reminders, sub-tasks, comments, issue links, project GitHub source; plus assignees, a Delegated view, per-user visibility | Kept, **single-user** (§7.6) |
| PRs | PR sync, explorer, queues, panel, PR links | **Removed** |

---

## 4. Rules for coding agents

**Public repo hygiene (hard rules)**
- This repo is public. Never add real organization, company, product, repository or people names, real GitHub node IDs, real issue titles, internal links, tokens or emails. Use the fictional dataset: org `acme`, repo `acme/widgets`, people `alice`, `bob`, `carol`, `dave`.
- `private/` is the maintainer's local, gitignored folder. You may read it when asked. NEVER copy its content into tracked files, commit messages, PR text or test fixtures.
- Recorded GitHub fixtures must be synthetic or rewritten to the fictional dataset. Never commit a raw recording of a real repo.
- The leak guard (`scripts/leak-guard.mjs`, via `.githooks` and CI) must pass. Never bypass it (`--no-verify`).
- Commits use a GitHub noreply email.

**GitHub safety**
- Development and tests never write to a real repository or project. Use mocks, or a **sandbox org/project** with the same field types.
- Never call a delete operation. Never create, rename or delete project fields, options or iterations. Never remove project items.
- Never hardcode field names, option names or emoji. Discover them via GraphQL and store them by ID.

**Working rules**
- Inspect before changing. Reuse what works; don't rebuild an existing feature.
- One milestone = one small PR. CI passes `typecheck`, `lint`, `vitest`, `playwright` (mocks) and the leak guard. Check that milestone's acceptance criteria in the PR.
- Every bug fix and behavior change ships with a test. New tables/columns get a Drizzle migration; never edit an existing one.
- If you change behavior described here, update this spec in the same PR.
- Delete dead code when a feature is removed. No flags for removed features.

---

## 5. Architecture

### 5.1 Processes

```
Electron main process
  ├─ window, menus, dock badge, global shortcut, native notifications
  ├─ token store (safeStorage → Keychain-backed key)
  └─ spawns ─► utilityProcess: Next.js standalone server
                 ├─ binds 127.0.0.1:<random free port>
                 ├─ API routes, view engine, task service
                 ├─ sync loop (in-process)
                 ├─ outbox (writes)
                 └─ PGlite DB in ~/Library/Application Support/Deska/db
Renderer (BrowserWindow) loads http://127.0.0.1:<port>/ — the React UI
```

This shape reuses the Next.js app, API routes and Postgres SQL almost as-is. A pure client rewrite or Tauri would throw most of it away. **[Verify in D2]** that Next standalone and PGlite run in Electron's utility process. If PGlite fails, stop and report the cost of the fallback (better-sqlite3 + porting the raw SQL) before continuing.

### 5.2 Local server hardening (all required)

- Binds to `127.0.0.1` only, random free port per launch.
- **Per-launch secret:** main generates 256 random bits, passes them to the server over IPC and sets them as an `HttpOnly`, `SameSite=Strict` cookie on the window session before the first load. Every request (pages and API) without it gets 403.
- Any `Host` other than `127.0.0.1:<port>` gets 403 (DNS rebinding).
- Origin check on mutating requests and a strict CSP (both exist in the predecessor).
- Renderer: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, a minimal typed preload bridge (token entry, notifications, open-external, app info) and nothing else.
- Navigation locked to the app origin. `https://github.com/*` opens in the default browser via `shell.openExternal`. Every other external URL is blocked.
- Nothing is loaded from the network at runtime except the GitHub API.

### 5.3 Token

- Entered in onboarding or Settings through the preload bridge to **main**, never through HTTP.
- Main encrypts it with `safeStorage`, stores the ciphertext in the app data dir, and hands the plaintext to the server over IPC. The server keeps it in memory only.
- Never in the renderer, env vars, logs, error messages, exports or backups. Redaction covers `github_pat_…` and any value equal to the token.
- "Disconnect GitHub" deletes it. GitHub cache and tasks stay.

### 5.4 Settings (non-secret)

Stored locally: repo, org, project number + node ID (pinned after discovery), field mapping (§7.1), done Status option (W2), writes toggle, global shortcut, notifications, launch at login, dock badge, time zone. **No defaults point at any real org or repo.** Tests and dev may set them through env vars.

### 5.5 Removed with the server

OAuth/Auth.js, allowlist and org-access mode, DB token encryption and its key, a shared server token, hosting config, cron routes, the worker script, Dockerfile/compose, the health endpoint, and allowlist middleware (replaced by §5.2).

---

## 6. GitHub access and security

### 6.1 Token type

A **fine-grained PAT** whose resource owner is the org and whose repository access is **only the one repository** Deska reads. Classic PATs and OAuth are NOT supported.

### 6.2 Permissions

| Permission | Read-only use | With writes | Used for |
|---|---|---|---|
| Repository → Metadata | Read (mandatory) | Read | Repo info, assignable users, labels, milestones |
| Repository → Issues | **Read** | **Read and write** | Issues, sub-issues, issue types on issues, comments, rendered bodies; with writes: fields, labels, assignees, close/reopen, create |
| Organization → Projects | **Read** | **Read and write** | Project fields, options, iterations, item values; with writes: set values, add new issues to the project |
| Organization → Issue types (if GitHub requires it) | Read **[Verify in D1]** | Read | `organization.issueTypes` |
| Anything else (Pull requests, Contents, Actions, Administration…) | NOT requested | NOT requested | — |

Facts for anyone reviewing Deska's security (`docs/security.md`, written in D1):
- GitHub has no separate "delete issue" permission; deleting needs the **repo admin role**. Deska never calls a delete: the write client has an **operation allowlist** and a test fails on anything else (W0).
- The Projects permission is org-wide; GitHub can't scope a PAT to one project. Deska pins the project node ID and refuses to write to any other.
- A read-only PAT makes writes impossible on GitHub's side, whatever the code does.
- Orgs may require admin approval of fine-grained PATs and cap their lifetime.

### 6.3 Token states the app tells apart

| State | Signal from GitHub **[confirm exact responses in D1]** | What the user sees |
|---|---|---|
| Missing | no token stored | Onboarding |
| Invalid / revoked / expired | 401 | "Your GitHub token is invalid or expired" + Replace token |
| Expiring soon | `github-authentication-token-expiration` < 14 days | Warning with the date |
| Awaiting org approval | org resources refused while public data reads | "Waiting for your org to approve this token" |
| Missing a permission | 403 "Resource not accessible by personal access token" | Names the permission, e.g. "Organization → Projects: Read" |
| Read-only | write permissions absent | App works; edit controls disabled with "Read-only token" |
| Offline / GitHub down | network error / 5xx | "Can't reach GitHub"; cached data stays, marked stale |
| Rate limited | 403/429 with remaining = 0 | "Rate limited until HH:MM" |

An error is NEVER shown as an empty list.

### 6.4 Write gate

A GitHub write happens only when all three hold:
1. The token has the write permissions (detected, §6.3).
2. Settings → "GitHub writes" is on. Off by default, and off again after every token change.
3. The build allows writes. `DESKA_WRITES=off` at build time produces a read-only binary that refuses writes regardless of 1 and 2, for orgs that want that guarantee. v1.0 ships read-only (writes come in Phase C).

---

## 7. Product requirements

### 7.1 Project and field mapping

The predecessor assumed fixed field names. Deska maps roles instead.

| Role | Field type | Required | Used by |
|---|---|---|---|
| Status | single-select | Yes | Boards, triage, sprint view, close (W2) |
| Priority | single-select | No | Sort, triage keys `1`–`4`, risk. Option order is rank; a "highest first / lowest first" setting, because projects differ |
| Sprint | iteration | No | Sprint view, planning, carry-over. Without it, sprint features are hidden |
| Dimensions | single-select, 0–n | No | Any other single-selects (e.g. Team, Platform): filter, group, board columns. One may be the "My default" dimension (§7.2) |

- Onboarding suggests a mapping by field name and type; the user confirms or changes it. Settings can remap later.
- Stored by **field ID**. A renamed field stays mapped. A deleted field shows "Missing field — remap" instead of blank values.
- Native issue properties (type, labels, milestone, assignees, parent, state) need no mapping.
- "Current sprint" is the iteration whose `start ≤ today < start + duration`; previous/next by date.

### 7.2 Issues and filtering

Keep the explorer, saved views, layouts, grouping, URL state, ⌘K, `G` navigation and shortcuts.

Add / change:
- **New filters:** Author; In project (yes / no, for triage); Closed reason (completed / not planned); Sub-issue progress (none, not started, in progress, done, from §7.4); any mapped dimension.
- **No hidden filters.** A "My default" dimension value (e.g. your team) shows as a visible chip ("Default: Platform team ✕"). Any list with ≥1 active filter shows the count and "Clear all".
- **Empty vs loading vs error.** Three distinct states in every list. Empty names the active filters and offers "Clear filters". Errors follow §6.3.
- **Saved views are local.** No shared visibility. **Copy view** puts a compact JSON string on the clipboard; **Import view** reads it. Field and option IDs travel inside, so it works between installs pointed at the same project.
- Parent progress is never recalculated from the filtered list (§7.4).

### 7.3 Triage

Keep queues (needs triage, new this week, not in a sprint, unassigned in the current sprint, stale), triage mode (one issue at a time) and snoozes. Read-only: triage mode is a walk-through and the edit keys say "Read-only token". Snoozes are local.

### 7.4 Parent issue progress

- **Source:** GitHub's `Issue.subIssuesSummary { total completed percentCompleted }`, synced and stored per issue. Matches GitHub's own sub-issues progress, so Deska and GitHub never disagree. **[Verify in D1]** whether `completed` includes "not planned" and cross-repo children; say so in the tooltip.
- **Display:** `50% · 2/4` in rows (a "Progress" cell/column), the issue panel, the Epics page and the sprint view, with a small bar where there's room.
- **No children** (`total = 0`): nothing. Never 0% or 100%.
- **Not loaded yet:** `— progress not loaded`, never a number.
- **Children list** in the issue panel: number, title, state, Status, link to GitHub. Fetched live on open (`subIssues`, paged), so children outside the cache and in other repos show. Partial failure: "Showing 40 of 52 — couldn't load the rest" + Retry.
- **Filters don't change it:** always from the summary.
- Sort by progress in the explorer and on the Epics page.
- Direct children only. Nested rollups are NOT in scope.

### 7.5 Sprint view

A sprint is one iteration of the mapped Sprint field. Build on the predecessor's sprint pages (overview, per-sprint board, planning, risk, notes); don't add a parallel one.

- **Picker:** current by default, previous/next (`[` / `]`), any iteration.
- **Header:** done X / Y and %, days left, counts by Status, scope added since the sprint started.
- **Remaining vs Done:** open issues are Remaining; closed as completed are Done; closed as "not planned" sit in a collapsed group and are excluded from the %. Optional setting: Status options that also count as done (e.g. an "Approved" state).
- **Layouts:** board by Status (default) and list. All §7.2 filters apply; the header then shows the filtered numbers and says so ("Platform team · 12 / 30").
- Parent progress on items that have sub-issues.
- **Missing data:** no Sprint field mapped, project unreadable and empty sprint each get their own message.
- **Planning actions** (drag between columns, drag from the backlog drawer, move carry-over to the next sprint, bulk edit, triage keys) are visible but disabled with the reason until writes are on.
- Keep planning (current vs next with carry-over), risk (without PR rules) and the release-notes draft (without PR lines).

### 7.6 Personal tasks (Todoist-like)

Keep for one person: Inbox, Today, Upcoming, projects (with an optional GitHub source filter), labels, natural-language quick add, priorities, due dates and times, recurrence, reminders, sub-tasks, manual ordering, drag and drop, comments (as notes), issue links and "Add to tasks" from issues, undo toasts.

Remove (D7):
- Assignees, the Delegated view, `@person` in quick add, "not on Deska yet" hints.
- Per-user visibility. All tasks in the local DB belong to the user of this install, whichever GitHub account is connected.
- Notifications other than reminders and the watchlist digest.

Add — desktop-native (D12):
- **Global quick add:** a system-wide shortcut (default `⌃⌥Space`, configurable) opens a small floating quick-add window from any app. Enter saves and closes; Esc closes.
- **Native notifications** for reminders, with Complete, Snooze 1 h and Tomorrow. Clicking opens the task.
- **Dock badge**: overdue + today count (toggle).
- Closing the window keeps Deska running (macOS standard) so sync and reminders continue; ⌘Q quits. Opt-in launch at login.

Add — Todoist parity (D13, optional):
- **Sections** in a project (create, rename, reorder, collapse, drag tasks between them).
- **Completed** view: last 30 days grouped by day, with un-complete.
- ⌘K task search covers descriptions and comments.

Rules:
- Tasks never write to GitHub and never need write access.
- A closed linked issue shows a badge; the task is never auto-completed.
- Tasks and GitHub issues always look distinct (checkbox vs status icon), including inside project GitHub sources.

### 7.7 Local data safety

Tasks, views, snoozes, watches and settings exist only on this Mac; the GitHub cache can always be rebuilt.
- **Automatic backup** daily and before every migration: JSON of all local-only data in `~/Library/Application Support/Deska/backups/`, last 14 kept.
- **Export / Import** in Settings. Import merges by ID and never touches the GitHub cache.
- **Reset GitHub cache** (re-import, tasks kept) and **Reset everything** (asks twice).
- A DB that fails to open offers "Restore from latest backup".
- Backups and exports NEVER contain the token.

### 7.8 Writes (Phase C)

| Write | API | Milestone |
|---|---|---|
| Sprint, Status, Priority, dimensions | `updateProjectV2ItemFieldValue` / `clearProjectV2ItemFieldValue`; `addProjectV2ItemById` first if the issue isn't in the project | W1 |
| Assignees, labels | REST add/remove, sent as deltas | W1 |
| Type, milestone | `updateIssueIssueType`; REST `PATCH` milestone | W1 |
| Close / reopen | REST `PATCH state, state_reason`; close also sets Status to the done option chosen in Settings | W2 |
| Create issue | REST `POST /issues`, add to project, set fields — one outbox job | W3 |

Every write: only after an intentional user action; optimistic UI; a stale-value check before writing ("Changed on GitHub by X → Keep theirs / Overwrite"); a success or failure toast; then the issue is re-read and GitHub's resulting state shown. Bulk edits over 50 issues confirm first. No delete anywhere.

---

## 8. Data model changes (vs the predecessor)

| Change | Milestone |
|---|---|
| Drop user token storage (and `users` if unused) | D3 |
| Local settings incl. field mapping | D2–D4 |
| Fixed extra fields → dimension values keyed by field ID; view filters `dim:<fieldId>` | D4 |
| `issues.sub_total`, `issues.sub_completed`, `issues.sub_summary_at` | D9 |
| Drop PR tables and PR task links | D6 |
| Drop task assignee; drop notification kinds other than reminder and watch digest | D7 |
| Drop view visibility | D7 |
| `task_sections` + `tasks.section_id` | D13 |

---

## 9. Milestones

One PR each, in order unless "Parallel with" says otherwise.

### Phase A — Groundwork

#### D0 — Import the predecessor, scrubbed
- Copy the predecessor's code (not its git history) into this repo.
- Replace demo data, test fixtures and recorded GitHub responses with the fictional dataset (§4). Regenerate, don't search-and-replace real recordings.
- Remove every real org/repo default from config; required values come from settings or env.
- Remove internal docs (old specs, findings, runbooks) instead of scrubbing them. This spec replaces them.
- Keep the code otherwise unchanged: no feature work, no removals. CI as in §4.
- **Acceptance:** `pnpm dev` runs on demo data; `typecheck`, `lint`, `vitest` and `playwright` (mocks) pass; the leak guard passes with `--all` and with the maintainer's private denylist; no file contains a real GitHub node ID (test scans for `PVT_`, `PVTF_`, `PVTSSF_`, `PVTIF_`, `IT_` IDs not in the fictional set).

#### D1 — Token probe + security doc
*Parallel with D2.*
- `scripts/probe-pat.ts` (`pnpm probe:pat`), read-only, run with a read-only fine-grained PAT against a repo/project from env. Output goes to `private/findings/` (it contains real IDs), never to a tracked file.
- Records: which calls Deska needs succeed (issues REST with `since`, GraphQL detail with `issueType`, `parent`, `subIssues`, `subIssuesSummary`, project fields/options/iterations, items with `items(query:)`, `organization.issueTypes`, assignable users, labels, milestones, comments, rendered body); the exact response for each §6.3 state reproducible without writing; signs of org approval requirements and token lifetime; `subIssuesSummary` semantics.
- Writes the public `docs/security.md`: architecture (§5), exact read and write permission tables (§6.2), token storage, local server hardening, what's stored on disk, what Deska never does, the write gate.
- **Acceptance:** the probe makes zero mutating calls (a test asserts its client rejects non-GET REST and any GraphQL `mutation`); `docs/security.md` exists and contains no org-specific data; every "[Verify in D1]" here is answered in this spec (in general terms) or listed in §12.

#### D2 — Desktop shell on PGlite
- Electron main, preload and a utilityProcess running the Next standalone build. §5.2 complete.
- `db/` switches to PGlite via Drizzle; all migrations run, including `pg_trgm` (if it won't load, Possible duplicates uses the existing in-memory similarity fallback). Remove the `pg` pool.
- Advisory sync lock → in-process mutex.
- Postgres-backed tests run on PGlite (no Docker).
- `pnpm desktop:dev`, `pnpm desktop:build` (unsigned `.app`/`.dmg`, arm64 + x64). Demo data until D3.
- **Acceptance:** the built app opens with demo data and no server started by hand; a saved view survives relaunch; a request without the secret cookie or with a wrong `Host` gets 403; GitHub links open the default browser and other external URLs are blocked; a Playwright `_electron` smoke test launches the app and loads the issue list.

#### D3 — Local identity and token
- Remove everything in §5.5 not already gone.
- Onboarding step 1: paste PAT (with a "How to create it" guide listing §6.2) → `GET /user` → capability check (§6.3).
- Settings: replace token, disconnect, detected permissions, expiry.
- `me` in filters = the PAT owner.
- **Acceptance:** each §6.3 state has a mocked test and its own message; a test token never appears in logs, error payloads, exports or the renderer bundle; a read-only token reaches the issue list; a token missing Projects read names the permission, never an empty list.

#### D4 — Project and field mapping
- Onboarding step 2: repo, org, pick the project (list of org projects the token can read), pin it; map roles (§7.1) with suggestions.
- Generalize the predecessor's fixed extra fields into dimensions: field map, sync, read model, filters, grouping, board columns, triage, insights.
- **Acceptance:** a fixture project with differently named fields maps and works end to end; a project with no iteration field hides sprint features; renaming a mapped field keeps it mapped; deleting one shows "Missing field — remap"; Priority rank respects the highest/lowest-first setting.

### Phase B — Read-only product

#### D5 — Local sync
- The existing cycle runs in-process on an interval while the app runs; first connect imports with a progress screen; a cycle on launch, wake from sleep and "Sync now"; reconcile on launch if the last is older than 24 h.
- Remove cron/worker paths.
- **Acceptance (mocks):** first connect imports with progress; a remote change shows within one cycle; offline keeps data visible and marked stale; a 401 mid-session shows the token message, NOT an empty list; quitting mid-import and relaunching resumes.

#### D6 — Remove PRs
*Parallel with D7, D8.*
- Delete PR sync, tables, explorer, queues, panel, store, PR links in tasks and quick add, PR filters in project sources, PR views, PR tiles, PR risk rules, PR lines in release notes, the PR probe, PR fixtures and tests. Keep shared building blocks issues still use.
- **Acceptance:** no PR route, nav item, palette entry or text in the UI; sync makes no PR calls (request-log test); insights, sprint pages, notes, tasks and the issue panel pass.

#### D7 — Single-user tasks and views
*Parallel with D6, D8.*
- §7.6 removals; §7.2 local views with Copy/Import.
- **Acceptance:** tasks stay visible after connecting a different GitHub account; quick add keeps `@word` as title text; Copy → Import on a fresh install reproduces filters, sort, grouping and layout; only reminders and the watchlist digest create notifications.

#### D8 — Local data safety
*Parallel with D6, D7.*
- §7.7 in full.
- **Acceptance:** export → Reset everything → import restores all local-only data (minus token); a corrupted DB on launch offers restore and restores; rotation keeps 14; no backup contains the token (test).

#### D9 — Parent issue progress
- §7.4 in full.
- **Acceptance:** 2 closed + 2 open children shows **50% · 2/4**; no children shows nothing; after a child changes state and sync runs, the parent updates; each child opens in GitHub; partial child loading shows "Showing N of M" + Retry; filtering the list to one child doesn't change the parent; closed children older than the cache window still count.

#### D10 — Sprint view
- §7.5 in full.
- **Acceptance:** picking a sprint shows Remaining / Done / Not planned with matching header numbers; a filter makes the header say it's filtered; the current sprint resolves by date; no Sprint field, unreadable project and empty sprint each show their own message; planning controls are visible, disabled and say why.

#### D11 — Filtering and triage pass
- §7.2 additions and §7.3.
- **Acceptance:** each new filter has engine unit tests and round-trips through URL state and saved views; the default chip is visible and removable on every list it affects; empty / loading / error are distinguishable in every list (E2E); read-only triage mode shows the reason on edit keys.

#### D12 — Desktop-native tasks
- §7.6 desktop-native items.
- **Acceptance:** the global shortcut opens quick add from another app and saves a task; a reminder fires as a native notification within 60 s with the window closed and the app running; Complete and Snooze from the notification work; the dock badge matches Today; denying notification permission leaves the in-app bell working.

#### D13 — Todoist parity (optional)
- §7.6 Todoist parity items. Start only when the maintainer confirms.
- **Acceptance:** sections survive restart, reorder and backup/restore; un-completing from the Completed view returns the task to its project and section; ⌘K finds a task by a word only in its description.

#### D14 — macOS release v1.0 (read-only)
- `electron-builder` universal `.dmg`, hardened runtime, built with `DESKA_WRITES=off`. Signed and notarized when a Developer ID is available; otherwise unsigned with install steps in the release notes.
- Published as a **GitHub Release** on this repo. Builds contain no config or data.
- About window: version + link to Releases. No auto-update.
- `docs/handoff.md`: install and run, read and write permissions, what's read-only, where data and backups live, known limitations.
- **Acceptance:** a clean Mac installs from the `.dmg`, connects a read-only PAT, maps a project, uses every core view, and keeps tasks and settings after restart; the §10 test list passes.

### Phase C — Writes

Start only when the maintainer says so. Every write test runs against mocks or a sandbox org/project.

#### W0 — Write foundation
- §6.4 gate. Write client **operation allowlist** (§7.8 only); a test fails on any other mutation or REST method/path, including `deleteIssue`, `deleteProjectV2Item`, `transferIssue` and any field/option/iteration mutation.
- Outbox for one process: keep idempotency, per-issue+field ordering, retries, stale check, audit log and per-step tracking of multi-step jobs (close = state + Status); drop multi-worker lease logic.
- **Acceptance:** with any gate part off, nothing is written (one test per part); the allowlist test fails when a forbidden mutation is added; a crash between close and the Status update resumes correctly.

#### W1 — Planning writes
- §7.8 planning rows. Enable board drag, backlog drawer, bulk edit, move carry-over, triage keys.
- **Acceptance (sandbox):** each field writes and the UI shows GitHub's resulting value; a stale edit raises the conflict dialog; two different-label edits both survive; failure reverts with a toast; >50-issue bulk confirms with the count.

#### W2 — Close / reopen
- Done Status option chosen in Settings; close refused with a clear reason until set.
- **Acceptance (sandbox):** close sets state, reason and done Status; reopen leaves Status alone; a failed Status write after a successful close resumes on retry.

#### W3 — Create issue
- Form: title, body (markdown), Type, labels, assignees, milestone, mapped fields; optional parent if GitHub allows it at create **[Verify]**. One outbox job; the local row shows "pending" until GitHub confirms.
- **Acceptance (sandbox):** the issue appears on GitHub with all fields and once in Deska; a failure part-way resumes without creating a second issue.

---

## 10. Test plan (all pass for D14)

- Desktop: launch, quit, relaunch persistence, window close keeps the app running, local server rejects a missing secret and a wrong `Host`.
- Connection: every §6.3 state, offline, 5xx, rate limit.
- Mapping: suggested, changed, renamed and deleted fields.
- Issues: load, every filter, saved views, Copy/Import view, empty vs loading vs error.
- Sprint view and parent progress, including partial and out-of-cache children.
- Tasks: create, edit, complete, recurrence, reminders, quick add, global shortcut, persistence, backup/restore.
- PR removal didn't break shared code.
- The token never appears in logs, renderer, exports or backups.
- No mutating GitHub call in a `DESKA_WRITES=off` build (request-log assertion across E2E).
- Leak guard passes on every commit and in CI.

---

## 11. Order and parallel work

```
D0 ─┬─► D1 (probe, security doc)
    └─► D2 ─► D3 ─► D4 ─► D5 ─┬─► D6 ─┐
                              ├─► D7 ─┼─► D9 ─► D10 ─► D11 ─► D12 ─► D13? ─► D14 (v1.0)
                              └─► D8 ─┘
maintainer go ─► W0 ─► W1 ─► W2 ─► W3
```

---

## 12. Open questions

| # | Question | Needed by |
|---|---|---|
| Q1 | Support user-owned projects, not only org projects? | after D14 |
| Q2 | Code signing and notarization: which Developer ID, and is an unsigned v1.0 acceptable? | D14 |
| Q3 | Which Status options count as done in the sprint view by default: none, or ask during mapping? | D10 |
| Q4 | Should create-issue offer the repo's issue templates? | W3 |
| Q5 | Is Todoist parity (D13) worth doing before v1.0? | D13 |
