# Progress

| Milestone | Status | PR | Notes |
|---|---|---|---|
| D0 | in progress | | Predecessor imported and scrubbed |
| D1 | todo | | |
| D2 | todo | | |
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
- D0: Some e2e specs are timing-sensitive under `next dev` on a loaded machine (5 s assertions while a page compiles). They pass on rerun; CI retries once.

## Maintainer to-do
- [ ] Optional: add a `.env.example` if you want one (the agent could not write `.env.*` files). Use only fictional values.

## Blockers
- (none)
