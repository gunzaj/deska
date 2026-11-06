# D6 — Remove PRs: the deletion boundary

SPEC §D6 says "delete PR sync and tables, explorer, queues, panel, store, PR links in
tasks and quick add, PR filters in project sources, PR views, PR tiles, PR risk rules,
PR lines in release notes, PR fixtures and tests. Keep shared building blocks issues
still use."

Most of that is a `rm`. This note records the five places where PR code lives inside
something issues still need, because those are the ones a reviewer would otherwise
re-derive by hand — and two of them fail silently if they are missed.

## Delete whole

| Path | What it is |
| --- | --- |
| `components/prs/**` | explorer, panel, store, queues, `bits.tsx`, `open-pr.ts` |
| `components/pages/pulls.tsx`, `app/(app)/pulls/**` | the three `/pulls` routes |
| `app/api/prs/` | the PR payload route |
| `lib/client/prs.ts`, `lib/server/prs.ts` | client types/store helpers, server reader |
| `lib/sync/prs.ts`, `lib/sync/pg/prs.ts` | PR fetch and PR page import |
| `lib/views/pr-view.ts` | the PR lens' view state |
| `tests/sync/prs.test.ts`, `tests/client/prs.test.ts` | PR fixtures and cases |

Nav, palette and keymap entries go with them: `components/app/sidebar.tsx:178-180`
and the `pulls` section at `:221`, `components/app/sidebar-customize.tsx:14`,
`components/app/palette.tsx:133-135`, and `components/app/shortcuts.tsx:82` — `G P`
leaves with the routes it jumps to.

## The five that are not a `rm`

1. **`lib/client/insights.ts` is an issue-side module.** Delete `waitingSince`,
   `waitingForReview`, `prsForIssues`, the `ReviewerWait` type and `WAIT_DAYS`.
   Keep `parseScope`, `scopeParam`, `scopeFilters`, `scopedIssues`, `insightStats`,
   `AGE_BUCKETS`. `components/pages/insights.tsx` loses its review-wait section, not
   the page: "insights passes" in the acceptance means the age and triage sections
   still render.

2. **`components/prs/bits.tsx` has two live consumers**, `components/tasks/compose.tsx:120`
   (the `#123` suggestion list) and `components/tasks/links.tsx` (link rows). Both go:
   `links.tsx` keeps issue links only, and `compose.tsx`'s suggest list loses its PR
   half. Neither may keep reading `usePrs()` — a task component importing a store that
   no longer exists is the shape that compiles green and throws at runtime.

3. **`task_links.target_kind` keeps `issue | pr` in the column comment; the data does
   not.** No column change and no FK to `pull_requests`, but the migration must
   `DELETE FROM task_links WHERE target_kind = 'pr'` and the link writer must stop
   producing `pr` rows. A surviving `pr` link renders an empty row forever, because the
   thing it names is gone.

4. **Stored PR views are unreachable, so the migration deletes them.**
   `views.definition_json->>'entity' = 'pr'` rows have no renderer once `pr-view.ts` is
   gone. D7 rewrites views anyway; leaving them means the view switcher shows a dead
   view until then.

5. **`lib/sync/reconcile.ts` and the snapshot shape carry `pullRequests`.** Touched by
   `lib/sync/reconcile.ts:25,74,88,97,132,173`, `lib/sync/read-model.ts:60,124`,
   `lib/sync/pg-batch.ts:102`, `lib/sync/live.ts:348-363`, `lib/sync/poll.ts:7,64`.
   Reconcile must still close *issues* afterwards, so this is the one edit with a real
   failure mode. The D6 acceptance test is a request-log test: a full cycle against the
   mock makes no PR-shaped call.

## Migration

`drizzle/0003_drop_prs.sql`, additive to history — `0000`–`0002` are never edited:

```
DELETE FROM task_links   WHERE target_kind = 'pr';
DELETE FROM views        WHERE definition_json->>'entity' = 'pr';
DROP TABLE pr_reviews;
DROP TABLE pr_review_requests;
DROP TABLE pr_assignees;
DROP TABLE pr_labels;
DROP TABLE pr_issue_links;
DROP TABLE gh_team_members;   -- only PR code ever wrote it
DROP TABLE pull_requests;
```

`gh_team_members` goes because `lib/sync/pg/prs.ts:159-169` is its only writer and
`lib/sync/store-postgres.ts:336` its only reader; both are deleted above.

## Acceptance as a repo test

`tests/repo/pr-removal.test.ts`, beside `tests/repo/node-ids.test.ts`: fails on any
`/pulls`, `Pull requests`, `pullRequests`, `pull_requests`, `PrStateIcon` or
`usePrs` token left in `app/`, `components/` or `lib/`. A grep-shaped test is the only
gate that keeps the removal from growing back, and it costs a second to run.

## §13 — What the screens look like after the deletion

A `rm` leaves holes, and a hole is a design decision someone makes in a diff at
2am. These are the four surfaces PR code occupies. None of them needs new UI; each
needs the existing UI to not show a gap, a dead control or an empty card.

**1. Sidebar — the section goes, the order does not shift.**

`pulls` leaves `SIDEBAR_SECTIONS` (`lib/tasks/model.ts:264`), `SECTION_LABELS`
(`sidebar-customize.tsx:14`), the `blocks` map entry (`sidebar.tsx:221`) and the
`prNav` array (`:173-177`). Nothing replaces it: Tasks → Projects → Labels is the
after-shape, and `resolveSidebar()` already drops unknown ids, so a stored layout
that names `pulls` (`{order:[...,"pulls"],hidden:[]}`) resolves to the surviving
seven sections without a migration and without a warning. Do not add a
placeholder section and do not renumber.

**2. ⌘K — three entries go, `G P` goes with them.**

`nav:prreview`, `nav:prmine`, `nav:prs` (`palette.tsx:133-135`), the
`section: "Pull requests"` result group (`:250-262`), the `searchPrs` import, the
`?pr=N` deep link (`:99` reads `PR_PARAM`, which leaves with `open-pr.ts`), and
`p: "/pulls/review"` in the `G` chord table (`shortcuts.tsx:82`). After the
deletion `G P` must fall through untouched — the chord table only consumes a
second key when `dest[k]` is a real destination, so removing the line is the whole
fix; leave `P` unbound rather than reassigning it, because `P` means pull request
to anyone who used this app and repointing it to a different screen is worse than
an inert key. The palette's empty state stays "No results" — it is not a PR-only
message.

**3. Insights — the card goes, the grid closes over it.**

`ReviewWait` (`insights.tsx:222-267`) and its `lg:col-span-2` section are one card
in a `grid gap-4 lg:grid-cols-2`. Delete the card and the component, not the page:
age, triage, flow, by-dimension, by-priority, by-type, by-assignee and by-label
all stay, and the two-column grid re-flows with no empty cell because every card
is a single grid child. The `days` URL param and `parseWaitDays`/`WAIT_DAYS`
(`lib/client/insights.ts:85-91`) existed only for this card, so they go too —
`/insights?days=10` then lands on the plain page, which is the same degradation
`?scope=` already has (`missingView` note at `:322`). **`tests/e2e/insights.spec.ts:31`
("the N-days picker is in the URL") is deleted with the card**, not rewritten: it
asserts a control that no longer exists, and it is the flake in issue #6's sample,
so its disappearance should not be read as a regression.

**4. Task links and quick add — no empty row, no dead suggestion.**

`links.tsx` keeps `IssueLinkChip` and loses `PrLinkChip`; the `LinkChip`
dispatcher becomes the issue chip outright rather than a ternary with one branch.
The migration deletes stored `pr` links, so no row renders against a target that
is gone — that is the whole reason for the `DELETE`. `compose.tsx`'s suggest list
keeps `issueHits` and drops `prHits`, so typing `#12` offers issue 12 or nothing;
the `#123` chip it inserts is built from `byNumber` only
(`compose.tsx:200` loses its `prByNumber` lookup). `TaskLink.kind` narrows to
`"issue"` in `lib/tasks/model.ts:26` — the column keeps its `issue | pr` comment
per item 3, the type does not.

**What does not change:** the row, the side panel, the board, the list, saved
views and the triage queues. D6 removes a source of rows, not a row.
