# Deska robustness fix specification

**Status:** Proposed. The audit reproduced five failures and measured one task-query inefficiency. This spec defines the fixes and their acceptance tests.

| Order | Priority | Change |
|---|---|---|
| 1 | P1 | Enforce write authorization through dispatch and cancel revoked outbox work |
| 2 | P1 | Make issue creation safe to retry |
| 3 | P1 | Export backups from a consistent database snapshot |
| 4 | P2 | Reconcile tab navigation with the most recent selection |
| 5 | P2 | Persist large tab sessions and save on desktop quit |
| 6 | P2 | Load task filing and labels by task ID |

The write fixes share the outbox and ship together. Backup and task query changes are independent. Fix tab navigation before persistence so the saved session reflects the selected tab. Use the fictional `acme/widgets` fixtures and mock every GitHub call. The operation allowlist and the three requirements of the write gate in [SPEC §3.4](SPEC.md#34-write-gate) apply throughout.

## 1. Enforce write authorization through dispatch

**Observed failure.** In a two-row drain, the second mock mutation ran after the write switch turned off. A separate edit on backoff remained pending and ran after writes were re-enabled. The drain and the fast path can both reuse dependencies acquired before authorization changed. [Write gate](../lib/writes/gate.ts) · [Worker loop](../lib/outbox/worker-loop.ts) · [Outbox store](../lib/outbox/store.ts)

### Required behavior

- Turning writes off commits the switch change and fails waiting edits, including those on backoff, in one database transaction. Record the reason and an audit outcome for each failed row. Re-enabling authorizes future user actions.
- Bind each new write job to the authorization context under which it was accepted. Use a durable revision for explicit revocations such as disabling writes, replacing or disconnecting a token, switching accounts, and changing the pinned target. Validate the revision when enqueuing and dispatching. Advance it as part of the local transition that invalidates waiting work. A same-account CLI token refresh can preserve the durable revision, but a client built with a superseded token must reacquire current authorization before dispatch.
- Apply one dispatch check to fast-path edits, followers, background drains, and every mutation within a multi-step job. Check the build, preference, current token and capabilities, pinned target, and job revision. Synchronize the final check and request start with revocation. Bind the check to the actual transport call, including any retry inside the client, or route mutation retries through the outbox. Keep network waits outside database transactions and outside the section that serializes dispatch with revocation.
- A request already dispatched may complete. Record its confirmed result and any finished step. Before a later step or retry, check the same authorization rules. A revoked job never returns to `pending`, including during restart recovery. Keep its recorded result and make the error distinguish a cancelled unsent edit from a partial or unconfirmed write.
- Publish a successful setting change after its database transaction commits. If a token or target transition cannot be persisted, fail closed until the transition is reconciled. Use a new Drizzle migration for the durable job revision. Existing completed and failed rows remain readable. Existing pending or interrupted rows without a provable authorization context become terminal with a review reason, preserving any recorded step or issue reference.

### Acceptance

- With one edit on backoff, disable writes and then re-enable. The row stays failed, an audit row identifies why, and the mock sees zero requests for it.
- Block the first mutation in a drain. Disable writes, release the response, and assert that the first result is recorded and the second mutation never starts. Repeat with a queued fast-path follower and a delayed client retry.
- Disable writes after Close succeeds and before its Status update. The recorded close survives, Status is never sent, the response explains the partial result, and restarting with writes on does not resume the job.
- Race enqueue and dispatch with token and target changes. An old-context job cannot ship even if the new context also allows writes. Cover a same-account CLI refresh and a failed revocation transaction. Assert that a build with writes off sends no mutations.

## 2. Make issue creation safe to retry

**Observed failure.** Recovery searched by account, title, body and time. A mock returned an earlier issue with the same text, which the worker added to the project and edited. The create form also sends no idempotency key, so a lost HTTP response followed by a resubmit can create a second local job. [Create form](../components/issue/create-issue.tsx) · [Create route service](../lib/outbox/create.ts) · [Create recovery](../lib/github/write-client.ts) · [Worker](../lib/outbox/worker.ts)

### Required behavior

- Generate a key for each intentional submission and retain it for retries of that submission. Wire it through the create endpoint to the existing durable outbox key. A replay in the original account and target returns the existing job or result, even when its saved choices have since changed in the cache. Reusing its key with different input or a different account or target returns `409` without exposing another context's result. A replay of revoked work cannot create a replacement job. An explicitly new submission gets a new key, including when its text is identical.
- Before sending the remote create, durably record that the job may issue the request. Once GitHub returns a valid issue ID and number, persist that result before adding it to a project or setting fields. Subsequent steps derive their target from the job's own stored result. Remove the title/body/time lookup.
- A timeout, disconnect, crash after recording dispatch intent, or unusable success response can leave creation unconfirmed. When the job has no confirmed issue ID, end it with a distinct outcome and a message such as “Deska could not confirm whether the issue was created. Check GitHub before starting a new submission.” A retry with the same submission key shows that outcome without another create call. Retry automatically only when Deska can establish the previous attempt left the remote issue uncreated. Existing retried create rows without a confirmed result follow the same conservative rule.
- When a confirmed issue exists but a later step fails, keep its issue number visible and refresh that issue where applicable. A retry of a later step uses the stored ID and still goes through the current write gate.

### Acceptance

- Two concurrent POSTs with the same key cause one outbox job and at most one mock create request. A retry after losing the HTTP response returns the original outcome. A changed payload, account or target with the same key returns `409` without creating a new job. Two distinct keys with identical title and body create distinct jobs.
- Simulate a lost remote response with an earlier identical issue in the mock. The job ends unconfirmed, with zero project additions or field changes on the earlier issue and zero automatic repeat creates. Cover restart after recording intent, pre-dispatch failure that is safe to retry, and a legacy interrupted row.
- Simulate a failure after the confirmed issue is saved. Only the remaining eligible steps run on that issue. The form shows the issue number even when a later step fails.

## 3. Export backups from a consistent database snapshot

**Observed failure.** A section and its task were created after export read sections but before it read tasks. The file contained the task with a missing section. Import skipped the task. [Local backup data](../lib/backup/local-data.ts) · [Backup writer](../lib/backup/files.ts)

### Required behavior

- Use one database transaction with a consistent snapshot for table discovery, row reads and the applied migration count. Pass its connection to each query. Use isolation that guarantees a stable snapshot across statements. Preserve the applied-version fallback when the migration table is absent without leaving a transaction in a failed state.
- Read only the existing local-data tables. Preserve omission of tables absent in older schemas, the file format, and redaction. Finish the database transaction before redacting, serializing, or writing the file. Daily, manual, pre-migration, pre-reset, and Settings export all use the same path.

### Acceptance

- Coordinate a task and section write with an export at a deterministic query boundary. Restore into an empty test database and assert that the task and its section are both present or both absent. Assert zero foreign-key-related skips for the exported rows. Include the placement in the assertion.
- Preserve a pre-migration backup's applied schema version and restore behavior. The existing token redaction, backup retention and round-trip tests continue to pass.

## 4. Reconcile tab navigation with the most recent selection

**Observed failure.** Chromium displayed an issue page under the selected All issues tab after the issue navigation was delayed and the user switched back. The store compares with the last observed URL and keeps one pending URL without a tab owner. [Tab store](../components/app/tab-store.ts) · [Router integration](../components/app/tabs.tsx) · [History model](../lib/client/tabs.ts)

### Required behavior

- Track the selected tab, the navigation currently requested, and the committed route separately. Associate tab-driven navigation with its originating tab and history entry. Reconcile every completion against the latest intent, including a switch back to the still-visible URL. Prefer one outstanding tab-driven routing request with the latest destination queued when the router cannot identify overlapping completions reliably.
- Apply a redirect only to the tab and history entry that requested it, provided that entry still exists and has the same intent. A stale completion must never replace the selected tab's history, title, or scroll. If it reaches the renderer, reconcile to the selected destination. Tie scroll restoration to the committed destination and cancel it when that destination is superseded.
- Preserve the current history rules for normal navigation, query edits, panel open and close, Back and Forward. A normal user navigation during a switch, such as clicking a sidebar link, must have explicit precedence as the latest action. Route observation alone cannot treat every URL mismatch as a redirect.

### Acceptance

- In a store test, dispatch A → B → A before B commits. Late B never alters either tab's history and the displayed route settles on A. Cover A → B → C, repeated URLs across tabs, close during navigation, and a redirect on a superseded request.
- In Playwright, hold the issue response while switching back to All issues. Release it and wait for the routing work to settle. Assert the URL and content agree with the selected tab, and that the issue tab still opens its own page. Cover a sidebar click during a delayed switch and preserve the existing keyboard and panel history tests.

## 5. Persist large tab sessions and save on desktop quit

**Observed failure.** Chromium rejected a roughly 73 KB session with `keepalive` and accepted the same payload with a regular request. The current saver uses `keepalive` for every save and ignores failures. On desktop quit, the main process also stops the server before the window goes away, so a `pagehide` request alone cannot provide a reliable final save. [Tab persistence](../components/app/tab-store.ts) · [Save endpoint](../app/api/settings/tabs/route.ts) · [Desktop quit](../desktop/main.ts)

### Required behavior

- Use regular requests for debounced desktop saves. Keep one save in flight with a coalesced latest snapshot. Acknowledge only successful HTTP responses. A failure leaves the latest snapshot eligible for retry. A late request must never overwrite a newer saved session.
- Treat normal desktop window close and app quit as explicit flush points. Start the flush while the renderer and server can still communicate, and wait for a bounded acknowledgment before continuing normal shutdown. Preserve the last acknowledged session if the renderer or server cannot finish. If a best-effort `pagehide` fallback is retained, enforce a UTF-8 byte budget and ensure it cannot arrive after and replace a newer snapshot. A forced termination can recover only the last acknowledged save.
- Keep `ui.tabs`, the existing saved format, and the existing tab and history limits. Large valid sessions must persist through the normal save and graceful shutdown paths without trimming valid entries to fit an unload budget. Keep desktop-only persistence and current restore behavior.

### Acceptance

- In Chromium, save a valid multibyte session above 64 KiB and assert the save endpoint receives the full payload. On relaunch, verify the active tab and retained Back and Forward history. Simulate a failed save and a newer change while a prior save is in flight, then verify that the latest successful snapshot wins.
- In Electron, change the active tab and immediately quit before the debounce expires. Relaunch and check the latest session. Also cover closing and reopening the main window, and a server that never acknowledges the flush. Closing still completes within the bounded shutdown path.

## 6. Load task filing and labels by task ID

**Observed cost.** A 12-task create batch ran 12 owner-wide placement queries and 12 owner-wide label-link queries. Single-task reads and writes also hydrate from those full sets. [Task service](../lib/tasks/service.ts) · [Task repository](../lib/tasks/repo.ts)

### Required behavior

- Add task-ID-scoped placement and label-link reads to the repository. Filter by owner and task IDs in the database. Keep the in-memory repository behavior equivalent. An empty ID list returns empty results without issuing a query.
- Use those reads to hydrate single-task responses and batch create responses, with one query per relation for the entire batch. Reuse the placement lookup for single-task filing changes. Keep task response shape, batch input order, inbox and empty-label defaults, and existing transaction behavior. When hydrating within a transaction, use its connection and the repository's existing query sequencing.

### Acceptance

- Use the existing SQL listener to compare one-task and 12-task batch creates in a database seeded with unrelated placements and labels. Hydration runs one task-scoped placement query and one task-scoped label-link query in either case. Distinguish these reads from inserts and queries that assign task positions or create labels.
- Verify single-task get, update and conflict responses use scoped lookups. Verify returned project, section, position and label values, including tasks without placements or labels and batches with different projects. Existing task API, undo and batch atomicity tests continue to pass.

## Verification before merge

Add regression coverage for each acceptance case using controllable request and query boundaries. Update [SPEC.md](SPEC.md) alongside the corresponding implementation for changes to documented behavior, and record implementation progress in [PROGRESS.md](PROGRESS.md). Follow the repository's typecheck, lint, unit and database, mock browser, desktop build, and leak-guard checks. Run the Electron close and relaunch tests against the desktop build with fictional fixtures.
