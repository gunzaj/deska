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
| 5 | AI Assist: model and effort selection | done | 1f342c7 | Model list on Settings open (Custom… stays); Claude effort only when `claude --help` lists `--effort`; OpenAI has no effort; `verifyId` unchanged |
| 6 | Investigate slow AI actions | done | ca2a281 | Queue, provider and CLI timings shown and logged; triage input is bounded-parallel and comments-only; measurements below |
| 7 | Command+K switcher: Escape | done | 0cb5b3d | Escape closes the palette; navigation and selection still work |
| 8 | Sidebar identity | done | 257653f | Project title primary, repository beneath, tooltip, truncation; fallback "Deska" + repo |
| 9 | Triage button labels | done | 2887bd8 | Visible Back and Next; the same `go(-1)` / `go(1)` handlers; footer hints updated |
| 10 | View watchlist: investigate notifications | done | d61154a | Daily digest, lazily on the notification poll; view-digest test added; report below |
| 11 | New issue: searchable label picker | done | e6e85c9 | Popover + PickList with search, checkmarks and empty text; chips remove labels; assignees unchanged |
| 12 | Tasks: saved custom views | done | 191dbac | `views.kind`, strict task-view schema, sidebar after Completed, Save view, `/tasks/views/[id]`, backups/import |
| 13 | Tasks: voice-based creation with Ramble | done | 06c83f8 | Record → transcribe → review → one atomic batch; separate transcription key; microphone permission; report below |
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
- **Items 5–6, 10–12:** `pnpm typecheck`, `pnpm lint`, `pnpm test` (167 files,
  1213 tests). Targeted Playwright specs `ai-settings`, `create` and `task-views` pass when
  run one at a time.
- **Item 13:** `pnpm typecheck`, `pnpm lint`, `pnpm test` (167 files, 1213 tests);
  targeted Playwright specs `ai-settings`, `ramble` and `task-views` pass one at a time.
- **Final:** `pnpm typecheck`, `pnpm lint`, `pnpm test` (168 files, 1220 tests),
  `pnpm test:e2e` (211 tests, one worker, one retry allowed and none used),
  `pnpm desktop:build` (`release/Deska-1.1.2-universal.dmg`) and
  `node scripts/leak-guard.mjs --all` all pass. The full e2e run also caught an
  issue-view save that sent the task-view `kind`; the client no longer does, and the
  `views` spec covers it. The mocked and database projects share the two dev
  servers, so the final run used one worker; default-worker runs flaked in
  settings, views, bulk, health, ask and sprint specs, which each passed alone.

## Phase 2/3 plan (completed)

All 14 items are done on `improvements`, one commit each; nothing was pushed and no PR
was opened, per the maintainer's instruction. The plan below is kept for reference.

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

## Item 10 — view watchlist (report)

**What a view watch is.** Watching a view stores one row per person and view
(`kind: "view"`, the saved view's ID) with a last-seen time. It is a **daily
digest**, not a notification per change: at most one `watch_digest` bell entry per
person per calendar day in their own time zone, deduped by
`watch:<login>:<day>`, titled "N watched items changed" where N counts watched
items that have at least one field change since that item's last look. The digest is
generated lazily when the client polls `/api/notifications` (every 30 s, the same
poll that fires reminders), never by sync and never by a timer of its own. An issue
watch is the same digest for one issue. A view watch covers the issues the saved
view matches, recomputed on the server each time the digest fires.

**What it is not.** No per-change bell entry, no push, no email. The bell is the
only place it appears. Native macOS notifications are reminders only
(`lib/desktop/reminders.ts` → `desktop/main.ts`); a watch digest never becomes
one. Opening a watched issue or view (`markSeen`) moves its last-seen time and
clears everything before it.

**Test added.** `tests/watch/digest.test.ts` — "covers a watched view": one digest
for two changes to an issue the view matches, not one per change, and the same
daily dedupe as an issue watch.

**Limitations.** The digest exists only while Deska runs and the client polls; the
title counts changed watched items, not the number of changes; a view's coverage is
evaluated when the digest fires, so an issue that left the view between polls is
not reported.

## Item 5 — AI model and effort (report)

Claude Code keeps the alias select (`sonnet` default, `opus`, `haiku`), adds the saved
custom model and "Custom…", and shows an effort select (Default, `low`, `medium`, `high`,
`xhigh`, `max`) only when `claude --help` lists `--effort`; only a set effort is passed
as `--effort`. OpenAI-compatible Settings loads models from `GET /api/ai/models` when it
opens, keeps the saved model selected when the list is unavailable, and says effort is not
available. `verifyId` still covers provider, model and base URL only, so changing effort
does not clear "Test connection".

**Limitations.** The model list depends on the endpoint implementing `GET /models`; a typed
model still works. Effort support is read from the installed CLI's help text, so an unusual
wrapper can hide it. The CLI decides which effort levels it accepts.

## Item 6 — slow AI actions (report)

Every job now records `createdAt`, `startedAt`, `queueMs`, `durationMs` and the provider's
own `durationMs` / `durationApiMs` (Claude Code's `duration_ms` / `duration_api_ms`); one
redacted line per finished job goes to the server log, and the UI shows elapsed time while
a job runs. Offline: the fake `claude` with a 300 ms delay took ~552 ms wall, the mock
OpenAI endpoint ~21 ms. One real Claude Code call (approved): wall 3307 ms, CLI
`duration_ms` 1158 ms, `api_ms` 1028 ms, cost $0.0002446 — most of the wall time was
process start and the queue, not the model.

**Fix.** Triage input construction now runs bounded-parallel (`mapBounded`, 4 at a time) and
reads only the issue's comments instead of the full issue detail. With a 250 ms GitHub delay,
a three-issue triage batch went from 1612 ms to 291 ms.

**Limitations.** Wall time includes queueing and the UI's poll interval, so the elapsed
display is the honest number; the real measurement is one call on one machine. The GitHub
delay was simulated, and triage's input concurrency is a fixed 4.

## Item 11 — searchable label picker (report)

The label checkboxes became a **Labels** button with a `Popover` and the shared `PickList`
(search, checkmarks, empty text), plus a chip row for the chosen labels with a remove
button. Assignees keep their checkboxes.

**Limitations.** Chips wrap rather than scroll or virtualize; the list comes from the cached
repo labels, so a new label appears after the next cache refresh.

## Item 12 — saved task views (report)

`views` gained `kind` (migration 0009, default `issues`, indexed). A strict task-view schema
covers project (any, Inbox or one), label, priority and due window. The Tasks section of the
sidebar lists them after Inbox, Today, Upcoming and Completed; **Save view** on Tasks opens a
dialog with those filters, and `/tasks/views/[id]` renders `TaskList` with the view's filters
and can delete the view. Backups and imports validate issue and task views by `kind`; a backup
from before the column reads its views as issue views.

**Limitations.** A task view holds one label, not several, and no text search; the due windows
are the fixed set, not arbitrary dates; a view can be saved or deleted but not edited in place.

## Item 13 — Ramble (report)

Settings → AI has a transcription subsection (base URL, model, optional key) even when no AI
provider is chosen. The base URL defaults to the OpenAI-compatible chat endpoint's, the model to
`whisper-1`, and Claude Code users set an endpoint because that CLI has no audio input. The
transcription key has its own keychain file, server memory slot and redaction entry. Ramble
records with `MediaRecorder`, sends the recording to `POST /api/ai/transcribe`, then asks the chosen
provider to split the transcript into up to 12 tasks. The review dialog shows an editable transcript
and one editable row per task (title, due date/time, priority, project, section, labels; rows can be
removed or added); **Create** sends them to `/api/tasks/batch`, which validates every row before one
`repo.locked` transaction and reuses the idempotency key on retry. Electron grants the microphone
permission only for audio, and macOS declares `NSMicrophoneUsageDescription`.

**Limitations.** The transcription endpoint must be OpenAI-compatible (`/audio/transcriptions`); uploads
are capped at 25 MB; recording stops itself after two minutes; the parse needs a configured, tested AI
provider, and with AI off the transcript becomes one editable row the user can still create. A denied
microphone and a real transcription endpoint are manual checks (below).

## Manual checks for the maintainer

- **Item 2:** open an issue whose description has a real GitHub-hosted video and
  image; play the video, open the image, follow a GitHub link, and drag the panel
  edge. Non-GitHub links stay blocked by the existing security policy.
- **Item 3/4:** with a real project, set a default team and open `/epics` and a
  Release page; change the team and check both sections follow it.
- **Item 8:** check a long project title in the sidebar and a tasks-only install.
- **Item 14:** change the zone in Settings → General, restart the app, and check a
  due date/reminder still uses it.
- **Item 5:** with the real Claude CLI, check the model list and that the effort
  picker appears only when `claude --help` lists `--effort`; change effort, then run
  Test connection and one action. With a real OpenAI-compatible endpoint, check the
  model list on Settings open and that a saved model stays selected when the endpoint
  has no `/models`.
- **Item 6:** run one real triage or task action and compare the elapsed display and
  the server log line with the real latency.
- **Item 12:** save a task view with a project, label and due window, open it from
  the sidebar, restart the app, and delete it from its page.
- **Item 13:** in the desktop app, deny the microphone once and confirm the
  transcript is kept; allow it, record a short list of tasks, edit the transcript and
  a row, and create. Then check a real transcription endpoint (the model defaults to
  `whisper-1`) and that a failed create followed by a retry does not duplicate.

The final full local e2e run passed **211 tests** (0 failures), and the desktop
build produced `release/Deska-1.1.2-universal.dmg`. The run used one worker because
the two dev servers share settings and task state across spec files; default-worker
runs flaked in settings, views, bulk, health, ask and sprint specs, which each
passed alone.

## Review pass before the PR

The branch was reviewed against `docs/SPEC.md` and this file before the PR was
opened. These bugs were found and fixed, each with a test where the code is pure:

- **Ramble, Cancel while recording** still uploaded the recording: Cancel/Escape/the
  backdrop went through `stop → onstop → transcribe`. A per-open session id now
  discards the stopped recorder's answer, and every `parse`/`transcribe`/`poll`/
  `create` continuation checks it, so a late answer can't land in the next dialog.
- **Ramble, microphone and recorder setup**: a failed `MediaRecorder` setup left the
  stream live, and a permission granted after the dialog closed could start
  recording in the background. Setup failures stop the tracks, and the permission
  answer is checked against the session.
- **Ramble, a vanished parse job** (server restart, pruned job) polled a 404
  forever; it now falls back to one editable row after a 404 or ten failed polls,
  and the parse screen has a Cancel button.
- **Ramble, "Add task"** could pass the 12-task cap and make Create fail after the
  review; it stops at `MAX_RAMBLE_TASKS`.
- **Ramble, a section from another project** passed the one enum of every section
  and made Create refuse the whole batch; the schema now rejects a section that is not
  in the task's project, so the normal retry/invalid-output path runs.
- **Tidy Inbox Undo** brought a moved date back without the day of the month the
  server had re-pinned; it now sends the old rule too.
- **A saved Inbox task view** listed sub-tasks (their own project is null) while
  the Inbox page and badge kept them out; the Inbox view now hides them.
- **A batch-create retry** that overlapped the first request could create two
  batches (the key was only remembered after commit); the second now waits for the
  first.
- **Clearing a recurrence while moving the date** in one PATCH brought the
  recurrence back; the day-of-month repin only runs when the patch did not name a
  recurrence.
- **A one-off absolute reminder** that fired before the upgrade fired again (the
  dedupe key gained the instant); one-off reminders keep the old key, recurring ones
  keep the instant.
- **The microphone permission** also granted the camera when a request asked for both;
  only an audio-only request is allowed.
- **Settings → AI** told a user without Claude Code to update it; it now says the CLI
  is not installed.
