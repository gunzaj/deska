# Product improvements: progress

Source: `deska-improvements-spec.md` (maintainer's product feedback). Work through
the items in order, one commit each. `docs/SPEC.md` §0.2 still applies: fictional
data only, no real names, no writes to a real GitHub repository.

## Status

| # | Item | Status | Commit | Notes |
|---|---|---|---|---|
| 1 | Issue title hover and side view interactions | done | f8dbb45 | Title hover always on; only a title swaps the panel; the open issue is marked in list, table, board and epics; the mark follows and clears |
| 2 | Issue detail and side view | done | 4de84d4 | Description surface; image lightbox; playable videos (CSP + Electron media); resizable panel; GitHub links open |
| 3 | Epics view: team filter, search, filters | done | 8da044c | Shared Explorer with a locked `has_sub_issues` base; default team, search, all applicable filters, saved views; Size sort |
| 4 | Release view: consistent team filtering | done | afe8e0b | Header, Risk, notes and the `(filtered)` denominator follow the team; the lower list already did |
| 5 | AI Assist: model and effort selection | todo | | |
| 6 | Investigate slow AI actions | todo | | |
| 7 | Command+K switcher: Escape | done | 0cb5b3d | Escape closes the palette; navigation and selection still work |
| 8 | Sidebar identity | done | 257653f | Project title primary, repository beneath, tooltip, truncation; fallback "Deska" + repo |
| 9 | Triage button labels | done | 2887bd8 | Visible Back and Next; the same `go(-1)` / `go(1)` handlers; footer hints updated |
| 10 | View watchlist: investigate notifications | todo | | |
| 11 | New issue: searchable label picker | todo | | |
| 12 | Tasks: saved custom views | todo | | |
| 13 | Tasks: voice-based creation with Ramble | todo | | |
| 14 | Move time zone setting to app settings | done | f6ac48b | Settings → General; same `user_prefs.tz` value and effect; removed only from the bell |

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

## Verification log

- **Items 1–4, 7–9, 14:** `pnpm typecheck`, `pnpm lint`, `pnpm test` (159 files, 1180 tests).
  Targeted Playwright specs: `issue-interactions`, `issue-detail-media`, `epics`,
  `release-team`, `palette`, `triage`, `sidebar-identity`, `settings-timezone` — all pass
  when run one at a time (concurrent Playwright runs share ports 3100/3101 and must not
  overlap).
- **Item 2 limitation:** the existing security policy still opens only
  `https://github.com/…` links from a description; other external links stay blocked
  (SPEC §2.2). Videos are allowed from GitHub's hosts only.
- **Item 3 limitations:** the shared row count says "issues" rather than "epics"; row
  titles keep the full `Epic:` prefix; the new Size sort appears in every list's ordering.
- **Item 4 limitation:** the `/releases` index cards are outside the "release overview"
  reading and were not changed; a team filter nested inside an `any` filter is not treated
  as a standalone team filter.
- **Item 8 limitation:** the current source said "Deska", not "Desktop"; the project title
  comes from the stored target and is empty in demo and tasks-only mode, where the fallback
  is used.
- **Item 14:** the value stays in `user_prefs.tz` (per-install, single user) rather than
  moving to `app_settings`; moving it would not change behavior and would need a migration.

## Next session

Start a new session in this folder and paste:

> Read `docs/IMPROVEMENTS.md` and continue with Phase 2 (items 5, 6, 10, 11, 12), then Phase 3 (item 13). Work on the `improvements` branch; do not push or open a PR until the maintainer asks.

Phase 2 plan, in order:

1. **Item 5 — AI model and effort.** Add `effort` to `AiSettings`
   (`lib/ai/types.ts`), `claudeArgs`/`callClaude` (`lib/ai/claude.ts`) and the
   settings API. Claude Code: a real model `<select>` (aliases plus a saved
   custom model and "Custom…"), and an effort `<select>` (Default, low, medium,
   high, xhigh, max) only when `claude --help` lists `--effort`; pass `--effort`
   only when set. OpenAI-compatible: load models from a new
   `GET /api/ai/models` on Settings open (not only after Test connection), show
   the saved model as a selected option when the list is unavailable, and say
   effort is not available for this provider. Keep `verifyId` independent of effort.
2. **Item 6 — slow AI actions.** Add queue/provider timings to the job
   (`createdAt` → run start, `durationMs`, Claude's `duration_ms` /
   `duration_api_ms`), log them, and show elapsed time in the UI. Measure offline
   with the delayed fake `claude` and mock endpoint, then one real Claude call
   (the maintainer approved one). Only then implement a measured fix, likely
   bounded-parallel input construction for triage batches and removing needless
   live GitHub reads; report before/after numbers and limitations.
3. **Item 10 — view watch investigation.** Report only: a view watch is a daily
   digest of tracked changes to any issue currently matching the view (one bell
   entry/day, generated lazily when `/api/notifications` polls), not a per-change
   notification; an issue watch is the same digest for one issue. Native desktop
   notifications are reminders only. Add the missing view-digest test.
4. **Item 11 — searchable label picker.** In `components/issue/create-issue.tsx`,
   replace the label `CheckGroup` with `Popover` + `PickList multi` (already has
   search, checkmarks, empty text) and a chip row for the selected labels.
5. **Item 12 — saved task views.** Add `kind` to `views` (migration 0009,
   default `issues`) plus a strict task-view schema; `GET /api/views?kind=tasks`;
   task views in the Tasks section of the sidebar (after Inbox, Today, Upcoming,
   Completed), a "Save view" dialog on Tasks with the available task filters
   (project, label, priority, due window), and `/tasks/views/[id]` rendering
   `TaskList`. Include the new table in backups/import.
6. **Item 13 — Ramble.** Add the transcription setting from the maintainer's
   decision (base URL, model, optional key, defaulting to the chat endpoint), an
   Electron microphone permission plus `NSMicrophoneUsageDescription`, a
   `MediaRecorder` → `/api/ai/transcribe` flow, a multi-task prompt, and a review
   dialog before one atomic batch create with an idempotency key. Verify microphone
   denial, AI off, no transcription endpoint, and a failed create all keep the
   transcript and never duplicate tasks.

At the end: the full `pnpm test`, `pnpm test:e2e`, `pnpm desktop:build` and
`node scripts/leak-guard.mjs --all`, then the spec's Final handoff table.

## Manual checks for the maintainer

- **Item 2:** open an issue whose description has a real GitHub-hosted video and
  image; play the video, open the image, follow a GitHub link, and drag the panel
  edge. Non-GitHub links stay blocked by the existing security policy.
- **Item 3/4:** with a real project, set a default team and open `/epics` and a
  Release page; change the team and check both sections follow it.
- **Item 8:** check a long project title in the sidebar and a tasks-only install.
- **Item 14:** change the zone in Settings → General, restart the app, and check a
  due date/reminder still uses it.

The final full local e2e run passed **205 tests** (0 failures), and the desktop
build produced `release/Deska-1.1.2-universal.dmg`. Two earlier full runs had a
known `ask.spec.ts` timing flake under machine load (it passes alone).
