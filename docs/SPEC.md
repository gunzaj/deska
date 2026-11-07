# Deska — build runbook and spec

> **For the coding agent:** this one file is everything you need. Part 0 tells you how to work, Parts 1–4 define the product, and Part 5 is the build plan, step by step. Work through it on your own. Stop only at the stop points in §0.4.
> **[Default]** marks a decision already taken for you. Don't ask about it; build it, and change it later only if the maintainer says so.

---

# Part 0 — How to work

## 0.1 The loop

Repeat until you reach a stop point (§0.4):

1. Open `docs/PROGRESS.md` (create it in D0, template in §0.5). Pick the first milestone in Part 5 that isn't `done`.
2. Update `main`: `git checkout main && git pull`. Create a branch `d<N>-<short-name>` (e.g. `d2-desktop-shell`).
3. Read the milestone, and the sections of this file it points to. Inspect the existing code before changing anything.
4. Build it. Add or update the tests its acceptance criteria need.
5. Run every check locally (§0.3). Fix until all pass.
6. Commit (small commits are fine), push the branch, open a PR titled `D<N>: <milestone name>`. The PR body lists each acceptance criterion with how you checked it.
7. Wait for CI. If it fails, fix and push again.
8. When CI is green and every acceptance criterion is checked: **squash-merge the PR yourself** and delete the branch. [Default]
9. Update `docs/PROGRESS.md` (status, decisions you took, anything for the maintainer) in a small commit on `main`.
10. **End the session with the handoff message (§0.6).** One milestone per session. Don't start the next milestone in the same session.

## 0.2 Rules that are never broken

**This repo is public.**
- Never add real organization, company, product, repository or people names, real GitHub node IDs, real issue titles, internal links, tokens or emails. Use the fictional dataset: org `acme`, repo `acme/widgets`, project "Widgets Roadmap", people `alice`, `bob`, `carol`, `dave`.
- `private/` is the maintainer's gitignored folder. Don't read it unless the maintainer asks. NEVER copy anything from it into tracked files, commit messages, PR text or fixtures.
- Test fixtures and recorded GitHub responses are synthetic. Never commit a recording of a real repo.
- Never bypass the leak guard (`--no-verify`). If it flags something, remove the content; don't weaken the guard.
- Commits use a GitHub noreply email (`node scripts/leak-guard.mjs --staged --identity` checks it). In a new clone or worktree, run `git config core.hooksPath .githooks` first.

**GitHub safety.**
- Never write to a real GitHub repository or project from code, tests or scripts. Writes are tested with mocks only (until Phase C, see §0.4).
- Never call a delete operation. Never create, rename or delete project fields, options or iterations. Never remove project items.
- Never hardcode field names, option names or emoji. Discover them via GraphQL and store by ID.

**Code.**
- Reuse what works; don't rebuild an existing feature.
- Every bug fix and behavior change ships with a test.
- After D0, new tables/columns get a Drizzle migration; never edit a merged migration.
- If you change behavior this file describes, update this file in the same PR.
- Delete dead code when you remove a feature. No flags for removed features.

## 0.3 Checks before every PR

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e          # Playwright against mocks
node scripts/leak-guard.mjs --all
```

From D2 on, also `pnpm desktop:build` must succeed. CI runs the same checks; D0 extends the existing leak-guard workflow into a full CI workflow.

## 0.4 Stop points — the ONLY times you stop and wait

| When | Why | What you do |
|---|---|---|
| A milestone is merged | One milestone per session keeps your context fresh | Handoff message (§0.6), end the session |
| Your context was summarized/compacted during this milestone, or the milestone clearly won't fit in this session | Quality drops in very long sessions | Finish the current step, push the branch, open or update the PR as a **draft**, write exactly where you stopped in `docs/PROGRESS.md` on that branch, handoff message (§0.6), end |
| A milestone needs a real GitHub token, an Apple account, or any other credential | You don't have them | Build and test everything with mocks, add the step to "Maintainer to-do" in `PROGRESS.md`, **keep going** with the next milestone. Not a real stop. |
| D14 is merged | The read-only v1.0 is done | Create the GitHub Release as a **draft**, write the summary in `PROGRESS.md`, stop. The maintainer publishes it. |
| Phase C (W0–W3) | Writes need the maintainer's explicit go | Start only when the maintainer says so in chat. |
| Something would break a §0.2 rule | — | Don't do it. Find another way, or record the blocker in `PROGRESS.md` and move on to the next independent milestone. |

Anything else (an unclear detail, a design choice, a missing default): pick the simplest option consistent with this file, record it under "Decisions to review" in `PROGRESS.md`, and keep going. Do NOT stop to ask.

## 0.5 `docs/PROGRESS.md` template

```markdown
# Progress

| Milestone | Status | PR | Notes |
|---|---|---|---|
| D0 | done / in progress / blocked / todo | link | |

## Decisions to review
- D<N>: what you decided and why (one line each)

## Maintainer to-do
- [ ] Things only the maintainer can do (with the exact command or steps)

## Blockers
- (none)
```

`PROGRESS.md` is public: same hygiene rules as code.

## 0.6 Session handoff

Every session ends with this message to the maintainer, filled in. Nothing after it.

```
✅ <D<N> merged: PR link>   — or —   ⏸ D<N> paused: <where you stopped>, draft PR <link>

Next: <milestone> — <name>
Start a new session in this folder with model: <model from the table below>
Paste this:
  Read docs/SPEC.md and follow it, starting with Part 0.

Needs you: <"nothing" | the open Maintainer to-do items, one line each>
```

The paste text is always the same: `PROGRESS.md` tells the next session where to continue.

Recommended model per milestone:

| Model | Milestones | Why |
|---|---|---|
| Claude Opus 5.5 | D0, D2, D3, D4, D5, D9, D10, D12, W0, W1, W2, W3 | Risky or cross-cutting: scrubbing private data, the desktop shell, token security, the field model, sync, writes |
| Claude Sonnet 5.5 | D1, D6, D7, D8, D11, D13, D14 | Well-bounded: removals, local data features, filters, packaging |

When resuming a paused milestone, use that milestone's model.

---

# Part 1 — Product

## 1.1 Problem

- Teams that plan in **GitHub Issues + an org GitHub Project** get weak filtering, no clear progress on parent/overview issues, and no easy view of what's done vs remaining in a sprint.
- Triage on a big repo is slow in GitHub's UI.
- People mix GitHub work with personal to-dos ("update this ticket", "finish the spec for #1234") but keep them in a separate app.
- Hosted tools on top of GitHub need a server, an OAuth app and org approval for both.

## 1.2 Goal

**Deska** (Czech for "board") is a standalone **macOS desktop app** that:

1. Reads one GitHub repository and one **org Project (v2)** directly from GitHub with the user's **fine-grained personal access token** (PAT). No backend, no hosting.
2. Gives better filtering, fast triage, **parent issue progress** and a **sprint view**.
3. Has Todoist-like **personal tasks**, stored locally, linkable to GitHub issues.
4. Is **read-only first**. Writes (planning edits, close/reopen, create issue) come in Phase C and work only with a token that has write permissions.

GitHub stays the shared source of truth. Anyone without Deska can open every issue on GitHub.

## 1.3 NOT in scope

- Pull requests in any form.
- Sharing or assigning tasks to other people, shared saved views, any multi-user feature.
- A hosted server, OAuth app or backend.
- Windows and Linux builds.
- Multiple repositories or projects at once; user-owned (non-org) projects.
- Deleting issues, ever. Creating, renaming or deleting project fields, options or iterations. Removing project items.
- Editing issue title/body, posting GitHub comments, editing parent/sub-issue relationships.
- Auto-update. Code signing/notarization (added later when the maintainer has a Developer ID).

## 1.4 Starting point

The code comes from a **private predecessor**, `gunzaj/deska-old`, commit `3c2cd2a`: a hosted Next.js web app (Postgres, OAuth, background worker) with the same issue, triage and task features. D0 imports it, scrubbed. Its git history is NOT imported.

| Area | Predecessor | Deska desktop |
|---|---|---|
| Runtime | Next.js 15 web app, hosted, worker / cron | Same Next.js app run **locally inside Electron** (§2) |
| Storage | Postgres via `pg` + Drizzle, ~30 migrations, `pg_trgm` | **PGlite** (embedded Postgres) via Drizzle |
| Auth | GitHub OAuth, allowlist, org access mode, encrypted tokens in DB | **Gone.** One local user = the PAT owner. Token in Keychain-backed storage |
| Sync | REST change check + GraphQL detail + project item scan + nightly reconcile, Postgres advisory lock | Same code, **in-process** while the app runs |
| Writes | Outbox + worker + env write switch; never enabled | Kept, simplified to one process, behind the §3.4 gate |
| Field model | Fixed logical fields (Status, Priority, two extra single-selects, an iteration field), matched by name | **Mapped by the user** in onboarding (§4.1) |
| Issues | Explorer (list/board/table, filters, grouping, URL state), saved views, triage queues + triage mode + snoozes, sprint pages + planning + risk, epics, insights, watchlist, release notes draft, possible duplicates | **All kept**, minus PR parts |
| Parent progress | Counted from cached children only | GitHub's own `subIssuesSummary` (§4.4) |
| Tasks | Inbox/Today/Upcoming, projects, labels, quick add, recurrence, reminders, sub-tasks, comments, issue links, project GitHub source; plus assignees, Delegated, per-user visibility | Kept, **single-user** (§4.6) |
| PRs | PR sync, explorer, queues, panel, links | **Removed** |

---

# Part 2 — Architecture

## 2.1 Processes

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

This reuses the Next.js app, API routes and Postgres SQL almost as-is. **[Default]** If PGlite can't be made to work inside Electron after a real attempt, switch to `better-sqlite3`, port the raw SQL, record it in `PROGRESS.md`, and continue.

## 2.2 Local server hardening (all required)

- Binds to `127.0.0.1` only, random free port per launch.
- **Per-launch secret:** main generates 256 random bits, passes them to the server over IPC and sets them as an `HttpOnly`, `SameSite=Strict` cookie on the window session before the first load. Every request (pages and API) without it gets 403.
- Any `Host` other than `127.0.0.1:<port>` gets 403.
- Origin check on mutating requests and a strict CSP (both exist in the predecessor).
- Renderer: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, a minimal typed preload bridge (token entry, notifications, open-external, app info) and nothing else.
- Navigation locked to the app origin. `https://github.com/*` opens in the default browser via `shell.openExternal`. Every other external URL is blocked.
- Nothing is loaded from the network at runtime except the GitHub API. (Automated tests may point the API at a mock on `http://127.0.0.1:<port>` with `DESKA_GITHUB_API_URL`; any other value is ignored.)

## 2.3 Token

- Entered in onboarding or Settings through the preload bridge to **main**, never through HTTP.
- Main encrypts it with `safeStorage`, stores the ciphertext in the app data dir, and hands the plaintext to the server over IPC. The server keeps it in memory only.
- Never in the renderer, env vars, logs, error messages, exports or backups. Redaction covers `github_pat_…` and any value equal to the token.
- "Disconnect GitHub" deletes it. GitHub cache and tasks stay.

## 2.4 Settings (non-secret)

Stored locally: repo, org, project number + node ID (pinned after discovery), field mapping (§4.1), done Status options (§4.5), done Status for close (W2), writes toggle, global shortcut, notifications, launch at login, dock badge, time zone. **No defaults point at any real org or repo.** Tests and dev set them through env vars.

**[D4]** Settings live in the `app_settings` table (`github.target`, `project.mapping`), apart from the GitHub cache. The `GITHUB_REPO` / `GITHUB_ORG` / `GITHUB_PROJECT_NUMBER` env vars are only a fallback for tests, dev and the maintainer's CLI tools; the desktop app opens onboarding step 2 until a project and a mapping are stored.

## 2.5 Removed with the server

OAuth/Auth.js, allowlist and org-access mode, DB token encryption and its key, a shared server token, hosting config (Vercel, Docker), cron routes, the worker script, the health endpoint, and allowlist middleware (replaced by §2.2).

---

# Part 3 — GitHub access and security

## 3.1 Token type

A **fine-grained PAT**, resource owner = the org, repository access = **only the one repository** Deska reads. Classic PATs and OAuth are NOT supported.

## 3.2 Permissions

| Permission | Read-only | With writes | Used for |
|---|---|---|---|
| Repository → Metadata | Read (mandatory) | Read | Repo info, assignable users, labels, milestones |
| Repository → Issues | **Read** | **Read and write** | Issues, sub-issues, issue types on issues, comments, rendered bodies; with writes: fields, labels, assignees, close/reopen, create |
| Organization → Projects | **Read** | **Read and write** | Project fields, options, iterations, item values; with writes: set values, add new issues to the project |
| Organization → Issue types | Read, optional | Read, optional | `organization.issueTypes`. **[Default]** If refused, Type shows as unavailable instead of failing |
| Anything else | NOT requested | NOT requested | — |

Facts for security reviewers (D1 puts them in `docs/security.md`):
- GitHub has no separate "delete issue" permission; deleting needs the **repo admin role**. Deska never calls a delete: the write client has an **operation allowlist** and a test fails on anything else.
- The Projects permission is org-wide; GitHub can't scope a PAT to one project. Deska pins the project node ID and refuses to write anywhere else.
- A read-only PAT makes writes impossible on GitHub's side, whatever the code does.
- Orgs may require admin approval of fine-grained PATs and cap their lifetime.

## 3.3 Token states the app tells apart

Implement from GitHub's documented behavior and test with mocked responses.

| State | Signal | What the user sees |
|---|---|---|
| Missing | no token stored | Onboarding |
| Invalid / revoked / expired | 401 | "Your GitHub token is invalid or expired" + Replace token |
| Expiring soon | `github-authentication-token-expiration` header < 14 days | Warning with the date |
| Awaiting org approval | org resources refused while `GET /user` works | "Your org may still need to approve this token" |
| Missing a permission | 403 "Resource not accessible by personal access token" | Names the permission, e.g. "Organization → Projects: Read" |
| Read-only | write permissions absent (**[D3]** they can't be read off a fine-grained token without trying a write, so every token counts as read-only until W0 adds detection) | App works; edit controls disabled with "Read-only token" |
| Offline / GitHub down | network error / 5xx | "Can't reach GitHub"; cached data stays, marked stale |
| Rate limited | 403/429 with remaining = 0 | "Rate limited until HH:MM" |

An error is NEVER shown as an empty list.

## 3.4 Write gate

A GitHub write happens only when all three hold:
1. The token has the write permissions (§3.3).
2. Settings → "GitHub writes" is on. Off by default, and off again after every token change.
3. The build allows writes. `DESKA_WRITES=off` at build time produces a binary that refuses writes regardless of 1 and 2. v1.0 is built with it off.

---

# Part 4 — Requirements

## 4.1 Project and field mapping

| Role | Field type | Required | Used by |
|---|---|---|---|
| Status | single-select | Yes | Boards, triage, sprint view, close |
| Priority | single-select | No | Sort, triage keys `1`–`4`, risk. Option order is rank; setting "highest first / lowest first" because projects differ |
| Sprint | iteration | No | Sprint view, planning, carry-over. Without it, sprint features are hidden |
| Dimensions | single-select, 0–n | No | Any other single-selects (e.g. Team, Platform): filter, group, board columns. One may be the "My default" dimension (§4.2) |

- Onboarding suggests a mapping by field name and type; the user confirms or changes it. Settings can remap later.
- Stored by **field ID**. A renamed field stays mapped. A deleted field shows "Missing field — remap" instead of blank values.
- **[D4]** Sync keeps every single-select and iteration value of a project item by field ID (`project_item_dims`), besides the Status, Priority and Sprint columns, so a remap needs no new scan. Dimensions are keyed `dim:<fieldId>` in filters, grouping, sort, board columns, edits, saved views and Insights scopes. Suggestions: Status/Priority/Sprint by name and type, every other single-select as a dimension; Priority order guessed from the option names (highest first when unclear). The first mapped dimension is the one triage ("missing Priority or <dimension>"), planning, the sidebar and the triage `T` key use. A field GitHub stops listing gets `missing_at` (never deleted); "Reload fields" in Settings reads the fields again.
- Native properties (type, labels, milestone, assignees, parent, state) need no mapping.
- Current sprint = the iteration whose `start ≤ today < start + duration`; previous/next by date.

## 4.2 Issues and filtering

Keep the explorer, saved views, layouts, grouping, URL state, ⌘K, `G` navigation and shortcuts.

Add / change:
- **New filters:** Author; In project (yes / no); Closed reason (completed / not planned); Sub-issue progress (none, not started, in progress, done); any mapped dimension.
- **No hidden filters.** A "My default" dimension value shows as a visible chip ("Default: Platform team ✕"). Any list with ≥1 active filter shows the count and "Clear all".
- **Empty vs loading vs error:** three distinct states in every list. Empty names the active filters and offers "Clear filters". Errors follow §3.3.
- **Saved views are local**, no shared visibility. **Copy view** puts a compact JSON string on the clipboard; **Import view** reads it. Field and option IDs travel inside.
  **[D7]** Copy view is in the view's ⋯ menu; Import view is a button on Views, with a text box to paste into (the window grants clipboard *write* only, §2.2). The string is `{"kind":"deska-view","v":1,"view":{…}}` without the ID. Import checks it with the same strict schema and limits as any view, never takes an ID from it, and saves a new view.
- Parent progress is never recalculated from the filtered list (§4.4).

## 4.3 Triage

Keep queues (needs triage, new this week, not in a sprint, unassigned in the current sprint, stale), triage mode (one issue at a time) and snoozes. Read-only: triage mode is a walk-through and edit keys say "Read-only token". Snoozes are local.

## 4.4 Parent issue progress

- **Source:** GitHub's `Issue.subIssuesSummary { total completed percentCompleted }`, synced and stored per issue. **[Default]** Show GitHub's numbers as they are; tooltip "Counted by GitHub".
- **Display:** `50% · 2/4` in rows (a "Progress" cell/column), the issue panel, the Epics page and the sprint view, with a small bar where there's room.
- **No children** (`total = 0`): nothing. Never 0% or 100%.
- **Not loaded yet:** `— progress not loaded`, never a number.
- **Children list** in the issue panel: number, title, state, Status, link to GitHub. Fetched live on open (`subIssues`, paged), so children outside the cache and in other repos show. Partial failure: "Showing 40 of 52 — couldn't load the rest" + Retry.
- **Filters don't change it.**
- Sort by progress in the explorer and on the Epics page.
- Direct children only.

**[D9]** The counts are read with every issue fetch (`subIssuesSummary { total completed }`), stored in `issues.sub_total`, `sub_completed`, `sub_summary_at` and sent to the browser as GitHub reports them; nothing is counted from cached children. A poll also re-reads the parents (same repository) of the issues that changed, because a child closing doesn't touch its parent's `updated_at`, and the nightly reconcile re-reads every open issue and every parent, which also catches a child added or removed. `percentCompleted` isn't stored: the percentage is `round(completed / total)`, which is what GitHub shows. Rows with cached children but no counts yet read "— progress not loaded"; rows with neither show nothing. The children list is `GET /api/issues/[n]/sub-issues` (one page of 50 per call, cursor in `after`), with each child's Status read from the pinned project; the panel follows the cursor and says "Showing N of M — couldn't load the rest" + Retry when a page fails. Without a token, or when GitHub can't be reached on the first page, the cached children are served as one page.

## 4.5 Sprint view

A sprint is one iteration of the mapped Sprint field. Build on the predecessor's sprint pages (overview, per-sprint board, planning, risk, notes); don't add a parallel one.

- **Picker:** current by default, previous/next (`[` / `]`), any iteration.
- **Header:** done X / Y and %, days left, counts by Status, scope added since the sprint started.
- **Remaining vs Done:** open = Remaining; closed as completed = Done; closed as "not planned" in a collapsed group, excluded from the %. **[Default]** Mapping step offers "Status options that also count as done", empty by default.
- **Layouts:** board by Status (default) and list. All §4.2 filters apply; the header then shows the filtered numbers and says so ("Platform team · 12 / 30").
- Parent progress on items with sub-issues.
- **Missing data:** no Sprint field mapped, project unreadable and empty sprint each get their own message.
- **Planning actions** (drag between columns, backlog drawer, move carry-over, bulk edit, triage keys) are visible but disabled with the reason until writes are on.
- Keep planning (current vs next with carry-over), risk (without PR rules) and the release-notes draft (without PR lines).

## 4.6 Personal tasks (Todoist-like)

Keep for one person: Inbox, Today, Upcoming, projects (with an optional GitHub source filter), labels, natural-language quick add, priorities, due dates and times, recurrence, reminders, sub-tasks, manual ordering, drag and drop, comments (as notes), issue links and "Add to tasks" from issues, undo toasts.

Remove (D7): assignees, the Delegated view, `@person` in quick add, "not on Deska yet" hints, per-user visibility (all local tasks belong to this install, whichever GitHub account is connected), and notifications other than reminders and the watchlist digest.

Add — desktop-native (D12):
- **Global quick add:** system-wide shortcut (default `⌃⌥Space`, configurable) opens a small floating quick-add window from any app. Enter saves and closes; Esc closes.
- **Native notifications** for reminders with Complete, Snooze 1 h and Tomorrow. Clicking opens the task.
- **Dock badge:** overdue + today count (toggle).
- Closing the window keeps Deska running so sync and reminders continue; ⌘Q quits. Opt-in launch at login.

Add — Todoist parity (D13):
- **Sections** in a project (create, rename, reorder, collapse, drag tasks between them).
- **Completed** view: last 30 days grouped by day, with un-complete.
- ⌘K task search covers descriptions and comments.

**[D7]** Everything local (tasks, projects, labels, sections, saved views, snoozes, watches, notifications, settings) is keyed by one constant owner, `LOCAL_OWNER` (`lib/local-owner.ts`), never by a GitHub login: connecting a different account changes what `me` means in issue filters and nothing else. Task `creator`, `completedBy` and comment `author` stay in the model and always hold it. Notifications are only `reminder` and `watch_digest`. Migration 0004 collapses data written by the multi-user build (same-name projects and labels are renamed, one placement per task, newest snooze and oldest last-seen kept).

Rules: tasks never write to GitHub; a closed linked issue shows a badge but never auto-completes the task; tasks and issues always look distinct (checkbox vs status icon).

## 4.7 Local data safety

- **Automatic backup** daily and before every migration: JSON of all local-only data (tasks, projects, labels, sections, views, snoozes, watches, settings) in `~/Library/Application Support/Deska/backups/`, last 14 kept.
- **Export / Import** in Settings. Import merges by ID; never touches the GitHub cache.
- **Reset GitHub cache** (re-import, tasks kept) and **Reset everything** (asks twice).
- A DB that fails to open offers "Restore from latest backup".
- Backups and exports NEVER contain the token.

**[D8]** Backups and exports are one JSON document, `{"kind":"deska-backup","v":1,"createdAt","schemaVersion","tables":{…}}`, with one array of rows per local table (settings, views, task projects/labels/tasks/placements/links/label links/completions/reminders/comments, notifications, user prefs, snoozes, watches; sections join in D13). Rows are read generically (`to_jsonb`), so a backup can be taken from the schema before a migration. Backups are `deska-backup-<UTC time>-<daily|migration|reset|manual>.json` (owner-only), written atomically, the newest 14 kept; a daily check runs hourly while the app runs, "before every migration" means pending migrations on a database that already has data, and "Reset everything" takes a `reset` backup first. Import merges by primary key inside one transaction: an existing row (or one that collides with a unique index) is kept, rows whose parent is missing are skipped, strict-schema-invalid views are skipped, and a file from a newer schema or with an unknown table is refused. Every string is redacted, so a token pasted into a task becomes `[redacted]`. "Reset GitHub cache" empties the cache tables and the sync cursors (the PAT owner, the view seeding flag and the ETag generation stay) and starts a first import; settings (project and mapping) stay. "Reset everything" empties every table; the GitHub token stays until "Disconnect GitHub". A database that fails to open is noted by the server; before it opens the window the shell asks "Restore from latest backup" / "Start empty" / "Quit", and recovery moves the damaged folder to `db.damaged-<time>` (nothing is deleted), opens a fresh database and imports the newest readable backup.

## 4.8 Writes (Phase C)

| Write | API | Milestone |
|---|---|---|
| Sprint, Status, Priority, dimensions | `updateProjectV2ItemFieldValue` / `clearProjectV2ItemFieldValue`; `addProjectV2ItemById` first if needed | W1 |
| Assignees, labels | REST add/remove, as deltas | W1 |
| Type, milestone | `updateIssueIssueType`; REST `PATCH` milestone | W1 |
| Close / reopen | REST `PATCH state, state_reason`; close also sets Status to the done option chosen in Settings | W2 |
| Create issue | REST `POST /issues`, add to project, set fields — one outbox job | W3 |

Every write: only after an intentional user action; optimistic UI; a stale-value check before writing ("Changed on GitHub by X → Keep theirs / Overwrite"); a success or failure toast; then the issue is re-read and GitHub's resulting state shown. Bulk edits over 50 issues confirm first. No delete anywhere.

---

# Part 5 — Build plan

Build in this order. One PR per milestone. Data model changes are listed inside each milestone.

## Phase A — Groundwork

### D0 — Import the predecessor, scrubbed
Steps:
1. `gh repo clone gunzaj/deska-old "$TMPDIR/deska-old"` (outside this repo), then `git -C "$TMPDIR/deska-old" checkout 3c2cd2a`.
2. Copy into this repo: `app/`, `components/`, `lib/`, `db/`, `scripts/` (except `probe*.ts`), `tests/`, `middleware.ts`, `instrumentation*.ts`, the root config files (`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.json`, `next.config.ts`, `drizzle.config.ts`, `eslint.config.mjs`, `postcss.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `.env.example`) and `.github/workflows/` (merge with the existing leak-guard workflow).
3. Do NOT copy: `.git`, `.claude/`, `docs/`, `drizzle/` (see 5), `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `vercel.json`, `README.md`, `AGENTS.md`, `node_modules`, `.next*`, `.env`, `test-results`.
4. Replace demo data (`lib/demo/*`), test fixtures and recorded GitHub responses with the fictional dataset (§0.2). Regenerate them; don't search-and-replace real recordings. Remove every real org/repo default from config.
5. Generate one fresh baseline migration from `db/schema.ts` (`pnpm db:generate`). Seed data in it uses the fictional dataset only.
6. Run `node scripts/leak-guard.mjs --all` and fix every finding by removing or replacing content. Delete `$TMPDIR/deska-old` when done.
7. Create `docs/PROGRESS.md` (§0.5).
- No feature work and no removals beyond the above.
- **Acceptance:** `pnpm install && pnpm dev` runs on demo data; all §0.3 checks pass locally and in CI; a test fails if any tracked file contains a GitHub node ID (`PVT_`, `PVTF_`, `PVTSSF_`, `PVTIF_`, `IT_` prefixes) outside the fictional fixture set.

### D1 — Token probe + security doc
- `scripts/probe-pat.ts` (`pnpm probe:pat`): read-only; repo, org and project come from env; output goes to `private/findings/` (gitignored), never a tracked file. Records which of Deska's calls succeed (issues REST with `since`, GraphQL issue detail with `issueType`, `parent`, `subIssues`, `subIssuesSummary`, project fields/options/iterations, items with `items(query:)`, `organization.issueTypes`, assignable users, labels, milestones, comments, rendered body) and the raw status/message of failures.
- `docs/security.md` (public): architecture (§2), read and write permission tables (§3.2), token storage, local server hardening, what's stored on disk, what Deska never does, the write gate (§3.4).
- Add to "Maintainer to-do": create a read-only fine-grained PAT (§3.2) and run `pnpm probe:pat` with the exact env vars.
- **Acceptance:** a test asserts the probe's client rejects non-GET REST calls and any GraphQL `mutation`; `docs/security.md` exists and contains nothing org-specific.

### D2 — Desktop shell on PGlite
- Electron main, preload and a utilityProcess running the Next standalone build. §2.2 complete.
- `db/` uses PGlite via Drizzle (remove the `pg` pool). Migrations run on PGlite, including `pg_trgm`; if it won't load, Possible duplicates uses the existing in-memory similarity fallback.
- Advisory sync lock → in-process mutex. Postgres-backed tests run on PGlite (no Docker).
- `pnpm desktop:dev`; `pnpm desktop:build` (unsigned universal `.dmg`). Demo data until D5 (in-process sync).
- **Acceptance:** the built app opens with demo data and no server started by hand; a saved view survives relaunch; a request without the secret cookie or with a wrong `Host` gets 403; GitHub links open the default browser, other external URLs are blocked; a Playwright `_electron` smoke test launches the app and loads the issue list.

### D3 — Local identity and token
- Remove everything in §2.5 not already gone.
- Onboarding step 1: paste PAT (with a "How to create it" guide listing §3.2) → `GET /user` → capability check (§3.3). Settings: replace token, disconnect, detected permissions, expiry. `me` in filters = the PAT owner. Drop token storage from the DB.
- **[D3]** Until D4 stores the repository and project, the capability check reads the ones in `GITHUB_REPO` / `GITHUB_ORG` / `GITHUB_PROJECT_NUMBER`; without them it checks `GET /user` only and lists the permissions as not checked yet. **[D4]** It now checks the stored project first; the env vars remain a fallback for tests and dev.
- **Acceptance:** each §3.3 state has a mocked test and its own message; a test token never appears in logs, error payloads, exports or the renderer bundle; a read-only token reaches the issue list; a token missing Projects read names the permission, never an empty list.

### D4 — Project and field mapping
- Onboarding step 2: repo, org, pick the project (org projects the token can read), pin it; map roles (§4.1) with suggestions, plus "Status options that also count as done" (§4.5).
- Generalize the predecessor's fixed extra fields into dimensions everywhere: field map, sync, read model, filters (`dim:<fieldId>`), grouping, board columns, triage, insights. Migration for dimension values keyed by field ID.
- **Acceptance:** a fixture project with differently named fields maps and works end to end; a project with no iteration field hides sprint features; renaming a mapped field keeps it mapped; deleting one shows "Missing field — remap"; Priority rank follows the highest/lowest-first setting.

## Phase B — Read-only product

### D5 — Local sync
- The existing cycle runs in-process on an interval while the app runs; first connect imports with a progress screen; a cycle on launch, wake from sleep and "Sync now"; reconcile on launch if the last is older than 24 h. Remove cron/worker paths.
- **Acceptance (mocks):** first connect imports with progress; a remote change shows within one cycle; offline keeps data visible and marked stale; a 401 mid-session shows the token message, NOT an empty list; quitting mid-import and relaunching resumes.

### D6 — Remove PRs
- Delete PR sync and tables (migration), explorer, queues, panel, store, PR links in tasks and quick add, PR filters in project sources, PR views, PR tiles, PR risk rules, PR lines in release notes, PR fixtures and tests. Keep shared building blocks issues still use.
- **Acceptance:** no PR route, nav item, palette entry or text in the UI; sync makes no PR calls (request-log test); insights, sprint pages, notes, tasks and the issue panel pass.

### D7 — Single-user tasks and views
- §4.6 removals (migration drops task assignee and the removed notification kinds); §4.2 local views with Copy/Import (drop view visibility).
- **Acceptance:** tasks stay visible after connecting a different GitHub account; quick add keeps `@word` as title text; Copy → Import on a fresh install reproduces filters, sort, grouping and layout; only reminders and the watchlist digest create notifications.

### D8 — Local data safety
- §4.7 in full.
- **Acceptance:** export → Reset everything → import restores all local-only data (minus token); a corrupted DB on launch offers restore and restores; rotation keeps 14; no backup contains the token (test).

### D9 — Parent issue progress
- §4.4 in full. Migration: `issues.sub_total`, `sub_completed`, `sub_summary_at`.
- **Acceptance:** 2 closed + 2 open children shows **50% · 2/4**; no children shows nothing; after a child changes state and sync runs, the parent updates; each child opens in GitHub; partial child loading shows "Showing N of M" + Retry; filtering the list to one child doesn't change the parent; closed children older than the cache window still count.

### D10 — Sprint view
- §4.5 in full.
- **Acceptance:** picking a sprint shows Remaining / Done / Not planned with matching header numbers; Status options marked as done count as done; a filter makes the header say it's filtered; the current sprint resolves by date; no Sprint field, unreadable project and empty sprint each show their own message; planning controls are visible, disabled and say why.

### D11 — Filtering and triage pass
- §4.2 additions and §4.3.
- **Acceptance:** each new filter has engine unit tests and round-trips through URL state and saved views; the default chip is visible and removable on every list it affects; empty / loading / error are distinguishable in every list (E2E); read-only triage mode shows the reason on edit keys.

### D12 — Desktop-native tasks
- §4.6 desktop-native items.
- **Acceptance:** the global shortcut opens quick add from another app and saves a task; a reminder fires as a native notification within 60 s with the window closed and the app running; Complete and Snooze from the notification work; the dock badge matches Today; denying notification permission leaves the in-app bell working.

### D13 — Todoist parity
- §4.6 Todoist parity items. Migration: `task_sections`, `tasks.section_id`.
- **Acceptance:** sections survive restart, reorder and backup/restore; un-completing from the Completed view returns the task to its project and section; ⌘K finds a task by a word only in its description.

### D14 — macOS release v1.0 (read-only)
- `electron-builder` universal `.dmg`, hardened runtime, built with `DESKA_WRITES=off`, unsigned. Release notes include "how to open an unsigned app" steps.
- About window: version + link to Releases. No auto-update.
- `docs/handoff.md`: install and run, read and write permissions, what's read-only, where data and backups live, known limitations.
- A GitHub Actions workflow builds the `.dmg` on a `v*` tag.
- Create the GitHub Release `v1.0.0` as a **draft** with the `.dmg` attached. **STOP** (§0.4).
- **Acceptance:** a clean Mac installs from the `.dmg`, connects a read-only PAT, maps a project, uses every core view, and keeps tasks and settings after restart (verify everything except the real-token step with mocks; add the real-token check to "Maintainer to-do"); the Part 6 test list passes.

## Phase C — Writes (only after the maintainer says go)

All write tests use mocks. Real-GitHub verification goes in "Maintainer to-do" (a sandbox org/project with the same field types).

### W0 — Write foundation
- §3.4 gate. Write client **operation allowlist** (§4.8 only); a test fails on any other mutation or REST method/path, including `deleteIssue`, `deleteProjectV2Item`, `transferIssue` and any field/option/iteration mutation.
- Outbox for one process: keep idempotency, per-issue+field ordering, retries, stale check, audit log and per-step tracking of multi-step jobs (close = state + Status); drop multi-worker lease logic.
- **Acceptance:** with any gate part off, nothing is written (one test per part); the allowlist test fails when a forbidden mutation is added; a crash between close and the Status update resumes correctly.

### W1 — Planning writes
- §4.8 planning rows. Enable board drag, backlog drawer, bulk edit, move carry-over, triage keys.
- **Acceptance (mocks):** each field writes and the UI shows the resulting value; a stale edit raises the conflict dialog; two different-label edits both survive; failure reverts with a toast; >50-issue bulk confirms with the count.

### W2 — Close / reopen
- Done Status for close chosen in Settings; close refused with a clear reason until set.
- **Acceptance (mocks):** close sets state, reason and done Status; reopen leaves Status alone; a failed Status write after a successful close resumes on retry.

### W3 — Create issue
- Form: title, body (markdown), Type, labels, assignees, milestone, mapped fields. **[Default]** No issue templates and no parent at create in this version. One outbox job; the local row shows "pending" until GitHub confirms.
- **Acceptance (mocks):** the issue is created with all fields and appears once in Deska; a failure part-way resumes without creating a second issue.

---

# Part 6 — Test list (all pass for D14)

- Desktop: launch, quit, relaunch persistence, window close keeps the app running, local server rejects a missing secret and a wrong `Host`.
- Connection: every §3.3 state, offline, 5xx, rate limit.
- Mapping: suggested, changed, renamed and deleted fields.
- Issues: load, every filter, saved views, Copy/Import view, empty vs loading vs error.
- Sprint view and parent progress, including partial and out-of-cache children.
- Tasks: create, edit, complete, recurrence, reminders, quick add, global shortcut, sections, persistence, backup/restore.
- PR removal didn't break shared code.
- The token never appears in logs, renderer, exports or backups.
- No mutating GitHub call in a `DESKA_WRITES=off` build (request-log assertion across E2E).
- Leak guard passes on every commit and in CI.
