# Progress

| Milestone | Status | PR | Notes |
|---|---|---|---|
| D0 | done | [#1](https://github.com/gunzaj/deska/pull/1) | Predecessor imported and scrubbed |
| D1 | done | [#2](https://github.com/gunzaj/deska/pull/2) | Token probe + security doc |
| D2 | done | [#3](https://github.com/gunzaj/deska/pull/3) | Electron shell, §2.2 hardening, PGlite, unsigned universal .dmg |
| D3 | todo | | |
| D4 | todo | | |
| D5 | todo | | |
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

## Maintainer to-do
- [ ] Create a **read-only** fine-grained PAT: resource owner = the org, repository access = only the one repo; Repository → Metadata: Read, Repository → Issues: Read, Organization → Projects: Read, Organization → Issue types: Read (optional); nothing else. Then run the probe (report lands in `private/findings/`):
  ```bash
  read -rs GITHUB_TOKEN && export GITHUB_TOKEN
  GITHUB_REPO=<owner>/<repo> GITHUB_ORG=<org> GITHUB_PROJECT_NUMBER=<n> pnpm probe:pat
  ```
- [ ] Try the D2 build on your Mac: `pnpm desktop:build`, then open `release/Deska-0.0.0-universal.dmg`. The app is unsigned, so the first time, right-click Deska.app → Open (or allow it under System Settings → Privacy & Security). It shows the fictional demo data until D3.
- [ ] Optional: add a `.env.example` if you want one (the agent could not write `.env.*` files). Use only fictional values.

## Blockers
- (none)
