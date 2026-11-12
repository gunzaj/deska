# Deska — build runbook and spec

> **For the coding agent:** this one file is everything you need. Part 0 tells you how to work, Parts 1–4 define the product, and Part 5 is the build plan, step by step. Work through it on your own. Stop only at the stop points in §0.4.
> **[Default]** marks a decision already taken for you. Don't ask about it; build it, and change it later only if the maintainer says so.

---

# Part 0 — How to work

## 0.1 The loop

Repeat until you reach a stop point (§0.4):

1. Open `docs/PROGRESS.md` (create it in D0, template in §0.5). Pick the first milestone in Part 5 that isn't `done`. Skip Phase C until the maintainer says go (§0.4).
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
| Phase C (W0–W3) | Writes need the maintainer's explicit go | Start only when the maintainer says so in chat. Until then, skip it and continue with Phase D. |
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
| Claude Opus 5.5 | D0, D2, D3, D4, D5, D9, D10, D12, W0, W1, W2, W3, D15, AI0, AI1 | Risky or cross-cutting: scrubbing private data, the desktop shell, token security, the field model, sync, writes, untrusted text sent to a model |
| Claude Sonnet 5.5 | D1, D6, D7, D8, D11, D13, D14, AI2, AI3, AI4 | Well-bounded: removals, local data features, filters, packaging, features on the AI0 foundation |

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

1. Reads one GitHub repository and one **Project (v2)** owned by an organization or, **[changed after D14]**, by a user directly from GitHub with the user's **fine-grained personal access token** (PAT). No backend, no hosting.
2. Gives better filtering, fast triage, **parent issue progress** and a **sprint view**.
3. Has Todoist-like **personal tasks**, stored locally, linkable to GitHub issues.
4. Is **read-only first**. Writes (planning edits, close/reopen, create issue) come in Phase C and work only with a token that has write permissions.
5. **[Added after D14, at the maintainer's request]** Offers **optional AI assist** for triage and tasks (§4.9): through the user's own Claude Code CLI or any OpenAI-compatible endpoint, including a model server on the user's own network. It only suggests; the user decides.

**[Changed after D14, at the maintainer's request]** Instead of a PAT, the user can connect with the login of the **GitHub CLI** they already use (§3.1).

GitHub stays the shared source of truth. Anyone without Deska can open every issue on GitHub.

## 1.3 NOT in scope

- Pull requests in any form.
- Sharing or assigning tasks to other people, shared saved views, any multi-user feature.
- A hosted server, a backend, or an OAuth app or OAuth flow of Deska's own. (Reading the GitHub CLI's existing login, §3.1, is neither.)
- AI that acts on its own: agents with tools, auto-applied suggestions, scheduled or background AI runs, AI over source code or pull requests, bundling or hosting a model.
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
  ├─ token store (safeStorage → Keychain-backed key), AI API key store (same)
  ├─ login-shell PATH, resolved once per launch (finds `gh` and `claude`) [after D14]
  └─ spawns ─► utilityProcess: Next.js standalone server
                 ├─ binds 127.0.0.1:<random free port>
                 ├─ API routes, view engine, task service
                 ├─ sync loop (in-process)
                 ├─ outbox (writes)
                 ├─ AI jobs (§4.9): spawns `claude -p` or calls the configured endpoint [after D14]
                 └─ PGlite DB in ~/Library/Application Support/Deska/db
Renderer (BrowserWindow) loads http://127.0.0.1:<port>/ — the React UI
```

This reuses the Next.js app, API routes and Postgres SQL almost as-is. **[Default]** If PGlite can't be made to work inside Electron after a real attempt, switch to `better-sqlite3`, port the raw SQL, record it in `PROGRESS.md`, and continue.

## 2.2 Local server hardening (all required)

- Binds to `127.0.0.1` only, random free port per launch.
- **Per-launch secret:** main generates 256 random bits, passes them to the server over IPC and sets them as an `HttpOnly`, `SameSite=Strict` cookie on the window session before the first load. Every request (pages and API) without it gets 403.
- Any `Host` other than `127.0.0.1:<port>` gets 403.
- Origin check on mutating requests and a strict CSP (both exist in the predecessor).
- Renderer: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, a minimal typed preload bridge (token entry, notifications, open-external, app info; **[D12]** the desktop settings, closing the quick-add window and a "open this task" event; **[AI0]** the AI API key: set, remove and whether one is stored, never the key; **[D15]** the GitHub sign-in source: its state, "use the GitHub CLI login" and "check again", never a token) and nothing else.
- Navigation locked to the app origin. `https://github.com/*` opens in the default browser via `shell.openExternal`. Every other external URL is blocked.
- Nothing is loaded from the network at runtime except the GitHub API and, **[after D14]** once the user sets one up, the AI endpoint of §4.9 (called from the server process only; the CSP doesn't change). (Automated tests may point the API at a mock on `http://127.0.0.1:<port>` with `DESKA_GITHUB_API_URL`; any other value is ignored.)

## 2.3 Token

- Entered in onboarding or Settings through the preload bridge to **main**, never through HTTP.
- Main encrypts it with `safeStorage`, stores the ciphertext in the app data dir, and hands the plaintext to the server over IPC. The server keeps it in memory only.
- Never in the renderer, env vars, logs, error messages, exports or backups. Redaction covers `github_pat_…` and any value equal to the token.
- "Disconnect GitHub" deletes it. GitHub cache and tasks stay.
- **[Changed after D14, at the maintainer's request]** **GitHub CLI source.** With "Use my GitHub CLI login" (§3.1), main stores no token, only `githubAuthSource: "gh"` in `desktop-prefs.json`. It runs `gh auth token --hostname github.com` (from the login-shell PATH, §2.1) at launch, on wake, once after a 401, and on "Check again", and hands the result to the server in the same IPC message as a stored token. Deska never writes this token to disk and never passes it to another process in arguments or environment. "Disconnect GitHub" turns the source off; it doesn't log the GitHub CLI out. Switching source counts as a token change (writes off, §3.4).
- **[Added after D14]** The AI API key (§4.9) follows the same rules as the token: entered through the preload bridge, encrypted by main, held in memory by the server, redacted everywhere, never in backups or exports. "Remove key" deletes it.

## 2.4 Settings (non-secret)

Stored locally: repo, org, project number + node ID (pinned after discovery), field mapping (§4.1), done Status options (§4.5), done Status for close (W2), writes toggle, global shortcut, notifications, launch at login, dock badge, time zone, **[after D14]** GitHub sign-in source (`desktop-prefs.json`, §2.3), AI provider, model, base URL, timeout and extra instructions, plus the transcription source, its base URL, model and local server URL (§4.9; the API keys are secrets, §2.3). **No defaults point at any real org or repo.** Tests and dev set them through env vars.

**[D4]** Settings live in the `app_settings` table (`github.target`, `project.mapping`), apart from the GitHub cache. The `GITHUB_REPO` / `GITHUB_ORG` / `GITHUB_PROJECT_NUMBER` env vars are only a fallback for tests, dev and the maintainer's CLI tools; the desktop app opens onboarding step 2 until a project and a mapping are stored.

**[Changed after D14, at the maintainer's request]** **Tasks only.** Onboarding step 1 has "Skip, use tasks only". The `app.tasks-only` setting then skips the token, project and first-import gates, the local user is the stand-in `local`, the sidebar hides every GitHub block and shows "Connect GitHub", and nothing is sent to GitHub. Choosing a project in onboarding step 2 turns it off.

## 2.5 Removed with the server

OAuth/Auth.js, allowlist and org-access mode, DB token encryption and its key, a shared server token, hosting config (Vercel, Docker), cron routes, the worker script, the health endpoint, and allowlist middleware (replaced by §2.2).

---

# Part 3 — GitHub access and security

## 3.1 Token type

A **fine-grained PAT**, resource owner = the org, repository access = **only the one repository** Deska reads. **[Changed after D14, at the maintainer's request]** A **classic PAT** (`ghp_…`) is also accepted so the app works while an org has not approved a fine-grained token; use it with read-only scopes only (`read:project`, plus `read:org` if needed, for a public repository). Settings warns when its scopes can write (`x-oauth-scopes`).

**[Changed after D14, at the maintainer's request]** **GitHub CLI login.** When the GitHub CLI (`gh`) is installed and logged in, onboarding offers to use that login instead of a pasted token. Deska reads the token with `gh auth token --hostname github.com`. It is an OAuth token (`gho_…`) issued to the GitHub CLI's own OAuth app. An org that restricts OAuth apps approves the GitHub CLI once for all its members, so this often works while a fine-grained PAT is still waiting for approval.
- Scopes are classic: `gh`'s defaults include `repo` and `read:org`; Deska also needs `read:project` (`project` for writes), which the user adds with `gh auth refresh -h github.com -s read:project`. Settings reads them from `x-oauth-scopes` and names any that are missing.
- `repo` can write to every repository the user can, so a GitHub CLI token always counts as able to write. The §3.4 gate is what keeps Deska read-only with it, and Settings says so.
- Deska never runs `gh auth login` or `gh auth refresh` itself (it shows the command), never uses the GitHub CLI's client ID, and has no OAuth app or flow of its own. Those stay NOT supported.

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
| Read-only | write permissions absent (**[W0]** detected with read-only queries: a classic or GitHub CLI token from its scopes, a fine-grained token from GitHub's `viewerCan*` fields — never by trying a write) | App works; edit controls disabled with "Read-only token" |
| Offline / GitHub down | network error / 5xx | "Can't reach GitHub"; cached data stays, marked stale |
| Rate limited | 403/429 with remaining = 0 | "Rate limited until HH:MM" |
| **[after D14]** GitHub CLI not found / logged out | source = gh; `gh` not on the PATH, or `gh auth token` fails | "GitHub CLI isn't installed" / "GitHub CLI isn't logged in", the command to run (`gh auth login`), "Check again", and "Paste a token instead" |
| **[after D14]** GitHub CLI token missing a scope | source = gh; `x-oauth-scopes` lacks `read:project` (or `project` with writes on) | Names the scope and the exact `gh auth refresh -h github.com -s <scope>` command |
| **[after D14]** GitHub CLI not approved by the org | source = gh; org resources refused while `GET /user` works | "Your org may need to approve the GitHub CLI app" |

An error is NEVER shown as an empty list.

## 3.4 Write gate

A GitHub write happens only when all three hold:
1. The token has the write permissions (§3.3). Detected with read-only queries when the token is checked and stored, so a relaunch and an offline session know it. Turning the switch below on re-checks it first.
2. Settings → "GitHub writes" is on. Off by default, and off again after every token change (replace token, disconnect, switch source).
3. The build allows writes. `DESKA_WRITES=off` at build time produces a binary that refuses writes regardless of 1 and 2. v1.0 is built with it off. **[Changed at the maintainer's request]** Releases from v1.1.0 are built with `DESKA_WRITES=on`; parts 1 and 2 still keep writes off until the user turns them on with a token that can write.

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

**[D11]** The new filters are `author` (in / not in, logins, `me` = the PAT owner), `inProject` (`yes` / `no`: the issue has an item in the pinned project, even with no values), `closedReason` (`completed` / `not_planned`, in / not in; "duplicate" counts as not planned, an open issue has no reason) and `subProgress` (`none` / `not_started` / `in_progress` / `done`, from GitHub's counts; a parent whose counts aren't read yet is in no bucket). The last three take only their fixed values, in saved views, URL state and imported views. Rows carry `authorLogin`, `stateReason` and `inProject` (wire key `ip`). The default chip reads "Default: <value> ✕" (`Default off: <value> +` once switched off) on every list it narrows, including the triage queues; the walk-through shows it fixed, since the walk is fixed when it starts. Any list with a filter shows "Clear all (N)". Each list state has its own marker (`data-list-state`: `loading` while the first import runs, `empty`, `error`); the empty state names the active filters, "Default: …" included, and offers "Clear filters".

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

**[D10]** The sprint page is still `/releases/[id]` (the UI keeps saying "Release" for now). Closed as "not planned" and as "duplicate" both count as Not planned. Header numbers are computed from the rows after filters (`lib/client/sprint.ts`); a filter adds "<values> · 12 / 30 (filtered)". `[` / `]` and the two arrow buttons step through sprints by date. The list layout groups by the new `sprintState` grouping (Remaining, Done, Not planned collapsed); the board stays by Status. An unreadable project (connection problem and nothing cached for the sprint) shows the §3.3 message, never "Nothing planned". Bulk edit, the Backlog drawer, board drag and "Move all to next" stay visible while writes are off, disabled with the token's reason.

## 4.6 Personal tasks (Todoist-like)

Keep for one person: Inbox, Today, Upcoming, projects (with an optional GitHub source filter), labels, natural-language quick add, priorities, due dates and times, recurrence, reminders, sub-tasks, manual ordering, drag and drop, comments (as notes), issue links and "Add to tasks" from issues, undo toasts.

Remove (D7): assignees, the Delegated view, `@person` in quick add, "not on Deska yet" hints, per-user visibility (all local tasks belong to this install, whichever GitHub account is connected), and notifications other than reminders and the watchlist digest.

Add — desktop-native (D12):
- **Global quick add:** system-wide shortcut (default `⌃⌥Space`, configurable) opens a small floating quick-add window from any app. Enter saves and closes; Esc closes.
- **Native notifications** for reminders with Complete, Snooze 1 h and Tomorrow. Clicking opens the task.
- **Dock badge:** overdue + today count (toggle).
- Closing the window keeps Deska running so sync and reminders continue; ⌘Q quits. Opt-in launch at login.

**[D12]** The desktop settings (shortcut, notifications, launch at login, Dock badge) are kept by the main process in `desktop-prefs.json` in the profile (no secret in it), not in the database, because main is what registers the shortcut, shows banners and sets the badge. Defaults: `⌃⌥Space` (`Control+Alt+Space`), notifications on, badge on, launch at login off (and only offered in the installed app). A shortcut needs Control, Command or Alt plus one key; one another app holds is refused and the previous one stays. The quick-add window is `/quick-add` in a small always-on-top frameless window: same parser as in-app quick add (dates, times, recurrence, priority, `+label`, `=Project`; `#issue` links stay text), Enter saves and closes, Esc closes. Reminders fire from a 30 s timer in the server process (`lib/desktop/reminders.ts`), whether or not a page polls; each new reminder notification is handed to main once and shown natively with Complete, Snooze 1 h and Tomorrow (clicking opens the task). Snooze adds a one-shot snooze reminder (1 h from now, or 09:00 tomorrow in the task's zone) through `POST /api/tasks/[id]/snooze`; unlike the task's own absolute reminders it does not move with a recurring task, and completing the occurrence drops it; all three actions also mark the notification read. If macOS blocks notifications, or they are off, the bell still has every reminder. The Dock badge is `dueCount` (`lib/tasks/counts.ts`, also the sidebar's Today count: open, not in an archived project, due today or earlier, sub-tasks included), refreshed within a second of a task edit and on every tick. Closing the window keeps the app running; the Dock icon opens a window again; a launch by "launch at login" opens none.

Add — Todoist parity (D13):
- **Sections** in a project (create, rename, reorder, collapse, drag tasks between them).
- **Completed** view: last 30 days grouped by day, with un-complete.
- ⌘K task search covers descriptions and comments.

**[D13]** A section belongs to a project (`task_sections`: name, order, collapsed; a task points at one with `tasks.section_id`, only top-level tasks, and only a section of its own project). Moving a task to another project drops its section unless the same change names one there. Deleting a section keeps its tasks (they lose the section); archived projects take no new sections. A project page with sections lists the tasks in no section first, then each section in order; the header collapses it (the choice is stored), its ⋯ menu renames, moves up/down and deletes, its `+` adds a task into it, and the task panel has a Section picker. Dragging a task onto a task in another section, or onto a section header (end of that section), files it there, with Undo. **Completed** is `/tasks/completed` (`GET /api/tasks/completed`): the last 30 days by day in the viewer's time zone, tasks completed in that time plus each completed occurrence of a recurring task (which stays open); a checkbox reopens a task where it was filed (project, section, order), and only the newest occurrence of a recurring task can be taken back (`undoOccurrence`). ⌘K asks `GET /api/tasks/search?q=` once typing pauses: every word must appear in the title, the description or a live comment (case-insensitive, `%` and `_` literal); title hits show at once from the browser, the others are labelled "in description" / "in a comment".

- **Saved task views** (item 12): a named combination of the task filters — project (any, Inbox, or one), label, priority and due window — listed in the Tasks section of the sidebar after Inbox, Today, Upcoming and Completed. "Save view" on Tasks saves one and opens `/tasks/views/[id]`, which renders the Tasks list with those filters; the view's page deletes it. Stored in `views` with `kind = tasks`, so backups and exports carry it; a backup from before `kind` reads its views as issue views.

**[D7]** Everything local (tasks, projects, labels, sections, saved views, snoozes, watches, notifications, settings) is keyed by one constant owner, `LOCAL_OWNER` (`lib/local-owner.ts`), never by a GitHub login: connecting a different account changes what `me` means in issue filters and nothing else. Task `creator`, `completedBy` and comment `author` stay in the model and always hold it. Notifications are only `reminder` and `watch_digest`. Migration 0004 collapses data written by the multi-user build (same-name projects and labels are renamed, one placement per task, newest snooze and oldest last-seen kept).

Rules: tasks never write to GitHub; a closed linked issue shows a badge but never auto-completes the task; tasks and issues always look distinct (checkbox vs status icon).

## 4.7 Local data safety

- **Automatic backup** daily and before every migration: JSON of all local-only data (tasks, projects, labels, sections, views, snoozes, watches, settings) in `~/Library/Application Support/Deska/backups/`. Kept: every backup of the last 14 days, then the newest of each week for 8 weeks. Optionally also copied to a **second folder** the user picks in Settings (iCloud Drive, a sync client's folder, an external drive), so one lost disk doesn't lose the backups too.
- **Export / Import** in Settings. Import merges by ID; never touches the GitHub cache.
- **Reset GitHub cache** (re-import, tasks kept) and **Reset everything** (asks twice).
- A DB that fails to open offers "Restore from latest backup".
- **Second folder** (Settings → Local data → Backups): chosen with the native folder dialog only, kept in `desktop-prefs.json` (`backupFolder`, not in the database, so not in a backup), refused when it is inside Deska's own data. Main hands it to the server (`backup-mirror` message). After every backup, and at each hourly check, the server copies the backups the folder lacks (atomic, 0600), then applies the retention there. The folder must already exist, so an unplugged drive is reported ("Is the drive connected?") rather than recreated on the startup disk, and a failure never blocks the local backup. Settings shows the last failed backup, the folder's state, and a warning when the newest backup is older than 3 days. "Stop copying" leaves the copies already there.
- Backups and exports NEVER contain the token.

**[D8]** Backups and exports are one JSON document, `{"kind":"deska-backup","v":1,"createdAt","schemaVersion","tables":{…}}`, with one array of rows per local table (settings, views, task projects/labels/sections/tasks/placements/links/label links/completions/reminders/comments, notifications, user prefs, snoozes, watches). Rows are read generically (`to_jsonb`), so a backup can be taken from the schema before a migration. Backups are `deska-backup-<UTC time>-<daily|migration|reset|manual>.json` (owner-only), written atomically, kept for 14 days and then one a week for 8 weeks (the newest backup is always kept; the second folder follows the same rule and only files with these names are ever deleted there); a daily check runs hourly while the app runs, "before every migration" means pending migrations on a database that already has data, and "Reset everything" takes a `reset` backup first. Import merges by primary key inside one transaction: an existing row (or one that collides with a unique index) is kept, rows whose parent is missing are skipped, strict-schema-invalid views are skipped, and a file from a newer schema or with an unknown table is refused. Every string is redacted, so a token pasted into a task becomes `[redacted]`. "Reset GitHub cache" empties the cache tables and the sync cursors (the PAT owner, the view seeding flag and the ETag generation stay) and starts a first import; settings (project and mapping) stay. "Reset everything" empties every table; the GitHub token stays until "Disconnect GitHub". A database that fails to open is noted by the server; before it opens the window the shell asks "Restore from latest backup" / "Start empty" / "Quit", and recovery moves the damaged folder to `db.damaged-<time>` (nothing is deleted), opens a fresh database and imports the newest readable backup.

## 4.8 Writes (Phase C)

| Write | API | Milestone |
|---|---|---|
| Sprint, Status, Priority, dimensions | `updateProjectV2ItemFieldValue` / `clearProjectV2ItemFieldValue`; `addProjectV2ItemById` first if needed | W1 |
| Assignees, labels | REST add/remove, as deltas | W1 |
| Type, milestone | `updateIssueIssueType`; REST `PATCH` milestone | W1 |
| Close / reopen | REST `PATCH state, state_reason`; close also sets Status to the done option chosen in Settings | W2 |
| Create issue | REST `POST /issues`, add to project, set fields — one outbox job | W3 |

Every write: only after an intentional user action; optimistic UI; a stale-value check before writing ("Changed on GitHub by X → Keep theirs / Overwrite"); a success or failure toast; then the issue is re-read and GitHub's resulting state shown. Bulk edits over 50 issues confirm first. No delete anywhere.

**[W0]** The outbox is one durable queue in the server process (one process, one local user): a write is claimed by moving its row to `sending`, the GitHub call runs outside any transaction, a transient failure schedules a retry (2 s, 8 s, 30 s), a finished row writes an audit row, and edits to one issue and field run in order. A multi-step job records the step it finished (close = close the issue, then set Status), so a crash between the steps resumes at the second instead of closing again or reporting the user's own close as a conflict. The write client has an **operation allowlist** (the table above): a test fails when any other mutation or REST write is added, and nothing in it can delete.

## 4.9 AI assist (Phase E)

**[Added after D14, at the maintainer's request]** Optional help from a language model with triage and tasks. **Off by default.** Nothing leaves the Mac for AI until the user picks a provider and it passes "Test connection".

**Providers** (Settings → AI, one active at a time):

| Provider | How Deska calls it | Credentials |
|---|---|---|
| Claude Code | The `claude` CLI from the login-shell PATH (§2.1), in print mode: prompt on stdin, `-p --output-format json --json-schema <schema> --system-prompt <prompt> --tools "" --strict-mcp-config --setting-sources "" --no-session-persistence --model <model>` and, when set, `--effort <level>`, working folder = an empty temp folder; the result is the output's `structured_output` | The user's own Claude login. Deska stores no Anthropic key |
| OpenAI-compatible | `POST <base URL>/chat/completions` with `response_format: {type: "json_schema", json_schema: {name, strict: true, schema}}`; models listed from `GET <base URL>/models`, or typed | Optional API key (§2.3) |

- **Claude Code.** The Claude desktop app has no API Deska can call, so the CLI is required; Settings says so when it isn't found. "Test connection" checks the installed CLI's flags (`claude --help`) and refuses with a clear message if one Deska needs is missing. Model: `sonnet` (**[Default]**), `opus`, `haiku`, or typed. Effort: Default, `low`, `medium`, `high`, `xhigh` or `max`, passed as `--effort` only when set; Settings hides the picker when the installed CLI has no `--effort`. The child process gets a clean environment: no `GITHUB_TOKEN`, `GH_TOKEN` or `DESKA_*` variables.
- **OpenAI-compatible.** Covers hosted gateways and model servers on the user's own machine or network. `https` for any host; plain `http` only for loopback and private addresses (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `*.local`). Settings lists the endpoint's models from `GET /api/ai/models` when it opens (the saved model stays selected when the list is unavailable), and has no effort setting. **[Default]** If the endpoint rejects `json_schema`, retry once with `{type: "json_object"}` and the schema in the prompt, and remember that for this endpoint.
- **Both.** **[AI0]** Nothing runs until "Test connection" has passed for the current provider, model and base URL (stored in settings; changing any of them clears it). Test connection sends no user data. 120 s timeout (setting). **[Default]** One AI job at a time, since a local model server often serves one request at a time. No streaming in this version.

**Rules for every AI feature**
- **Suggest, never act.** Output is a suggestion with Accept / Edit / Dismiss. Accepting a GitHub change goes through §3.4 and §4.8 like a manual edit, so while writes are off Accept is disabled with the reason (summaries and reasons still help). Accepting a task change is a normal local edit with Undo. AI runs only when the user asks; nothing runs on a schedule.
- **Untrusted input.** Issue and task text is data. The model gets no tools, no files and no network from Deska. Prompts put content in delimited blocks marked as data. Output is only parsed as JSON against a schema and shown as text through the existing markdown sanitizer: never executed, and no link other than `https://github.com/…` is clickable.
- **Closed choices.** When a suggestion names a value, the schema is built per request with enums of real IDs: Status, Priority and dimension options and iterations from the mapping (§4.1), repo labels, cached issue numbers, local task projects, sections and labels. A value that doesn't exist can't come back.
- **Validated.** Every result is checked with a zod schema. On failure, one retry with the error added to the prompt, then "The model returned invalid output" + Retry. Nothing partial becomes a suggestion.
- **Minimal, visible input.** Settings → AI lists, per feature, which fields are sent. Bodies and comments are trimmed (**[Default]** 12 000 characters per issue, newest comments first). Never sent: the token, the API key, backups, settings, tasks the feature doesn't need, and recordings (they go only to the transcription endpoint). Settings states where it goes: the Claude Code provider sends it to Anthropic under the user's Claude account; a local endpoint keeps it on that machine.
- **A cache, not data.** Results are stored in `ai_results` (feature, subject, input hash, provider, model, result JSON, duration, cost when the provider reports it, created, accepted/dismissed). The input hash covers the prompt version, the schema and the subject's `updated_at`; a changed hash shows "Outdated · Run again". Not in backups or exports (§4.7). **[AI0]** `subject_kind` (`issue`, `list`, `task`, `day`) tells "Reset GitHub cache" which rows to clear. "Reset GitHub cache" clears the issue-based rows, "Reset everything" all of them.
- **Jobs.** Background jobs in the server process that the UI polls, with Cancel. A batch shows its count and confirms above 20 items.
- **Prompts** live in `lib/ai/prompts/`, versioned by content hash. Settings → AI has an optional "Extra instructions" text added to every prompt (team conventions, what labels mean).

**Features**

| Feature | Where | Input | Suggestion | Milestone |
|---|---|---|---|---|
| Issue triage | Issue panel, triage mode, "Suggest for this queue" | Issue, comments, labels, mapped fields, parent, up to 10 candidates from the existing Possible duplicates search | Summary (≤ 3 sentences); Status, Priority, first dimension, Sprint and labels, each with a one-line reason and a confidence; duplicate of (a candidate only); flags: needs info, probably fixed, stale | AI1 |
| Task assist | Quick add (in-app and global) and Inbox | The typed text, or the Inbox tasks; local projects, sections and labels; cached issues whose titles share words with the text | Title, due date/time, recurrence, priority, project, section, labels and linked issue, as chips to check before saving. "Tidy Inbox" proposes the same per task | AI2 |
| Plan my day | Today | Overdue tasks, tasks due within 7 days, Inbox; open issues assigned to `me` in the current sprint; snoozes | An ordered list for today with reasons, new dates for overdue tasks, issues worth turning into tasks | AI3 |
| Ask | Issue panel; any issue list ("Ask about this list") | The issue as in triage, or the list's rows (≤ 200: number, title, state, mapped fields, labels) | A text answer with issue references, kept per subject | AI4 |
| Ramble | Tasks → "Ramble" | The recording, transcribed first; then the transcript and the task projects, sections and labels | One editable row per task — title, due date/time, priority, project, section, labels — then one batch create (≤ 12 tasks) | AI5 |

**Ramble (voice tasks).** Settings → AI has a transcription subsection, visible whether or not an AI provider is chosen. It offers two sources. **OpenAI-compatible:** base URL (defaults to the chat endpoint's), model (default `whisper-1`) and optional key; `POST <base>/audio/transcriptions` as an upload (≤ 25 MB). Claude Code has no audio input, so its users set this separately. **Local dictation app:** the app's local server URL (default `http://127.0.0.1:8787`), no key and no model name from Deska; `POST <base>/v1/transcribe` with the raw recording (≤ 25 MB), so the model already selected in that app transcribes it on this Mac, and "Check server" reads `GET <base>/v1/health`. Deska does not copy or load the model. Both never follow a redirect. Recordings are AAC/MP4 when the recorder supports it (WebM otherwise). The transcript is then parsed by the provider above with the same closed-choice and validated-output rules. The review dialog shows the transcript and one editable row per task before anything is created; Create writes all rows in one atomic batch with an idempotency key, so a retry never duplicates tasks. Electron asks for the microphone permission only when Ramble records and macOS declares `NSMicrophoneUsageDescription`; in a browser the normal permission prompt applies. Denial, AI off, no endpoint, a failed transcription and a failed create all keep the transcript and the rows.

The quick-add parser stays the default: AI task assist is an explicit action (✨ button, **[Default]** `⌘↵` unless taken), and Enter alone saves exactly as before.

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

## Phase D — After v1.0

**[Added after D14, at the maintainer's request]**

### D15 — GitHub CLI login
- §3.1, §2.3 and the §3.3 rows for the GitHub CLI. Onboarding step 1 offers, in this order: "Use my GitHub CLI login (signed in as <login>)" when `gh` is found and logged in, "Paste a token", "Skip, use tasks only". Settings → GitHub shows the source, the login, the scopes, and "Use GitHub CLI login" / "Paste a token instead".
- Main resolves the login-shell PATH once per launch (`$SHELL -l -c` printing `PATH`, 5 s timeout; fallback: `/opt/homebrew/bin:/usr/local/bin` plus the default PATH) and passes it to the server for §4.9.
- `docs/security.md`: the GitHub CLI source, its scopes, and why the write gate matters more with it.
- Tests use a fake `gh` script on a test PATH, never the real one.
- **[D15]** Main keeps `gh` to two read-only commands: `gh auth token --hostname github.com`, and `gh auth status --hostname github.com` for the "signed in as <login>" of the onboarding button (the account name only; without it the button shows no name). Switching to the GitHub CLI source deletes the stored token first; asking for it when `gh` gives no token changes nothing. A missing scope is its own state (`missing-scope`), checked right after `GET /user`, before any project read. When the GitHub CLI source loses its token (logged out, uninstalled), the user it last was keeps the app and the cached data open under the banner. "Check again" always re-reads the CLI's token first. A 401 asks main for one re-read (`gh-reread`); the answer is marked, so a 401 on it is final until the next launch, wake or "Check again". The local server is started without any `GH_TOKEN` / `GITHUB_TOKEN` from the environment. The "GitHub writes" setting itself comes with W0: until then "switching source turns writes off" means the switch goes through the same user token change (a new token generation, `changedByUser`) that W0's gate resets on, and the build stays `DESKA_WRITES=off`. Tests set the PATH `gh` is looked up on with `DESKA_TEST_PATH`, honoured only together with `DESKA_USER_DATA_DIR` (a throwaway profile).
- **Acceptance (mocks):** a logged-in fake `gh` connects without pasting anything; no token file is written for the gh source (test); `gh` missing, logged out, missing `read:project` and org not approving each show their own message; a 401 re-reads the token once, then shows the invalid state; switching source turns writes off; the token never appears in logs, the renderer, exports, backups, or any child process's arguments or environment.

## Phase E — AI assist

**[Added after D14, at the maintainer's request]** §4.9. Every milestone tests against AI0's fake `claude` script and mock endpoint. Checks against a real Claude login or a real endpoint go in "Maintainer to-do".

### AI0 — Providers and settings
- §4.9 providers, rules and jobs: Settings → AI (provider, model, base URL, API key, timeout, extra instructions, what is sent, Test connection), job runner with Cancel, schema validation and retry, `ai_results` (migration), the API key through the preload bridge (§2.3) and its redaction.
- Test doubles: a fake `claude` script on a test PATH (`tests/ai/helpers.ts`; it is found through the login-shell PATH the server gets as `DESKA_LOGIN_PATH`, which main takes from `DESKA_TEST_PATH` only with a throwaway profile, D15) and a mock OpenAI-compatible server on `127.0.0.1` (plain `http` to loopback is allowed anyway, so it needs no switch). **[AI0]** No `DESKA_AI_TEST_*` variables exist.
- `docs/security.md`: an AI section (what is sent where, what is stored, no tools for the model).
- **Acceptance (mocks):** with AI off nothing is spawned or sent (request-log test); Test connection tells apart CLI missing, a required flag missing, not logged in, OK, and endpoint unreachable, 401, unknown model, OK; invalid output is retried once, then shown as an error; an endpoint without `json_schema` falls back to `json_object`; the API key never appears in logs, the renderer, exports or backups; the `claude` child gets no GitHub token in its arguments or environment; plain `http` to a public address is refused.

### AI1 — Issue triage suggestions
- §4.9 Issue triage, in the issue panel, in triage mode (one free key, recorded in `PROGRESS.md`) and as "Suggest for this queue". Accept writes through W1 when writes are on.
- **Acceptance (mocks):** suggestions only offer options in the mapping and labels in the repo (schema test); "duplicate of" is always one of the candidates; an issue changed on GitHub shows its suggestion as outdated; with writes off, suggestions show and Accept is disabled with the reason; a queue batch confirms above 20 and can be cancelled; an issue whose body tells the model to close it gets an ordinary suggestion and nothing else happens (fixture).

### AI2 — Task assist
- §4.9 Task assist in both quick-add windows and "Tidy Inbox" on the Inbox.
- **Acceptance (mocks):** ✨ on a typed line gives chips that only name existing projects, sections and labels; Enter without ✨ behaves exactly as before (the existing parser tests are unchanged); Tidy Inbox accepts per task or all, with Undo; when the provider fails, quick add says "AI unavailable" and still saves the plain parse.

### AI3 — Plan my day
- §4.9 Plan my day on Today.
- **Acceptance (mocks):** the plan names only existing tasks and issues; accepting a new date changes it with Undo; "Add to tasks" on a suggested issue creates a linked task; nothing changes without Accept.

### AI4 — Ask
- §4.9 Ask, in the issue panel and on issue lists.
- **Acceptance (mocks):** answers are kept per subject with time and model; a list over 200 rows says only the first 200 were sent; issue references open inside Deska.

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
