# Fix spec: bugs and improvements from the full code audit

Audit of the whole codebase at `3207bc9` (v1.2.2), 2026-11-12. Nothing in the code was changed.

**How to read this.** Items are ranked: P1 first (wrong data, duplicate GitHub writes, broken privacy promise, or a bug most users hit), then P2 (real bugs with a narrower trigger), then P3 (edge cases and cheap hardening). Each item has the problem, where it is, the fix, and the test that proves it. `docs/SPEC.md` §0.2 applies to every fix: one test per fix, no real names, mocks only for GitHub, and update `SPEC.md` when behaviour it describes changes.

**Confidence.** Every item was found by reading the code path end to end. The 19 items marked ✔ were re-read a second time against the source. No item was reproduced in a running app or by a new test. `pnpm typecheck` and `pnpm lint` pass on this commit; the unit and e2e suites were not run as part of the audit.

**No P0.** Nothing found loses local data outright, leaks a token, or bypasses the write gate. The allowlist, the request guard, redaction, base-URL validation, backups' table coverage and schema/migration agreement all held up.

---

## Decisions (taken by the maintainer, 2026-11-12)

Three fixes change behaviour an existing test asserts. The maintainer accepted all three as recommended, so the last column is the decision; rewrite the named tests with the fix.

| # | Question | Decision |
|---|---|---|
| D-A | F-4: offline with cached data and a filter that matches nothing. Show the empty state (with "Clear filters") or keep the error state? `tests/e2e/filters.spec.ts:55-66` asserts the error state. | Empty state when anything is cached for the page; the banner already reports the connection. Rewrite the test. |
| D-B | F-5: on a day between two iterations, should "Next release" / "Previous release" resolve by date? `tests/client/today.test.ts:30` asserts all null. | Yes, SPEC §4.1 says "previous/next by date". |
| D-C | W-4: when the token, account or project changes, fail the edits still waiting in the outbox, or keep them? | Fail them with a clear reason. A queued label change or create should not be sent days later under another account. |

---

## P1 — fix first

### S-1 ✔ Nightly sub-issue count refresh never runs in the app
- **Problem.** `reconcile()` only refreshes parent progress when the source has `fetchSubSummaries`. The production factory `githubReconcileSource()` does not expose it, so the refresh SPEC §4.4 [D9] promises never happens. A parent whose child was removed, moved to another parent or transferred keeps stale `50% · 2/4` numbers until the parent itself is edited. Caches from before migration 0005 never fill.
- **Where.** `lib/sync/live.ts:386-394`, `lib/sync/reconcile.ts:149-152`, `lib/sync/source-github.ts:347`.
- **Fix.** Add `fetchSubSummaries: (ids) => gh.fetchSubSummaries(ids)` to the factory. Ship together with S-2, which this fix otherwise makes worse.
- **Test.** The real factory exposes the method; a due reconcile updates a parent whose count changed with no child in the poll. The existing test passes only because it hand-builds a source.

### S-2 One deleted issue makes the whole reconcile fail, and a failed reconcile retries every cycle
- **Problem.** `issueExtras` uses plain `@octokit/graphql`, which throws on the `NOT_FOUND` that comes with partial data for a deleted node. `fetchNodes` tolerates it; `issueExtras` does not. Once S-1 is wired, a closed parent deleted on GitHub breaks every reconcile. A failed reconcile leaves `reconcile.lastRun` unset, so it reruns (metadata, open-ID listing, summaries) every 60 s and reports "sync failed" each time.
- **Where.** `lib/sync/source-github.ts:156-175` (compare `:289-297`), `lib/sync/reconcile.ts:163-172`, `lib/sync/nightly.ts:29,40`.
- **Fix.** Give `issueExtras` the same partial-data handling as `fetchNodes`. Record `reconcile.lastAttempt` and retry a failed reconcile no sooner than one hour.
- **Test.** A fake GraphQL client throwing `{errors:[NOT_FOUND], data:{nodes:[n1,null]}}` returns `n1`; a throwing reconcile is not rerun on the next cycle.

### W-1 ✔ Quit or crash during the first try of a write: duplicate issue on create, false conflict on close
- **Problem.** `attempts` is only incremented after a try finishes. If the app quits while the first try is in flight, `recoverSending` puts the row back as `pending` with `attempts = 0`. Both resume guards test `attempts > 0`, so they are skipped: a create is sent again (a second issue on GitHub), and a close that already landed is reported as "changed on GitHub by someone" with Status never set. SPEC §4.8 [W0] says neither may happen.
- **Where.** `lib/outbox/store.ts:175-192`, `lib/outbox/worker.ts:143` and `:196`.
- **Fix.** `recoverSending` marks the row as possibly sent (`attempts = attempts + 1`, or a `recovered` flag), and both guards treat that as "look before sending again".
- **Test.** Row in `sending` with `attempts = 0` → `recoverSending` → drain with a fake that finds the earlier issue: `createIssue` is not called. Same for close: only the Status write runs. The current test passes only because it sets `attempts = 1` by hand.

### A-1 ✔ AI jobs keep sending data after AI is turned off or the provider changes
- **Problem.** Readiness is checked once when jobs are queued; each job then runs with the settings and key it captured. Queue 100 triage jobs, switch the provider to Off or to a local endpoint, and the other 99 still go to the old endpoint. The runner's own header promises nothing is sent with AI off or untested.
- **Where.** `lib/ai/runner.ts:187-194` and `:224-228`, `app/api/ai/settings/route.ts:59-61`.
- **Fix.** Re-check `aiNotReady()` at the start of each run and fail the job as `off` / `not-verified` when the verified mark no longer matches the captured settings. Abort the running job from the settings POST when the provider, model or base URL changes.
- **Test.** Two jobs against the slow fake; save `provider: "off"` while the first runs; the second ends in `error/off` and the endpoint sees no second request.

### A-2 ✔ "Suggest for this queue" cannot be cancelled once the dialog closes, and can be sent twice
- **Problem.** Closing the dialog (Escape, backdrop) stops polling but not the batch; reopening wipes the batch ID, so up to 200 issues keep going to the model with no way to stop them short of quitting. `start` has no busy guard, so a second click while inputs are built queues every issue twice. A queue over 200 issues is sent unsliced and refused with "Those issue numbers are not valid."
- **Where.** `components/triage/queue-ai.tsx:37-68`, `app/api/ai/triage-queue/route.ts:15`.
- **Fix.** Cancel active jobs on close, as Tidy Inbox already does (`components/tasks/tidy-inbox.tsx:133-135`). Add a busy phase to `start`. Slice to 200 and say so in the dialog.
- **Test.** Start, close → one cancel per active job. Double-click Send → one POST. 250 numbers → the request carries 200.

### A-3 ✔ Dismissing an AI suggestion brings back the previous one
- **Problem.** `latestResultRow` returns the newest row that is *not dismissed*. After "Run again" there are two rows, so dismissing the new one shows the old, outdated one on the next open. Affects triage, Ask, Plan my day and Tidy Inbox. Every existing dismiss test has only one row.
- **Where.** `lib/ai/results.ts:19-28`.
- **Fix.** Take the newest row regardless of outcome and return null when it is dismissed. Also delete older rows for the same feature and subject in `saveResult`, so `ai_results` stops growing by one row per rerun.
- **Test.** Two results for one subject, dismiss the newer → the view returns null.

### F-1 ✔ The issue list scrolls by itself on hover and on every refresh
- **Problem.** The "keep the focused row in view" effect runs whenever the focused row changes, including by mouse hover, and whenever the row array gets a new identity. Three symptoms: (1) move the mouse near the top of a scrolled list and it runs away upwards, one row per mouse movement; (2) hover a row, scroll away, and the next data poll that changes anything scrolls back; (3) with the side panel open, each changed poll snaps the list back to the open issue.
- **Where.** `components/explorer/layouts.tsx:137-138`, `:247-257`, `:348-356`, `:457`; `components/explorer/explorer.tsx:279-284`.
- **Fix.** Scroll into view only on a keyboard move (from `useListKeyboard`) and when the peeked issue changes. Remove `flat` / `tops` / `rows` as triggers.
- **Test.** Playwright, 100+ rows: set `scrollTop = 1000`, move the mouse three times inside the top 30 px → `scrollTop` unchanged. Hover, scroll away, fulfil `/api/data` with one changed title → unchanged.

### F-2 ✔ A filter chip that reads "is any" hides every issue
- **Problem.** Unticking the last value of a chip leaves `{op: "in", values: []}`. The chip says "Status is any" but the engine matches nothing, so the list empties. Switching a chip from "is empty" back to "is" does the same. Saved views and URLs can carry it.
- **Where.** `lib/views/engine.ts:125-134`, `components/explorer/filter-bar.tsx:146-151` and `:187-193`.
- **Fix.** In `compileFilter`, `in` / `not_in` with no values is no constraint. This matches the label and covers URLs and saved views.
- **Test.** Engine unit test that the empty `in` keeps all rows; e2e that unticks the last value and the rows stay.

### T-1 ✔ A recurring task can get stuck so that completing it does nothing
- **Problem.** The server accepts an undo for any earlier occurrence, not only the newest (SPEC [D13] says newest only). Complete a daily task twice, click Undo on the *older* toast, complete twice more: the second completion hits an occurrence that is already logged, `addCompletion` returns false, the date does not move and the click is silently ignored — every time, until the user reschedules by hand. Dragging a task back onto a completed date reaches the same state.
- **Where.** `lib/tasks/service.ts:322-326`, `:347-353`, `:372-389`; `lib/tasks/repo.ts:308-312`, `:750-753`.
- **Fix.** Refuse `undoOccurrence` unless it is the task's newest completion (or delete all completion rows at or after it). Independently, when the occurrence is already logged, still move the date instead of doing nothing.
- **Test.** Complete twice, undo the first date, complete twice → the due date passes the second date. Complete, patch the date back, complete → the date moves.

### T-2 ✔ Undo after dragging a task onto a sidebar project loses its section and position
- **Problem.** The undo patch is only `{ projectId }`. The server clears the section on any project change and appends at the end, so Undo returns the task to the right project but out of its section and at the bottom. The unit test asserts the incomplete undo shape.
- **Where.** `lib/client/task-drop.ts:26-29`, `components/tasks/drop.tsx:36-37`, `lib/tasks/service.ts:339` and `:410`.
- **Fix.** `dropOutcome` returns `undo: { projectId, sectionId, position }`; reuse `undoPatchOf` (`lib/tasks/undo.ts`) with position added.
- **Test.** Move then undo restores `sectionId` and `position` (service test), and the unit test's undo shape.

---

## P2 — real bugs, narrower trigger

### GitHub writes

**W-2 Close can run with no Done Status: the issue is closed, then the job fails.** A close queued behind a reopen runs with the reopen's dependencies, where the Done option is `""`; so does a close on retry after the option was unset. The check sits inside the step loop, after the close was sent. *Where:* `lib/outbox/edit.ts:79,139`, `lib/outbox/worker.ts:243-249`, `lib/outbox/runtime.ts:95`. *Fix:* resolve the Done Status per row at run time and check it before the first step. *Test:* a close with an empty Done Status never calls `closeIssue`; reopen then a queued close through `submitEdit`.

**W-3 A failed create hides the reason and invites a duplicate.** When a create fails after the issue was made (say, adding to the project is refused), the form shows "Request failed (502)", stays open with Create enabled, and the new issue is not in the list. Clicking again makes a second issue. *Where:* `components/issue/create-issue.tsx:86-87`, `lib/outbox/create.ts:126-128`. *Fix:* show `entry.error`; when `entry.result.nodeId` exists, re-read that issue, close the form and say "Created #N, but …". Send a client idempotency key so a resubmit returns the same job. *Test:* a fake failing `addProjectItem` → refresh is called with the created node ID; a component test for the message.

**W-4 Waiting edits survive a token, account or project change (decision D-C).** Rows on backoff stay `pending` when the user replaces the token, disconnects or turns writes off. When writes come back on, possibly under another account, they are all sent; label and assignee deltas and creates have no stale check, and the audit row names the old user. *Where:* `lib/outbox/worker-loop.ts:30-31`, `lib/writes/gate.ts:45-50`. *Fix:* in `consumeTokenChangeReset`, and on a target change, fail all `pending` rows with "GitHub sign-in changed before this was sent". *Test:* row on backoff, `noteTokenChange()`, re-enable writes, drain → no client call, row `failed`.

**W-5 A different GitHub CLI account leaves "GitHub writes" on.** With the CLI source, a token read on launch, wake or "Check again" never resets the switch, even after `gh auth switch` to another account. With a CLI token that switch is the only user-level gate. *Where:* `desktop/main.ts:376-383`, `desktop/server-entry.ts:66`, `lib/writes/gate.ts:45-50`. *Fix:* keep the exemption for a same-account re-read, but when the connection check sees an owner different from the saved identity, turn writes off and reset write access (and apply W-4). *Test:* writes on as alice, a `launch` token for bob, run the check → the setting is off.

### Sync

**S-3 New labels, milestones, Status options and iterations have no name for up to 24 h.** Metadata is fetched only by the first import, the daily reconcile and "Reload fields". A label or sprint created today is stored under a provisional ID with no name, colour or dates until tomorrow. *Where:* `lib/sync/store-postgres.ts:226-267`, `lib/sync/cycle.ts:147-167`. *Fix:* when a cycle hands out a provisional ID or sees an unknown option or iteration ID, refresh metadata in that cycle, at most once per 10 minutes. *Test:* a poll with an unseen label and milestone → after one cycle both rows exist and references are re-keyed.

**S-4 Remapping fields during a project scan is overwritten by the scan's remaining pages.** `reproject()` rewrites the role columns without the sync lock; the running cycle keeps writing with the old map and records false "changed by sync" history, which sprint-scope numbers read. *Where:* `lib/server/project-setup.ts:122-155`, `lib/sync/cycle.ts:156`. *Fix:* run `saveMapping` + `reproject` under the sync lock. *Test:* two-page scan, remap between pages → final columns follow the new map, no `sync` history rows.

### AI

**A-4 An accepted triage suggestion keeps coming back with Accept enabled.** Accepting bumps the issue's `updated_at`, so the same suggestion reappears as "Outdated · Run again" with Accept and Edit live; accepting again can overwrite a teammate's later change. *Where:* `lib/ai/triage-service.ts:111-122`, `components/issue/ai-suggestion.tsx:148-152`, `:291-296`, `app/api/ai/results/[id]/outcome/route.ts:43-46`. *Fix:* return no suggestion (or a read-only "Accepted") once `acceptedAt` is set; refuse Accept in the route when the stored hash is stale. *Test:* after accept the GET returns `suggestion: null`; a stale-hash accept returns 409.

**A-5 ✔ Ask answers can load images from any host.** `answerHtml` filters anchors only; markdown `![x](https://…)` becomes an `<img>` that loads on render. An issue body can instruct the model to end its answer with an image URL carrying other issues' titles. The desktop CSP blocks non-GitHub images; the browser mode's `img-src https:` does not. *Where:* `lib/ai/ask-html.ts:12-16`, `lib/csp.ts:19`. *Fix:* strip `<img>`, `<video>` and `<source>` in `answerHtml` (keep the alt text). *Test:* `answerHtml("![x](https://example.com/a.png)")` contains no `<img`.

### Local data

**B-1 Import silently drops tasks when a project or label name already exists under another ID.** The colliding project is skipped, then its sections (parent missing), then every task in those sections with its sub-tasks, comments, reminders and links. The UI only says "Rows that already exist were kept." This is each §4.7 rule applied literally; the task loss is the unintended sum. Typical trigger: importing an export on a second Mac, or after "Reset everything" and recreating a project. *Where:* `lib/backup/local-data.ts:47-56`, `:203`; `db/schema.ts:384`, `:428`. *Fix:* when a project, label or section is skipped on a name collision, map the file's ID to the existing row and rewrite child references before inserting. Show per-table skipped counts. *Test:* project + section + task, export, reset, create a same-named project, import → the task exists under the existing project.

**B-2 ✔ "Restore from latest backup" can leave an empty app with the real database set aside.** Recovery renames `db` to `db.damaged-…` before it knows a fresh database can be opened. `openDatabase()` offers recovery for *any* startup error (failed migration, full disk), so the fresh open can fail for the same reason; on the next launch the empty folder opens fine, no prompt appears, and nothing is restored. *Where:* `lib/backup/recover.ts:48-56`, `lib/desktop/startup.ts:17-31`. *Fix:* on failure after the rename, remove the new folder and rename the damaged one back, or persist a "recovery pending" marker. Word "migration failed" differently from "could not open". *Test:* make `ensureMigrated` throw after the rename → the original folder is back, or the next open still reports failed.

**B-3 Importing a file over 10 MB fails with "This is not a Deska backup or export file."** Next 15.5 truncates request bodies at 10 MB when a middleware matches (it matches everything here), and `next.config.ts` does not raise it. The truncated JSON parses to `null`. Deska's own export of a long task history cannot be imported back. *Where:* `middleware.ts:44`, `app/api/local-data/import/route.ts:10`. Read from Next's source, not exercised live. *Fix:* raise `experimental.middlewareClientMaxBodySize`, or have the desktop import pass a file path; return a distinct "file too large" error. *Test:* POST a valid 11 MB document through the running server → 200.

### Desktop shell

**D-1 A Dock click during startup opens a broken window, then a second one.** `server` is assigned before the launch cookie is set, the server listens, or the recovery prompt runs. `activate` only checks `!mainWindow && server`, so an early click shows "Forbidden" or connection refused, ahead of the recovery dialog; boot then opens another window and orphans the first. *Where:* `desktop/main.ts:787`, `:849-857`, `:882-884`. *Fix:* a `booted` flag set after `offerRecovery`, checked by `activate`, `showMainWindow` and `openQuickAdd`; remember an early activation. *Test:* emit `activate` right after launch → exactly one window, loaded with 200.

**D-2 ✔ A local `desktop:build` ships the repo's `.env` inside the app.** Next's standalone output copies `.env` and `.env.production`; `stage()` copies everything except `node_modules`. A dmg built on a machine with a `.env` contains it and loads it at runtime. CI releases are clean checkouts and unaffected, but this repo is public and its `.env` is the one file meant to hold real names. *Where:* `scripts/desktop.mjs:82-92`. *Fix:* delete `.env*` from the staged server and throw if any remain. *Test:* stage with a dummy `.env` in a temp root → none under `desktop/build/server`.

**D-3 Settings and secret files are written in place.** A crash or full disk mid-write truncates `desktop-prefs.json`; the fallback is all defaults, so the sign-in source returns to "token" (a CLI user lands in onboarding) and the second backup folder is silently dropped. A truncated token file means re-entering the token. Related: `ghSent` is set before the server acknowledges the token, so a timed-out send is never retried. *Where:* `desktop/main.ts:379-381`, `:467-476`, `:667`, `:687`, `:703`. *Fix:* write to a temp file then rename; keep an unparsable file as `.bad`; set `ghSent` after the send succeeds. *Test:* `writeAtomic` helper test; `loadPrefs` with a truncated file.

### Tasks

**T-3 ✔ Delete then Undo fires old reminders again.** A soft delete hard-deletes the task's notification rows, which are the dedupe keys. After Undo, every reminder from the last 24 h fires again as a native banner. The delete is unnecessary: the bell already hides rows of deleted tasks and the foreign key cascades on the real delete. *Where:* `lib/tasks/service.ts:435`, `:438`. *Fix:* remove both `deleteNotificationsForTask` calls. *Test:* fire → delete → restore → fire again returns 0.

**T-4 Picking two labels quickly keeps only the second.** Label, link and reminder edits in the task panel send the full list computed from props that only update when the previous request returns. Click A then B before A's answer and the task has only B; removing two reminders quickly re-adds the first. *Where:* `components/tasks/store.tsx:236-253`, `components/tasks/panel.tsx:273-318`, `components/tasks/organize.tsx:108-111`, `components/tasks/schedule.tsx:322-338`. *Fix:* apply `labels`, `links` and `reminders` optimistically in `update`. *Test:* two overlapping `update` calls keep both labels.

**T-5 Opening an older row on Completed says "Task not found. It was deleted."** The page lists up to 1000 completions, the store holds the newest 200, and the panel only looks in the store. *Where:* `components/pages/completed.tsx:91`, `components/tasks/panel.tsx:69`, `:94-104`. *Fix:* render from the panel's own fetch when the task is not in the store; say "deleted" only on a 404. *Test:* 201 completed tasks, open the oldest → its title shows.

**T-6 A task cannot be dragged to the end of its list.** A drop always inserts above the target row, and the same-section header drop returns early. The only way is Alt+↓, one step at a time. *Where:* `components/pages/tasks.tsx:103-121`, `:188-192`. *Fix:* an end-of-group drop zone that sets `position = last + 1`. *Test:* drag the first task below the last; order holds after reload.

**T-7 The new-label dialog shows nothing when it fails.** A duplicate name returns 400, but the error goes to a banner behind the modal (or not rendered at all on issue pages), so the dialog just sits there. A double Enter creates the label and then leaves a stray error. The project and section dialogs share the shape. *Where:* `components/tasks/organize.tsx:186-198`, `components/tasks/store.tsx:436-443`. *Fix:* a submitting guard and an inline `role="alert"` in the three dialogs; check the name on the client first. *Test:* create "waiting" twice → an alert inside the dialog; double Enter → one label, no banner.

**T-8 The sidebar project count includes sub-tasks the project page hides.** Give a sub-task a project (panel, or drag from Today): the toast says "Moved to X" and the count rises, but X's page does not list it. *Where:* `components/app/sidebar.tsx:168-171`, `components/pages/tasks.tsx:82`. *Fix:* skip sub-tasks in the count and refuse a project on a sub-task (hide the picker, refuse the drop). *Test:* the count equals the rows the project view produces.

### Issues UI

**F-3 ✔ ⌘K "Search all issues for …" does nothing when already on All issues.** URL state is read only on mount and when the saved view changes, so a changed `?s=` on the same route is ignored; the next filter edit then overwrites the URL. The reverse too: clicking "All issues" in the sidebar leaves the list filtered. *Where:* `components/explorer/use-url-state.ts:30-37`, `components/app/palette.tsx:270-271`. *Fix:* remember the last `s` the hook wrote; re-decode when the URL's differs. *Test:* on `/issues`, run the palette search → the box holds the query and rows are filtered; then the sidebar link clears it.

**F-4 ✔ Offline with cached data, a filter with no match shows "Can't reach GitHub" (decision D-A).** The condition is "zero rows and a connection problem", without checking that anything is cached. The user loses "Clear filters" and the list of active filters. *Where:* `components/explorer/explorer.tsx:400-413`, `components/pages/release.tsx:159`. *Fix:* the error state only when nothing is cached for the page. *Test:* offline + normal data + no-match filter → `[data-list-state=empty]`; emptied data → `error`.

**F-5 ✔ Next and previous sprint are empty on any day outside an iteration (decision D-B).** On a break day, or before the first sprint, all three resolve to null, so the "Next release" filter matches nothing and the palette entry disappears. *Where:* `lib/client/today.ts:13-18`, `lib/views/rows.ts:135-139`. *Fix:* with no current iteration, next = first starting after today, previous = last ending on or before today; in both resolvers. *Test:* R1 ends 11-10, R2 starts 11-17, today 11-12 → `{current: null, next: R2, previous: R1}`.

---

## P3 — edge cases and cheap hardening

One line each; all are small.

| ID | Problem | Where | Fix |
|---|---|---|---|
| W-6 | A row can stay `sending` without a crash (a failed `recordAttempt` transaction) and blocks that issue and field until restart | `lib/outbox/store.ts:270`, `worker-loop.ts:43` | In the tick, reset `sending` rows older than a few minutes, marked as possibly sent (W-1) |
| W-7 | Type and project-field edits skip the "issue still lives in this repo" check; a transferred issue gets its Type written in another repo | `lib/github/write-client.ts:332-338`, `:368-388` | Run the same repository check as the REST path |
| W-8 | `POST /api/issues/edit` is used only by a smoke test, sends no `base` and trusts a client-supplied count | `app/api/issues/edit/route.ts` | Delete it (SPEC §0.2: delete dead code) |
| W-9 | Label and assignee deltas read the current value and ignore it: two wasted GitHub calls per edit, doubled on bulk | `lib/outbox/worker.ts:129-138` | Skip the read for deltas |
| S-5 | Changing project: a sync cycle can start between the cache clear and saving the new target, leaving the old repo's data under the new target | `lib/server/project-setup.ts:172-178` | Save the target inside the same locked unit as the clear |
| S-6 | A renamed or deleted org surfaces as "Can't reach GitHub" forever (any `TypeError` counts as offline) | `lib/sync/source-github.ts:379`, `lib/sync/health.ts:101` | Null-check and throw a typed "project not found"; match only fetch failures as offline |
| S-7 | `runOnce` reads settings before its `try`; a DB error there is an unhandled rejection with no recorded failure | `lib/sync/service.ts:60-81` | Move the reads inside the `try` |
| A-6 | Transcription: size checked after the whole body is buffered, cancel does not abort the upload, and the chat endpoint is used as a fallback even when untested | `app/api/ai/transcribe/route.ts:12-22` | Reject on `Content-Length`, pass `req.signal`, require the verified mark for the fallback |
| A-7 ✔ | `claude` output is decoded per chunk, so a multi-byte character split across chunks becomes `�` (Czech titles, emoji), sometimes failing the schema | `lib/ai/claude.ts:71-76` | `setEncoding("utf8")` on stdout and stderr |
| A-8 | Opening an issue with a stored suggestion makes a live GitHub comments call only to compute "Outdated", though the hash does not cover comments | `lib/ai/triage-service.ts:118`, `ask-service.ts:145` | A hash-only input builder |
| B-4 | Two Macs sharing one second folder: each hour one deletes the other's weekly backup and the other copies it back | `lib/backup/files.ts:146-163` | Copy only what retention would keep, or use a per-install subfolder |
| B-5 | Backups are not fsynced and stale `.tmp` files are never removed; a zero-byte newest backup suppresses the next daily one | `lib/backup/files.ts:151-212` | fsync before rename, clean old temp files, ignore an empty newest file |
| D-4 | The release workflow builds the writes-on dmg after only the leak guard; the shipped configuration is never tested | `.github/workflows/release.yml` | Run `pnpm test` and `pnpm test:desktop` in the release job, or require green CI on the tagged commit |
| T-9 | Undoing a recurring completion leaves the sub-tasks it reopened open | `lib/tasks/service.ts:386`, `components/tasks/store.tsx:334` | Re-complete the remembered children on Undo |
| T-10 ✔ | Making a one-off task recurring (or the reverse) changes the reminder key and re-fires the last 24 h of reminders | `lib/tasks/notify.ts:31` | Always key by instant; treat the old key as already fired |
| T-11 ✔ | Snooze on a task with 10 reminders silently deletes one of the user's own | `lib/tasks/service.ts:295-298` | Drop the oldest snooze, never a real reminder; else refuse |
| T-12 | The Dock badge reloads the full task list (about 8 queries) every 30 s and after each edit; Completed looks tasks up one at a time | `lib/desktop/reminders.ts:63-66`, `lib/tasks/service.ts:609-611` | One `count(*)` for the badge; one `inArray` for Completed |
| T-13 | Tasks-only mode still shows "Pull in from GitHub", "Link issue" and the `#1234` hint | `components/pages/tasks.tsx:407-416`, `panel.tsx:277`, `compose.tsx:331-335` | Gate on `useTasksOnly()` |
| T-14 | Typing a due date in the panel sends one PATCH per keystroke with year-0002 dates in between (not executed; rests on Chromium's date input) | `components/tasks/bits.tsx:144`, `panel.tsx:284-286` | Commit on blur or Enter |
| T-15 | A late response can revert a newer optimistic edit, or re-add a task that was just deleted | `components/tasks/store.tsx:183-193` | `replace` inserts only for create and restore, and keeps fields with a queued patch |
| F-6 | Insights: evening west of UTC drops new issues from the age buckets; a deleted view scope shows zeros under "this shows the whole repo" | `lib/client/insights.ts:45-81` | Clamp age at 0; make the banner match the data |
| F-7 | The triage walk is fixed before snoozes and the default scope load, so a reload includes snoozed issues and every team | `components/pages/triage-run.tsx:80-82` | Capture the walk once both report loaded |
| F-8 | Risk "Added after the start" links to the whole release; scope-added is fetched twice per page | `components/pages/release-risk.tsx:17-34`, `:104-108` | One hook in the summary; narrow the link to those issues |
| F-9 | Board `j`/`k` cannot reach cards past 50 in a column after "Show more" | `components/explorer/explorer.tsx:171`, `board.tsx:277` | Share the per-column limits with keyboard navigation |
| F-10 | Sub-issues "couldn't load the rest — Retry" can be a dead button when paging finished but GitHub's total is higher | `components/issue/sub-issues.tsx:55-72` | Show Retry only after a failure |

---

## Suggested order of work

One PR per group, each with its tests. Groups are independent unless noted.

1. **Sync correctness:** S-1 + S-2 (together), then S-3, S-4, S-5, S-6, S-7. **Done** (in the working tree, not committed).
2. **Outbox recovery and identity:** W-1 + W-6 (same mechanism), W-2, W-4 + W-5 (decision D-C), W-3, W-7, W-8, W-9. **Done** (in the working tree, not committed).
3. **AI job control and results:** A-1, A-2, A-3, A-4, A-5, then A-6 to A-8. **Done** (in the working tree, not committed). A-3 keeps the older rows (an existing test requires it); only the query changed.
4. **Issue list UI:** F-1, F-2, F-3, then F-4 and F-5 (decisions D-A, D-B), then F-6 to F-10. **Done** (in the working tree, not committed). Also fixed on the way: the list's scroll listener was never attached in development builds, so a scrolled list rendered no rows there (and e2e could not test scrolling).
5. **Tasks:** T-1, T-2, T-3, then T-4 to T-8, then T-9 to T-15. **Done** (in the working tree, not committed).
6. **Local data:** B-1, B-2, B-3, then B-4, B-5. **Done** (in the working tree, not committed). B-3 is tested at the route and config level, not through Next's 10 MB cut-off.
7. **Desktop and release:** D-1, D-2, D-3, D-4. **Done** (in the working tree, not committed). D-1 has an Electron test (an `activate` before boot → one window, 200). D-4's release job runs typecheck, `pnpm test` and `pnpm test:desktop`; the smoke reads the build's write switch, so it covers the writes-on dmg too.

`SPEC.md` needs a line for: S-2 (reconcile backoff), W-4/W-5 (what a token or account change does to waiting edits), A-1 (readiness re-checked per job), B-1 (import remaps name collisions), F-2 (an empty value list is no constraint), F-4 and F-5.

## Known and left out on purpose

- Theme and other `localStorage` state is lost on every relaunch because the port changes. Already recorded in `docs/PROGRESS.md` and ADR-001.
- Quick add reads bare priority words and weekday abbreviations out of a title ("Buy low fat milk" becomes P4). The tests assert it and a token can be reverted, so it is treated as chosen.
- Whether GitHub's project `items` connection returns archived items could not be checked offline; `isArchived` is never read. Worth one check against a real project.
- Low-value findings were dropped: the free-port race at startup (already fails closed), the dev-only HMR WebSocket filter, the lexical-only second-folder check, export without a single snapshot, the connection poll not using the shared poller, and task-row re-render cost.
