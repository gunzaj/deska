# Product improvements: progress

Source: `deska-improvements-spec.md` (maintainer's product feedback). Work through
the items in order, one commit each. `docs/SPEC.md` §0.2 still applies: fictional
data only, no real names, no writes to a real GitHub repository.

## Status

| # | Item | Status | Commit | Notes |
|---|---|---|---|---|
| 1 | Issue title hover and side view interactions | in progress | | Title hover ungated; only a title swaps the panel; open issue highlighted |
| 2 | Issue detail and side view | todo | | |
| 3 | Epics view: team filter, search, filters | todo | | |
| 4 | Release view: consistent team filtering | todo | | |
| 5 | AI Assist: model and effort selection | todo | | |
| 6 | Investigate slow AI actions | todo | | |
| 7 | Command+K switcher: Escape | todo | | |
| 8 | Sidebar identity | todo | | |
| 9 | Triage button labels | todo | | |
| 10 | View watchlist: investigate notifications | todo | | |
| 11 | New issue: searchable label picker | todo | | |
| 12 | Tasks: saved custom views | todo | | |
| 13 | Tasks: voice-based creation with Ramble | todo | | |
| 14 | Move time zone setting to app settings | todo | | |

## Decisions (from the maintainer)

- **Ramble audio:** a transcription endpoint setting (base URL, model, optional
  key) in Settings → AI; it defaults to the OpenAI-compatible chat endpoint.
  Claude Code users set one separately, since that CLI has no audio input.
- **Ramble flow:** review the transcript and one editable row per parsed task
  before creating anything.
- **Sidebar identity:** the synced project title, with the repository beneath and
  the full name in a tooltip; fall back to "Deska" and the repository when no
  project is set (or in tasks-only mode).
- **Saved task views:** in the Tasks section of the sidebar, next to Inbox,
  Today, Upcoming and Completed; new custom views are added to that section.
- **AI measurement:** one small real Claude Code call is allowed for item 6.
- **Git:** the pre-existing quick-add work is its own commit; this work is on
  branch `improvements`, one commit per item, no push or PR until reviewed.

## Verification

Per item: unit tests and an e2e spec where the UI can be driven; `pnpm typecheck`
and `pnpm lint`. At each batch boundary: `pnpm test`, `pnpm test:e2e`,
`pnpm desktop:build`, `node scripts/leak-guard.mjs --all`. Manual checks that
automation cannot cover (microphone, real video, resize feel, real AI latency) are
listed for the maintainer at the end.

## Session plan

- **Session 1:** items 1–4, 7–9, 14.
- **Session 2:** items 5–6 and 10–12.
- **Session 3:** item 13 and the final full verification.
