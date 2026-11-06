# Deska UI pass — tokens, density and row/card specs

Status: **proposal for review**. Owner: Designer. Implementers: Backend Engineer (PR1, shipped) and whoever takes PR2/PR3 — one PR per milestone (§11).
Scope: how Deska looks and feels, screen by screen. No product requirements here — where a screen's behaviour is unclear, it follows `docs/SPEC.md`.

**This document now lives in `gunzaj/deska` (the standalone macOS app) and is measured on that tree, at `6b37d17`.** It was written in `gunzaj/deska-old` and ported here; the port is not a copy, because three things moved underneath it: the token file already exists (PR #8), theme and density both live in `app_settings` (§3), and the predecessor's avatar contrast fix came across while its size rule did not (§6.1).

Every number below was measured on the demo dataset (dev server, Chromium), 1440×900 and 390×844, light and dark. "Measured" means read off the running app, not estimated. Where a number is a choice rather than a measurement, it says **choice**.

---

## 0. What is actually wrong today

Measured on the pivot tree at `6b37d17`, across `/issues`, `/tasks`, `/triage`, `/board`, `/releases`, `/epics`, `/insights`:

| Symptom | Evidence | Cost of ignoring it |
|---|---|---|
| **16 type sizes** — 9, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 15, 18, 20, 22, 24, 28 px — in **401 `text-[Npx]` occurrences across 62 files** (125 at 12.5, 89 at 12, 54 at 11.5) | `grep -rno 'text-\[[0-9.]*px\]' components app` | Every new component picks its own step; nothing reads as a scale, and the density switch has nothing to move |
| **Four row rhythms for one concept**: issue row 38, PR row 44, task row 44, epic row 56; board cards 89–156 | `layouts.tsx:12` `ROW_H = 38`, `GROUP_H = 36`, `HEAD = 34`, `SEL = 32`; `h-11`/`h-14` in `task-row.tsx:114`, `prs/explorer.tsx:180`, `epics.tsx:19` | A 2,300-row list is where rhythm is felt; four heights read as four products |
| **Assignee initials render at 8 px** (`fontSize: max(8, size * 0.42)`), 24 avatar call sites, 12 of them at 16 px and 5 below it | `props.tsx:104` | Contrast is fixed (§6.1), legibility is not: the one avatar on every row is the smallest text on the screen |
| **Seven radii plus one-offs** — `md` 109, `full` 50, `xl` 25, `lg` 25, `2xl` 4, `sm` 2, plus four arbitrary `rounded-[Npx]` and hard-coded 4/6/8 px in `globals.css` | class inventory per route | Edges stop reading as a hierarchy |
| **Motion on 16 elements, no duration/easing tokens** — 11 `transition-colors`, 4 `transition-opacity`, 1 `transition-transform` | `transition-*` inventory; the only durations are 120/160ms literals in `globals.css:270` | Half the app feels alive, half feels dead, at the same click |
| **Real content below 11 px** — 9 × `text-[10.5px]`, 1 × `text-[10px]`, 1 × `text-[9px]` for badges, counts, pills | class inventory | They are read, so they are body text; body text is never 9 px |

Two of these are bugs, not taste: the avatar size rule (§6.1) and the narrow layout (§8). QA tracks them in [#6](https://github.com/gunzaj/deska/issues/6) and [#7](https://github.com/gunzaj/deska/issues/7).

---

## 1. Decisions locked before this document

Recorded here so the spec and the ADR cannot drift:

1. **One token owner file**: `app/styles/tokens.css`, `@import`ed at the top of `app/globals.css`, carrying the `:root`, `@media (prefers-color-scheme: dark)`, `[data-theme="dark"]` and `@theme inline` blocks with their Suite provenance comments. Components hold zero raw px/hex for type, radius, spacing, duration or colour. **Shipped in PR #8** (`fd529bd`): same 171 properties, same `@theme inline`, five inert `--text-d*` steps added.
2. **Density is a context, not a prop**: `data-density="compact|comfortable"` on `<html>`, beside `data-theme`, read by CSS only.
3. **Both cosmetic preferences live in `app_settings`, read server-side in the root layout.** Not localStorage, not a cookie — see §3, which is where the pivot changes the answer the predecessor gave.
4. **Three PRs, in this order**: (a) scale additions, null visual diff — **shipped as #8**; (b) density and theme from `app_settings`; (c) raw px/hex sweep. This document is written against all three.

---

## 2. Type scale

Five steps. Every piece of text in the app is one of them. No exceptions, including badges and pills.

| Token | Size / line-height | Weight | Used for | Replaces |
|---|---|---|---|---|
| `text-d2xs` | 11 / 16 | 500 | Metadata that is *not read*, only scanned: relative times, counts, option positions, `⌘K` hint, avatar fallback initials | 8, 9, 10.5 px (all of it) |
| `text-dxs` | 12 / 16 | 400–500 | Pills, chips, field values in rows, table headers, board column headers, sidebar section headers | 11.5, 12 |
| `text-dsm` | 13 / 20 | 400–600 | **Body**: row titles, task titles, field values in the panel, buttons, menu items | 12.5, 13 |
| `text-dmd` | 15 / 22 | 600 | Panel and page section titles, the issue title in the side panel | 13.5, 14, 15 |
| `text-dlg` | 20 / 28 | 600 | Page title (`h1`), the big number on Insights | 18, 20, 22, 24, 28 |

**The `d` prefix is not decoration.** Tailwind's built-ins (`text-xs` 12, `text-sm` 14, `text-lg` 18) are still live in this app because zero components use them — every size is a raw `text-[Npx]`. Redefining `--text-sm: 13px` in `@theme` would silently retune every 14 px site on the way to a “null diff” PR. The `d` namespace never collides, PR #8 shipped the five steps **inert** (theme entries exist, nothing consumes them), and the sweep is what makes them live.

Rules:
- **Nothing below 11 px.** A value that "needs" 9 px needs a shorter label or a wider slot instead.
- **Body text is 13 px, never 12.5.** 12.5 was the most-used size in the app (92 uses) and is not a step.
- **Numbers are tabular** in every column that can change (`tabular-nums`): counts, dates, priorities, sort positions. Already true in most places; make it a rule.
- **Weights are three**: 400 body, 500 emphasis inside a row (titles, selected values), 600 headers and buttons. No 700.
- The base `body` keeps `font-size: 13px; line-height: 1.45; letter-spacing: -0.04px` — that last one is Suite's and it stays.

Migration map for the sweep (mechanical, one commit): `8 / 9 / 9.24 / 10 / 10.5 → text-d2xs`, `11 / 11.5 / 12 → text-dxs`, `12.5 / 13 → text-dsm`, `13.5 / 14 / 15 → text-dmd`, `18 / 20 / 22 / 24 / 28 → text-dlg`. Where a value's *job* differs from its size (a 15 px card title, a 14 px panel title), pick the step by job, not by arithmetic.

**Line-height belongs to the step.** Ten `leading-*` utilities survive in components, so 11 / 12.5 / 13 px each render at more than one line-height. The sweep removes `leading-*` from components and lets the step carry it; a size change without its line-height reflows every list silently. **There is no `type-scale.spec.ts` on this tree** — it lived in `deska-old` and did not come across, so PR3's gate has to be written with the sweep, not inherited.

---

## 3. Density and theme: two cosmetic keys, one store

`data-density="compact|comfortable"` on `<html>`, beside `data-theme`, default **comfortable**. Read by CSS only. The theme's three values are `system | light | dark`; `system` is the attribute being **absent**.

**Where they are stored — decision, and it changed after the pivot.** Both are cosmetic keys in the `app_settings` table, read in the root layout on every request. Not localStorage, not a cookie. The desktop app opens on `http://127.0.0.1:<fresh port>` every launch (`desktop/main.ts:97`, port from `freePort()` at `:270`), so localStorage and a cookie jar are both scoped to an origin that does not exist on the next launch: theme was silently lost on every relaunch, and density would have been lost with it. `app_settings` is the only store that outlives the port.

**The theme needs no pre-paint script.** `globals.css:56` is `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }`, so a server-rendered attribute is enough: emit `data-theme="dark"`, `data-theme="light"`, or nothing, and the media query resolves `system`. That means `THEME_SCRIPT` (`app/layout.tsx:18`), its `<script nonce>` and the nonce read all go away in PR2, and the first frame is correct on every surface — not just the CSS-only ones. The `headers()` call at `app/layout.tsx:23` is only evidence that the layout already renders per request; it is not a reason to use a cookie.

**One owner for the state.** A single client cosmetics store (`theme` + `density` together) is the source of truth for the *current* state; `app_settings` is the source of truth for the *stored value*; Settings → Appearance is the source of truth for the *control*. `UserMenu` and Settings both read the store — two controls holding their own copies is the same bug class as `loaded`/`error`/`found`. `use-theme.ts` is rewritten against the store and stops touching localStorage.

**Writes are optimistic, and say so when they fail.** A theme tap paints immediately from local state, then writes; on a failed write it reverts and shows a toast. Without this, every theme tap feels broken for a round trip — a visible regression from today's synchronous localStorage. The observable: with a 500 on the settings route, tapping the theme changes `data-theme` and then changes it back with a toast. No timing assertion needed.

**Server-side contract** (`lib/settings.ts`): `loadCosmetic()`/`setCosmetic()` over their own key set, so `settingsVersion()` stays exactly "something in the data payload changed" and a theme toggle can never invalidate `/api/data`. `loadCosmetic()` falls back to `comfortable`/`system` on **any** read failure — a DB error must not 500 every page, error screens included. `setCosmetic()` writes the in-memory map too, or the next render in the same process reads the stale value and the toggle appears dead until relaunch.

**Where the switch lives:** the sidebar user menu, Settings → Appearance, and ⌘K ("Density: compact / comfortable"). Not in a page header, never in a URL or a saved view — it is a per-machine preference, and a second install starts comfortable/system.

**Observables** (QA owns the assertions): a theme toggle does not refetch `/api/data`; density set through the API shows the right `--row-h` in the **first frame**, no reload; theme survives a relaunch — **desktop smoke test only**, the mocks project cannot simulate a random port, so it is not covered there.

| Token | compact | comfortable | Comfortable is for |
|---|---|---|---|
| `--row-h` | 32px | **38px** | issue, PR and task rows |
| `--row-h-roomy` | 40px | **46px** | epic rows, anything with a second line |
| `--card-h-min` | 76px | **88px** | board cards |
| `--group-h` | 30px | **36px** | group headers |
| `--pad-row-x` | 12px | **16px** | row horizontal padding |
| `--gap-row` | 8px | **10px** | gap between cells in a row |
| `--density-control` | 24px | **28px** | the height of a row-level control (checkbox, icon button) |

Every one of these lives in `lib/density.ts` as the single source and is published as a custom property on the shell element by the root layout, from the same constants. The table and that file carry the same numbers, not two copies that happen to agree.

Rules:
- **Comfortable is the default.** Compact is for people who scan rather than read; it is not "the design, smaller".
- **One source for row height: `lib/density.ts`.** It exports the numbers (`ROW_H = { compact: 32, comfortable: 38 }`, `GROUP_H = { compact: 30, comfortable: 36 }`, plus the card, padding, gap and control values from the table above). Consumers, all of which need the same number: `layouts.tsx` for the list's scroll offsets and visible window, the **table** layout for its own virtualizer (`HEAD = 34` and the row window), and the root layout, which sets `--row-h`, `--group-h` and the rest from those same values for the chosen density. Constants feed CSS, not the other way round — no `getComputedStyle` round-trip on mount, so no list renders its first frame at the wrong height. CSS never decides a number the scroll math also needs.
- **`ROW_BOX` stays the row's geometry until PR2.** The row and its loading skeleton share one box string, so the list cannot jump when data lands; PR2 swaps that geometry for `--row-h` with both callers still reading it from the same place.
- **Density never changes type size.** Compact removes space, not legibility.
- **Only three surfaces honour density**: issue/PR lists and tables, task lists, board cards. The issue panel, ⌘K, menus and dialogs are always comfortable.
- **The switch lives** in the sidebar user menu and in ⌘K as "Density: compact / comfortable" — not in a page header.

---

## 4. Radius

Four values, one rule each.

| Token | Value | Where |
|---|---|---|
| `rounded-sm` | 4px | pills, chips, badges, checkboxes, kbd, avatars' ring, tiny controls |
| `rounded-md` | 6px | buttons, inputs, row-level icon buttons, sidebar items, menu items |
| `rounded-lg` | 10px | cards (board card, task card, chart card), panels inside a page |
| `rounded-xl` | 14px | the app surface frame, modals, the ⌘K dialog, the bulk-edit bar |

Remove: `8px` and `12px` as distinct steps (map 8 → `lg`, 12 → `xl`), and every corner-specific value (`0 6px 6px 0`) — a segmented control gets `rounded-md` on the group and no radius on the inner buttons.

**Choice:** a *flatter* app beats a rounder one at this density. 6 px on buttons and 10 px on cards is the whole language; anything larger starts to read as a consumer app.

---

## 5. Motion

Three durations, two easings, as tokens. Nothing animates without one.

| Token | Value | Where |
|---|---|---|
| `--dur-1` | 100ms | colour, background, opacity on hover/press |
| `--dur-2` | 160ms | popovers, menus, tooltips, panel slide-in, row insert/remove |
| `--dur-3` | 240ms | full-screen overlays, the bulk-edit bar, layout reflow |
| `--ease-out` | `cubic-bezier(0.2, 0, 0, 1)` | everything entering |
| `--ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | things that move within the screen (drag, reorder) |

Rules:
- Under `prefers-reduced-motion: reduce`, `--dur-1..3` collapse to `0ms` **at the token layer** in `tokens.css`; components never test the media query themselves. The existing global `transition: none !important` rule stays as a belt.
- **Every interactive element has a hover state and a focus-visible ring.** Today 48 files have a `hover:` class and only **4** `focus-visible:` uses in the whole tree. The list is the audit: sidebar items, row icon buttons, filter chips, column headers, board cards, the view menu, bulk-edit controls, the palette rows. This is the largest single gap in the pass and it is cheap: one global `:focus-visible` ring plus per-component hover where it is missing.
- **Hover never moves a row.** Only colour changes; a row that shifts under the pointer makes j/k feel broken. Drag and reorder are the only motion inside a list.
- **Focus ring is one ring**: `2px solid var(--focus)`, `outline-offset: 1px`, radius `sm`. No `ring-2` + `ring-inset` variants; that is a second focus language.

---

## 6. Colour: the two failures

### 6.1 Assignee initials (bug — QA owns the fix, spec here)

Today (before #75): `hashColor(login)` = `hsl(h 45% 48%)` with white 8 px text. Worst hue is 2.27:1 — below AA at any size, and unreadable at 8 px.

**Shipped in #75, and better than what I proposed.** My flat `hsl(h 65% 28%)` would have passed at 4.80:1 but darkened every avatar including the blues and purples that were already fine. What shipped instead keeps saturation at 55% and darkens **each hue only as far as it must**, capped at the old 48% lightness, aiming at a 4.6:1 floor — so a user's colour is still recognisably their colour, and only the yellow-greens (the ones that were failing) get darker. `tests/client/colors.test.ts` asserts ≥ 4.5:1 for every login and is the gate. Adopt this as the spec: the rule is *a per-hue floor, not a single fill*.

**On the pivot tree the fill came across differently, and it passes.** `lib/client/colors.ts:32` is a flat `hsl(${h} 45% 32%)` with white text, not the per-hue floor. Measured across all 360 hues: **worst 4.77:1 at hue 60, zero hues below 4.5** — so `colors.test.ts` is green here and the contrast half needs no work. Keep the flat fill on this tree; if anyone later raises saturation to 55% at the same lightness it drops to 4.29:1 with 15 hues failing, so the test is the thing that stops that edit, not a comment.

Rules that come with it:
- **Initials are one or two letters, always uppercase**, at `max(11, size * 0.44)`; below 11 px never. **Still open** — `props.tsx:104` still renders `fontSize: max(8, size * 0.42)`, so a 16 px avatar draws 8 px letters. Contrast shipped, size did not.
- **Two initials do not fit in 16 px, so size picks the letter count, not just the type size.** Counted the call sites on the pivot: 16 px ×12, 22 px ×4, 18 px ×3 (the `AvatarStack`), 20 px ×2, 15 px ×1, 26 px ×1, plus one passed through from `AvatarStack`'s `size` prop. Two semibold uppercase letters at 11 px run ~14.4 px wide inside a 16 px circle — they touch the rim and clip on the curve. So:
  - **< 16 px → dot** in the same hue, no letters (the 15 px site).
  - **16–19 px → one initial** at 11 px (the 12 sites at 16, the 3 at 18).
  - **≥ 20 px → two initials** at `max(11, size * 0.44)` (20, 22, 26 px sites).
- **Every avatar has a `title` with the full login** — already true, keep it.
- **In a 16 px avatar the initials are a mark, not text.** At sizes below 16 px, drop the letters and show a solid dot in the same hue; at 16 and above show initials. This is the trade that makes the row calm: a list of two-letter blobs is noise, and the colour already identifies the person. Not yet implemented; it is the second half of the avatar work, and it is the one place where §2's "nothing below 11 px" is satisfied by removing the text rather than growing it.
- **Contrast is checked at both themes.** White on the fill gives ≥ 4.77:1 on this tree in either theme; on the dark surface the ring (`ring-2 ring-surface`) separates the avatar from the background, so no separate dark value is needed.

### 6.2 Other colour rules

- **Option colours** (`lib/client/colors.ts`) are already a fixed palette with GitHub's enum; they are not theme-dependent and stay. They are used for dots, rings and bars, never for text.
- **Status/priority icons carry meaning by shape**, not only colour (ring fill, bar count) — keep it; it is the app's best idea.
- **Closed issues keep a muted title**, not a muted row: the title stays `text-fg` at 400 weight with a `text-muted` `#number`. A whole grey row is what makes a big list feel dead.

---

## 7. Row spec (issues, PRs, tasks, epics)

One row component shape, four heights from §3. The measured current state is on the left.

| Property | Today | Spec |
|---|---|---|
| Height | 38 (issue) / 44 (PR, task) / 56 (epic) | `--row-h` for issue/PR/task, `--row-h-roomy` for epic |
| Horizontal padding | 16px | `--pad-row-x` |
| Cell gap | 10px | `--gap-row` |
| Title | 13 px, 500, truncate | `text-dsm` 500, truncate, `min-w-0 flex-1` |
| Muted closed title | `text-muted` on the whole title | `text-fg` + a leading closed status icon; `text-muted` only for the `#number` |
| Divider | `border-b border-line-soft` | keep; **no divider on the last row of a group** |
| Focused row | `bg-hover` + 2 px brand bar at the left | keep both; the bar is the state, the fill is the hint |
| Selected row | `bg-brand-soft` | keep, plus a 1 px `brand-border` inset ring so selection survives on a selected *and* focused row |
| Hover | nothing | `bg-hover` at `--dur-1`, no layout shift, no shadow |
| Press | nothing | `bg-active` |
| Focus-visible | `ring-2 ring-inset ring-focus` | `outline: 2px var(--focus)`, offset −2 px (inside the row) |
| Checkbox | `size-3.5`, 40% opacity until hover | `size-4`, visible at 100% on hover/focus and on a selected row, `rounded-sm`, 24 px hit area via padding |
| Overflow | title truncates | title truncates; `#number`, status, priority and assignee never truncate; everything between them is hidden by breakpoint, in this order at 390: labels → team/platform/type/milestone → release → created → sub-issues |

States every row needs and does not have today:

- **Loading**: a row-shaped skeleton at `--row-h`, 3 lines of shimmer on **`--skeleton`** (its own token beside the surface tokens — not `--active`, which means hover/selection and would drift under the shimmer), never a spinner and never a "Loading…" string. The container carries `data-loading aria-busy="true" role="status" aria-label="Loading"` so a test asserts the state instead of racing a cold compile. **Loading, error and empty are three different renders**, and a store that cannot tell them apart is the bug: no store may set `loaded = true` on a `!res.ok` response.
- **Empty group**: group header keeps its count `0` and a 24 px hint line "No issues in this group" in `text-muted` — never collapse the group away, or the board/flow loses its shape.
- **Empty list**: the existing `EmptyHint` with a primary action. Today it has no action; add one: "Clear filters" when filters are on, "Show closed issues" when the list is open-only, otherwise nothing.
- **Refreshing**: the data stays, a 2 px brand progress line under the toolbar (not a spinner over the list). A full-page skeleton on every poll is what makes a fast app feel slow.
- **Error**: one banner at the top of the list area, `banner-warning`, with "Couldn't refresh" + "Retry"; rows stay.
- **Session expired**: blocking, as today (`banner-warning`), unchanged.

---

## 8. Narrow layout (390 px) — includes the `/issues` bug

Measured at 390×844 on the pivot tree at `6b37d17`:

- `document.scrollWidth` equals `innerWidth` on every route, so **there is no page-level horizontal scrollbar**. An earlier "26 elements past the right edge" reading was *clipped* overflow inside `overflow: hidden` ancestors, not a broken page. The finding was real, its description was not; the actual failures are below.
- **`/tasks`: the complete control is 18×18 px.** `components/tasks/bits.tsx:53` is `size-[18px]` on the button itself, so the button *is* the target. A real touch failure — below the 24 px minimum in WCAG 2.2 (2.5.8). Fix: keep the 18 px visual circle and give it a 24×24 hit area (a padded button or a `::before` overlay), so the row's rhythm does not change. The assertion targets the **hit area**, not the visible box.
- **`/issues` at 390: the title cell is 154 px.** It passes today **by luck, and nothing asserts it** — measured chrome on a 390 row is priority 14 + `#number` 60 + status 14 + sub-issues 43 + assignee 18 + time 48 = 197 px. One more chip, one longer number, and the title loses the room. Fix: at `< md`, hide priority and sub-issues, cap `#number` at five digits (`tabular-nums`), and give the title the rest. Acceptance is **≥ 150 px**, asserted — a floor, not "it fits today".
- **`/issues` search field**: the `<input>` is **18.125 px tall** inside a 28 px `<label>` (`components/explorer/explorer.tsx:301`) — the label is the thing that looks tappable and the input is the thing that isn't. Fix: input `--density-control` 32 px on narrow (its label grows with it), full-width, with a 24 px clear button. The assertion targets the **input**, not the wrapper.
- **`/board` overflows horizontally by design** — 17.5 rem columns in a horizontal scroller. That stays, but it needs an affordance: a 1 px fade at the right edge while more columns exist, and column headers sticky at the top of the scroll container.
- **The drawer is the navigation at `< md`** and stays: a 264 px `role="dialog"` (`components/app/shell.tsx:132`) with focus moved in, Tab trapped, Escape closing and focus restored — that spec is green and stays the contract. Add: the header shows the current page title at `text-dmd` so the drawer is not needed to know where you are.

---

## 9. Board card spec

Measured today: card heights 89–156 px on `/board`, minimum ~89, six to nine cards per column visible at 900 px.

- **Height**: `--card-h-min` 88, no max; the card grows with labels and sub-issues. Two lines of title max, then truncate.
- **Anatomy** (top to bottom, 10 px padding): line 1 — `#number` `text-d2xs` `text-muted` + priority icon; line 2 — title `text-dsm` 500, two lines; line 3 — assignee avatar 16 px + release/team pill `text-dxs`; line 4 (only when present) — labels, one row, `+N`.
- **Hover**: `border-line-field-hover` + `shadow-raised` at `--dur-1`. No lift, no scale — a 2,300-issue board that moves under the pointer is a toy.
- **Dragging**: card rotates 1° (already), `shadow-modal`, `opacity: 0.9`, and the source column shows a 32 px dashed placeholder at the card's height so the column does not jump.
- **Drop target**: the target column gets `ring-1 ring-brand-border` and a `bg-brand-soft` header, not a full-column tint.
- **Empty column**: "No issues" `text-dxs text-muted` centred, 32 px tall, with the column's count `0` in the header. Keep the column: a missing column breaks the flow.
- **Keyboard**: `Space` picks up, arrows move between columns, `Space` drops, `Escape` cancels — already implemented; add a 1-line hint under the column header while a card is picked up ("← → move · Space drop · Esc cancel").

---

## 10. Second wave — issue panel and ⌘K (outline, full spec next)

Not specced in detail here on purpose: it depends on the settled scale above, and writing it twice is the waste the Chief called out.

**Issue panel** — what the full spec will cover: the 420 px panel width and its narrow behaviour (full-screen sheet at `< md`), the sticky header (number, title, state, GitHub link), the field grid (two columns, label 5.5 rem `text-d2xs` uppercase muted, value `text-dsm`), the description/comment thread rhythm, the "Edit on GitHub" affordance, and every state (loading skeleton, deleted/moved note, no-comments, error).

**⌘K** — what the full spec will cover: the 560 px dialog, the 44 px input, section headers (`text-d2xs` uppercase), 32 px rows, the selected row state (brand bar + `bg-hover`), empty state with the query echoed, the footer hint row, and the transition from "search" to "command" without a layout jump.

Both get before/after shots and a keyboard map in the same document before Frontend starts.

---

## 11. How this is checked

- **PR1 (scale additions) — shipped as #8.** The acceptance was a **null pixel diff**, and its evidence is the built CSS, not crops: `pnpm build && shasum .next/static/css/*.css` gives the same hash before and after the split (`dc676651d755…`, same emitted filename). Determinism was proven first — two builds of unmodified `6b37d17` hashed identically — because a shasum gate over a non-deterministic build proves nothing. Crops went in the PR body as decoration, not as the gate: they were byte-identical on two independent capture runs each, except one first-pass pair that differed and did not reproduce (compile warmth, not rendering). **The five steps shipped inert**: no component consumes them, and no built-in (`text-xs/sm/lg`) is redefined.
- **PR2 (density)**: row heights 38 → 32 and back with the scroll position preserved at the same *issue*, not the same pixel; virtualization window matches (no blank rows, no jump at the end of the list).
- **PR3 (px/hex sweep)**: `grep -rE 'text-\[[0-9.]+px\]|rounded-\[[0-9]+px\]' app components` returns nothing. It also removes `leading-*` from components and gives line-height to the step. **PR3 is not pixel-neutral and must not be reviewed as if it were**: 125 body-text sites go 12.5 → 13 px (the single largest group in the 401), which is a visible half-pixel growth on every row title, and 54 sites at 11.5 → 12 px. Every step carries size **and** line-height together, or the sweep silently reflows every list. The gate is assertions, not a screenshot diff: row heights and title truncation on `/issues`, `/tasks`, `/board` at 390 and 1440, the §8 title ≥ 150 px floor re-checked because 13 px titles wrap differently, plus one axe pass — new wrapping and new truncation is exactly where this PR will break, not colour. Before/after crops ship with it so the growth is seen rather than discovered.
- **Contrast**: `tests/client/colors.test.ts` asserts ≥ 4.5:1 for every login — green on this tree (worst 4.77:1 at hue 60). `/tasks` checkbox hit area ≥ 24×24; `/issues` at 390 px keeps `#number` and the title gets ≥ 150 px; the issue search input is ≥ 32 px tall.
- **Motion**: with `prefers-reduced-motion: reduce`, no element has a non-zero transition duration.

Screenshots: the before crops used for this document live in `deska-old` at `docs/ui-pass/before/` (`row_light`, `list_light`, `tasks_light`, `tasks_dark`, `board_light`). They are not copied here: they were captured on the predecessor tree, and PR1's crops proved the pivot renders the same CSS. After crops land with each PR that changes pixels — PR2 and PR3, not PR1.

**Still open from this document, in order**: avatar initials at 11 px and the dot-below-16 px rule (§6.1 — contrast shipped, size did not); QA's three §8 touch targets ([#7](https://github.com/gunzaj/deska/issues/7)); PR2 → PR3. Everything else here is either shipped or waiting on those.

---

## 12. Sidebar footer: the utility zone

Asked for by the owner on 2026-11-04, from a screenshot of the top row. Keyboard shortcuts (`data-help-button`) and Customize sidebar leave the header and join the footer. New issue (`+`) and the notification bell **stay in the header**: the bell carries unread state that has to be visible without opening anything, and `+` is the only action that leaves the app, so it belongs where the eye lands first.

**Layout — one row, shared with sync.** The footer keeps its `border-t` and its order: divider → **sync row** → user menu. The two icon buttons go *inside* the sync row, after the sync text and its refresh glyph:

```
┌ border-t ─────────────────────────────────┐
│ ● Synced 3m ago            ↻  ⌨  ⚙      │   h-7
│ ◯ gunzaj · Wallet              ⌄      │   h-9  (UserMenu)
└─────────────────────────────────────────┘
```

- Sync button: `flex-1 min-w-0`, `h-7`, unchanged behaviour (whole row is "Sync now").
- Keyboard: `size-6` (24 px), glyph 15, `rounded-md`, `text-faint` → `text-fg` + `bg-hover`.
- Customize: same, immediately after it, `gap-1` (4 px) between them and 6 px before the pair.
- **No second divider.** A rule between the icons and the user menu would cut the footer into three bands for four elements.

**The trade-off, named.** A separate row would have cost 28 px of height and left two mostly-empty lines at the bottom of every page. Sharing the sync line costs the sync text ~56 px of width, so the longest notices truncate earlier — "Initial import needed" (21 chars) is the only one that no longer fits at 232 px, and it shortens to **"Import needed"** with the full sentence already in its `title`. Everything else ("Synced 3m ago", "Rate limited", "Sync failed") still fits.

**Why here, not in the header.** The header is identity and primary action; the footer is where "about this app" lives, next to theme, team and sign-out. Two 28 px buttons in a 232 px header were competing with the repo name for the same attention as `+` and the bell, and the four icons read as one group of four equals when they are two different kinds of thing.

**Narrow (390 px).** The sidebar is a 264 px drawer. Same row, same order; the two buttons go to `size-8` (32 px) because this is a touch surface, while their glyphs stay 15 px — §8's hit-area rule, not a bigger icon. Tapping either **closes the drawer first**, then opens its dialog:

- Customize: dispatch `CUSTOMIZE_SIDEBAR_EVENT` and call `onNavigate()`. The dialog is rendered inside the drawer's copy of the sidebar and unmounts with it, so the button must not call `setCustomize` locally — the desktop copy (hidden, still mounted) owns the dialog and answers the event.
- Shortcuts: dispatch `HELP_EVENT` and call `onNavigate()`. `GlobalShortcuts` is app-level, so the dialog survives; closing the drawer is only to avoid a dialog over a drawer whose own Escape handler would also fire (Dialog listens on `window` capture, the drawer on `document` capture — one Escape would close both).

**States and keyboard.** Hover `bg-hover`; focus uses the global `:focus-visible` ring, not a local one; no active/pressed style, no badge, no tooltip beyond the existing `title`. Tab order inside the footer is sync → keyboard → customize → user menu, which is also reading order. Neither button gains a shortcut of its own; `?` and ⌘K's "Customize sidebar" row stay the keyboard paths, and the buttons are the pointer path to the same two actions.

**Checks.** `data-help-button` still exists and now sits after the sync button in DOM order; Shift+? and the ⌘K rows still open both dialogs; in the drawer, tapping customize leaves the drawer closed and the dialog open; nothing in the header but logo, repo, `+` and bell.

**What shipped, and the three corrections to it (2026-11-06).** The move landed in `gunzaj/deska` before this document was ported, in a third shape: the two buttons kept their **labels** and sit in their **own `h-7` row** directly above `UserMenu` (`sidebar.tsx:405-412`), not inside the sync row as the sketch above has it.

The layout half is accepted — one row, `border-t` above, no second divider, sync → shortcuts → customize → user menu — because the sync line at 232 px was already carrying a status sentence plus a glyph, and a labelled row reads faster than three unlabelled 24 px icons. What changes, all inside the same diff:

- **Both buttons are full-width halves** (`flex-1`) with a `text-[12px]` label and a 14 px glyph in `text-faint`. That makes them look like navigation, which they are not — they open a dialog. Give them `text-dxs` on the label, keep `text-faint` on the glyph, and let the row read as a footer utility line rather than a nav section.
- **`h-7` is below the §8 touch floor on the narrow drawer.** At `< md` the row goes to `h-9` with `size-8` targets (glyph 15, label `text-dsm`); at `≥ md` it stays `h-7`. Same rule as the header's `+` and bell.
- **`data-help-button` must survive the rewrite** — `palette.spec.ts` does not select the moved buttons, but `tests/e2e/keys.spec.ts` and the ⌘K row both reach the shortcuts dialog, and a silent rename breaks them without a failing assertion in the layout specs.

Everything else in this section stands, including the drawer behaviour: tapping either closes the drawer first, then dispatches the event so the desktop copy owns the dialog.
