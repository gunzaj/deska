# Progress

| Milestone | Status | PR | Notes |
|---|---|---|---|
| D0 | done | [#1](https://github.com/gunzaj/deska/pull/1) | Predecessor imported and scrubbed |
| D1 | done | [#2](https://github.com/gunzaj/deska/pull/2) | Token probe + security doc |
| D2 | done | [#3](https://github.com/gunzaj/deska/pull/3) | Electron shell, §2.2 hardening, PGlite, unsigned universal .dmg |
| D3 | done | [#4](https://github.com/gunzaj/deska/pull/4) | Auth server removed; PAT owner is the local user; onboarding step 1, Settings, §3.3 token states |
| D4 | done | [#5](https://github.com/gunzaj/deska/pull/5) | Onboarding step 2, Settings remap, mapping by field ID, dimensions (`dim:<fieldId>`) everywhere |
| D5 | done | [#10](https://github.com/gunzaj/deska/pull/10) | In-process sync, first import with resume, `/importing` |
| D6 | todo | | |
| D7 | todo | | |
| D8 | todo | | |
| D9 | todo | | |
| D10 | todo | | |
| D11 | todo | | |
| D12 | todo | | |
| D13 | todo | | |
| D14 | todo | | |

## Decisions to review
- D0: Fictional dataset values: Status `📋 To do` / `🚧 In progress` / `✅ Done` (+ review, QA, blocked in the demo), Priority `Low` / `Medium` / `High`, Team `Core 🧱`, `Checkout 🛒` and more, iterations `Sprint 20`–`Sprint 27` on the "Release" field, project number 7. Option IDs are made-up 8-hex values (`a0000001`…).
- D0: Fictional node IDs (`PVT_acme_widgets_roadmap`, `PVTSSF_acme_status`, `IT_acme_bug`, …) are listed in `tests/repo/node-ids.test.ts`, which fails on any other `PVT_`/`PVTF_`/`PVTSSF_`/`PVTIF_`/`IT_` token in the repo.
- D0: Code identifiers named after the predecessor's product became generic (`ProjectFieldMap`, `PROJECT_<KEY>_FIELD` env vars instead of the old prefix). The predecessor's licensed font was dropped from the font stack.
- D0: The demo dataset's Release iterations are now relative to today (they had fixed dates and 7 tests had started failing); tests pass their own fixed date into the fixtures.
- D0: `.env.example` was not imported: this agent's permission settings deny writing `.env.*` files. Most of its variables (OAuth, cron, allowlist) go away in D3; `scripts/dev.mjs`, `vitest.config.ts` and `playwright.config.ts` show the ones still used.
- D0: `pnpm dev` runs `scripts/dev.mjs`: with no `DATABASE_URL`, no `.env*` file and no e2e env, it starts the demo preview signed in as `alice` via the existing dev-only bypass (otherwise plain `next dev`). Needed for "pnpm dev runs on demo data" while OAuth still exists; D2/D3 replace it.
- D0: Fixed `hashColor` (avatar backgrounds): white initials were below 4.5:1 on some hues, which the axe e2e test caught for `bob`. Lightness 48% → 32%, with a unit test over all hues.
- D0: The baseline migration starts with `CREATE EXTENSION IF NOT EXISTS pg_trgm` (drizzle-kit does not emit extensions). The test of the old cleanup migrations now checks the baseline's constraints instead.
- D0: One CI workflow (`ci.yml`): the leak guard runs on every push; the full checks run on pull requests and `main`.
- D0: Inherited hardcoded option name: the seed view "Core current Release board" looks up the Team option by name (`lib/views/seeds.ts`). Left as is (no feature work in D0); D4's dimension work should remove it.
- D1: The probe uses its own small `fetch` client (not Octokit), so the read-only guarantee is checked in one place: REST `GET` only, relative API paths only, and GraphQL documents must start with a query and contain no `mutation`/`subscription` outside comments and strings. It records counts and statuses, not issue contents.
- D1: The probe reads the token from `GITHUB_TOKEN` (like `sync:full --live`) and the target from the existing `GITHUB_REPO` / `GITHUB_ORG` / `GITHUB_PROJECT_NUMBER`; `PROBE_ISSUE_NUMBER` optionally picks the issue for per-issue checks.
- D1: `docs/security.md` describes the target design (§2–§3) and says up front that the desktop shell lands in D2–D5. A test keeps it free of org, repo, person and node-ID names (fictional ones included).
- D0: Some e2e specs are timing-sensitive under `next dev` on a loaded machine (5 s assertions while a page compiles). They pass on rerun; CI retries once.
- D2: PGlite runs in the server process (Electron's utilityProcess) with the bundled `pg_trgm`, so the better-sqlite3 fallback and the in-memory similarity fallback weren't needed. `DATABASE_URL` became `DESKA_DB_DIR` (a directory, or `memory://` for tests). One PGlite instance per process lives on `globalThis`, because Next loads server modules more than once. Migrations run on server start (`instrumentation-node.ts`), and `db:migrate` is gone.
- D2: Until D3, the desktop app seeds the fictional demo dataset into an empty database (`DESKA_DEMO_SEED`) and treats the local user as `alice`. The "Sample data" banner shows whenever the database was seeded this way.
- D2: The per-launch secret and Host check sit in `middleware.ts` (`lib/desktop/guard.ts`) with an all-paths matcher, so static files are guarded too. The guard is active only with `DESKA_DESKTOP=1`, which the server entry sets after the IPC "start" message, and it fails closed without a secret. With the guard active, sign-in is skipped.
- D2: Beyond §2.2, the window's session cancels every request except the app origin and GitHub images, the desktop CSP allows `img-src` only from GitHub hosts, there is a single-instance lock per profile, and permissions are limited to notifications and clipboard write.
- D2: `pnpm desktop:dev` forks the server entry with the system `node` over Node IPC, not utilityProcess, because `next dev` forks workers and needs a real Node. The packaged app uses utilityProcess.
- D2: Packaging: Next standalone output, with pnpm's symlinked `node_modules` flattened into plain folders, is copied into `Contents/Resources/server` by an `afterPack` hook, because `extraResources` drops `node_modules`. sharp is left out (image optimization is off). electron-builder runs on a copy of the app folder outside the repo, because it would otherwise pack the workspace's dependencies.
- D2: The `pnpm-workspace.yaml` overrides pin `@electron/asar` to 4.3.1 and drop `electron-builder-squirrel-windows`. Otherwise glob 7's deprecation notice puts a personal email into `pnpm-lock.yaml`, and the leak guard (rightly) rejects it.
- D2: The window's origin is a new random port on every launch, so `localStorage` (theme choice) doesn't survive a relaunch. Anything that must persist belongs in the database. A later milestone may move the theme there.
- D2: The token bridge (`deska.token.set/clear/status`) already encrypts with `safeStorage`, stores the ciphertext in the profile and hands the plaintext to the server over IPC. The server keeps it in memory only, and nothing reads it until D3.
- D2: Fixed a hydration warning from the start of the D0 code (the theme script's CSP nonce). It raised the Next dev overlay over the user menu and broke `user-menu.spec.ts`.
- D2: The e2e "database" project (`e2e-db`) always runs now, on an in-memory PGlite dev server. The desktop smoke test (`pnpm test:desktop`) runs in a new `desktop` CI job on `macos-latest`.
- D3: The token check reuses the D1 probe's read-only client (REST GET and GraphQL queries only): `GET /user`, then one read per §3.2 permission. "Awaiting org approval" = `/user` works while the repo is out of reach and the project isn't readable, or GitHub answers with an org-policy message. "Missing a permission" = a 403 "Resource not accessible…" (or GraphQL FORBIDDEN / a null project) on that permission's read.
- D3: Write permissions can't be read off a fine-grained token without trying a write, so every token counts as read-only ("Read-only token" on edit controls) until W0 adds detection. SPEC §3.3 notes this.
- D3: Until D4 stores the repo and project, the capability check uses `GITHUB_REPO` / `GITHUB_ORG` / `GITHUB_PROJECT_NUMBER` from the environment. In the real app (no env) it checks `GET /user` only and lists the permissions as "not checked yet".
- D3: The desktop app still seeds the fictional demo dataset into an empty database until in-process sync (D5), under the "Sample data" banner. `me` is now the PAT owner, not `alice`.
- D3: The PAT owner's login, name and avatar URL are saved in `sync_state` (`github.*` keys), so `me` is known offline after a relaunch. A token replaced during a run is trusted only after its own `GET /user`.
- D3: Main waits for the server to acknowledge each token message (`token-ack`), so the page's next `/api/connection?refresh=1` sees the new token. Main accepts only `github_pat_…` tokens (§3.1).
- D3: The server installs console redaction at start (`lib/redact.ts`), covering every log line. `redactError` uses the same rules.
- D3: `pnpm desktop:dev` runs `next dev` in-process via Next's custom-server API. The `next dev` CLI forks a child process the token never reaches. Not exercised by CI.
- D3: `DESKA_GITHUB_API_URL` (only `http://127.0.0.1:<port>`) points every GitHub call, Octokit included, at a mock. The Electron smoke test uses it with `--use-mock-keychain`, so tests never touch the real keychain.
- D3: The test-only identity (`E2E_AUTH_BYPASS` + `x-e2e-login`) stays for e2e and the `pnpm dev` preview, without an allowlist. Multi-user task tests keep working until D7. The tasks "blocked" access state is gone with the allowlist.
- D3: `scripts/probe-pat.ts` and `sync:full --live` still read `GITHUB_TOKEN`: they are maintainer CLI tools, not the app. `docs/security.md` says so. The `users` table stays (without `token_enc`) until D7.
- D3: `drainLeftovers` (cron/worker outbox drain) was removed with its callers. W0 builds the in-process outbox.
- D4: Settings live in a new `app_settings` table (`github.target`, `project.mapping`), separate from `sync_state`, so a future "Reset GitHub cache" can't lose them. The token check, links, "Sync now", the outbox's re-read and the write client use the stored target; `GITHUB_REPO` / `GITHUB_ORG` / `GITHUB_PROJECT_NUMBER` remain a fallback for tests, dev and the CLI tools. The write client's pinned node ID is the stored one (env `GITHUB_PROJECT_ID` only as fallback).
- D4: Sync stores every single-select **and iteration** value of a project item by field ID in `project_item_dims` (besides the Status/Priority/Sprint columns). A remap re-reads those columns from it in SQL: no new scan, no F0 change recorded. Changes to these values are recorded as `dim:<fieldId>` (Status/Priority changes thus appear twice in history; the watchlist shows only mapped dimensions).
- D4: Without a stored mapping (tests, the dev preview, the mocked e2e server) the app runs on the suggestion: Status/Priority/Sprint by name words and type (Sprint falls back to the only iteration field), every other single-select as a dimension, Priority order guessed from option names (highest-first when unclear). `PROJECT_<ROLE>_FIELD` env vars still override for tests.
- D4: The desktop app redirects to `/onboarding?step=2` until a target and a mapping are stored. Choosing a project re-reads it from GitHub (read-only client), pins its node ID and imports its full field list into the cache. "Reload fields" refuses if the project number now resolves to another node ID.
- D4: A field missing from a complete field list gets `project_fields.missing_at` (never deleted) and comes back when listed again. The UI shows "Missing field — remap" in Settings, an app banner, the issue panel and the Sprint pages; a missing dimension drops out of filters/grouping/board options.
- D4: The "first mapped dimension" plays the predecessor's Team role: "Needs triage" = no Priority or no value in it, triage key `T`, planning load, the sidebar section (route kept as `/teams/[id]`, now any dimension option), palette. `user_prefs.default_team` now holds the "My default" option of any mapped dimension (column name kept to avoid a migration; D11 adds the visible chip work).
- D4: Without a Sprint field (or with it deleted) Backlog, Releases, planning, release filters/grouping/sort/columns, the two sprint triage queues, the release seed view and palette entries are hidden; `/backlog` and `/releases*` show "No Sprint field mapped". The role is called Sprint in the mapping; the UI elsewhere still says "Release" (D10 reworks the sprint view).
- D4: The seed view "Core current Release board" (the hardcoded Team name lookup) is gone; "Current Release by <first dimension>" replaces "Current Release by Team". Migration 0002 rewrites saved views' `team`/`platform` keys to `dim:<fieldId>` using the old automatic map, then drops `sync_state.fields.map`.
- D4: "Status options that also count as done" are stored in the mapping and sent as `meta.mapping.doneStatusIds`; nothing counts them yet (D10's sprint header will).
- D4: Fixture project "Ops Board" (`lib/demo/fixtures-alt.ts`, IDs added to the node-ID allowlist) with differently named fields; `DESKA_DEMO_SEED` / `DEMO_DATASET` accept `alt` and `alt-no-sprint`, and Electron main passes those through. The Electron smoke test now goes through step 2 against a mock that lists projects and serves their fields.
- D4: Locally, electron-builder must run with TMPDIR in a folder with no `pnpm-workspace.yaml` above it (a fresh dir under the system temp folder is not enough because the temp folder itself has stray pnpm files); the session scratchpad worked.

- D5: The sync runs in this process (`lib/sync/service.ts` on `globalThis`, started by `instrumentation-node.ts`): a run on launch, on an interval, on wake (main forwards `powerMonitor` over IPC), when a token arrives, after step 2 picks a project, and on "Sync now". No cron, no worker, no external scheduler.
- D5: The first import is checkpointed per page (`import.*` keys in `sync_state`): metadata, open issues, recently closed issues, project items. Quitting between pages resumes from the checkpoint on the next launch instead of starting over; the sync cursors are set last, so `/importing` stays up until the cache is whole and the issue list never shows half a repo.
- D5: `/importing`'s four gates live in `lib/import-destination.ts` as one pure function over thunks, in their load-bearing order (signed in → desktop guard → project set up → import pending). The screen's three states, four step rows and count line come from `lib/import-view.ts`, with every string in `IMPORT_COPY`: the screen renders that and adds no judgement, so the Electron-only screen still has a Vitest gate.
- D5: `failure` on `/api/sync-status` is the last *completed* run's failure, cleared only when a run succeeds, so a retry still reports what it is retrying. It is never read without `running`: `importView()` turns `failure && !running` into the failed state and a running retry into `resumed`, which is what keeps a live Retry button off an import that is already going.
- D5: A resumed import draws its current step still (`active-idle`) and everything before it `done`; only a fresh start pulses. A relaunch reads as a continuation, not a restart.
- D5: The Electron smoke grew the mock's sync routes (`DeskaSyncFields`, `DeskaSyncIssueTypes`, `DeskaIssueExtras`, paged `DeskaSyncItems`, and paged REST issues/labels/milestones/assignees behind a real `link` header) and one empty-seed test that walks onboarding → `/importing` → `/issues` on a 120-issue repo, so the import is proven to page rather than to stop at page one. It launches with `seed: ""` and `envTarget: false`: a seeded cache sets `issues.since` and redirects past the screen, and an env target imports while the UI gates on stored settings.

## Maintainer to-do
- [ ] Create a **read-only** fine-grained PAT: resource owner = the org, repository access = only the one repo; Repository → Metadata: Read, Repository → Issues: Read, Organization → Projects: Read, Organization → Issue types: Read (optional); nothing else. Then run the probe (report lands in `private/findings/`):
  ```bash
  read -rs GITHUB_TOKEN && export GITHUB_TOKEN
  GITHUB_REPO=<owner>/<repo> GITHUB_ORG=<org> GITHUB_PROJECT_NUMBER=<n> pnpm probe:pat
  ```
- [ ] Try the D2 build on your Mac: `pnpm desktop:build`, then open `release/Deska-0.0.0-universal.dmg`. The app is unsigned, so the first time, right-click Deska.app → Open (or allow it under System Settings → Privacy & Security). Since D3 it opens on "Connect GitHub": paste a read-only fine-grained PAT (see the first item). The issue list still shows the fictional sample data until D5. Since D4, after the token it asks for the repository and project (step 2) and lets you map the fields; try it against your real project with the read-only PAT (reads only), and check Settings → Project and fields.
- [ ] Optional: add a `.env.example` if you want one (the agent could not write `.env.*` files). Use only fictional values.

## Blockers
- (none)
