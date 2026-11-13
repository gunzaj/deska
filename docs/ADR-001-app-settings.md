# ADR-001 — Theme and density live in `app_settings`, not the browser

- **Status:** accepted (Architect), 2026-11-07. Theme implemented 2026-11-13 (`ui.theme`, `/api/settings/theme`, server-rendered `data-theme`, no pre-paint script). Density waits for UI-pass PR2: the app has no density setting yet.
- **Applies to:** PR2 of the UI pass (`docs/UI-PASS.md` §3), and anything else that
  wants a per-machine preference.
- **Supersedes:** the pre-pivot ruling that density goes in a cookie read in
  `app/layout.tsx`. That ruling was correct for a server on a fixed URL and is
  wrong for a desktop app.

## Context

Deska is a standalone macOS app. `desktop/main.ts` binds the Next server to a
free port on every launch (`s.listen(0, "127.0.0.1", …)` at `desktop/main.ts:53`),
so the app's origin is `http://127.0.0.1:<something new>` each time it starts.
Everything the browser scopes to an origin — `localStorage`, the cookie jar,
IndexedDB — is therefore empty on the next launch.

Both preferences the UI pass needs are per-machine and long-lived:

- **theme**: `system | light | dark`, where `system` is the attribute being absent
  and `@media (prefers-color-scheme: dark)` in `app/styles/tokens.css:54` resolves it;
- **density**: `compact | comfortable`, which decides row heights, and therefore
  also the numbers the list virtualizers do their scroll math with.

Today theme is kept in `localStorage` (`components/app/use-theme.ts:7`) and applied
before paint by an inline script in the root layout (`app/layout.tsx:18`). That
script exists precisely because the server cannot know the stored value. On the
desktop app the value it reads is gone after every relaunch, so the script is
reading a store that does not survive the app.

`app_settings` (`db/schema.ts:282`, `key text primary key` + `value jsonb`) is the
only store in the tree that outlives the port.

## Decision

1. **Two cosmetic keys in `app_settings`**: `ui.theme` and `ui.density`. They are
   read in the root layout on every request and rendered as attributes on the same
   element — `data-theme` and `data-density` on `<html>`. `system` is rendered as
   no `data-theme` attribute at all; the CSS media query already handles that case.

2. **`lib/density.ts` is the value source, not CSS.** It exports the numbers
   (`ROW_H = { compact: 32, comfortable: 38 }`, `GROUP_H`, and the card/padding/
   gap/control values from `docs/UI-PASS.md` §3). The root layout publishes
   `--row-h`, `--group-h`, `--density-control` … from those constants for the
   chosen density. The virtualizers in `components/explorer/layouts.tsx` (both the
   list's and the table's own `HEAD = 34` window) import the same constants.
   Constants feed CSS; CSS never feeds the scroll math — no `getComputedStyle`
   round-trip, so no list renders its first frame at the wrong height.

3. **Cosmetic writes never bump `settingsVersion()`.** `lib/settings.ts:73`
   currently means "the data payload changed": it is a component of the `/api/data`
   ETag (`lib/server/data.ts:47`) and the key `lib/connection.ts:77` uses to
   re-check the connection after a remap. A theme toggle that bumps it would bust
   the data cache and trigger a pointless connection re-check on every click.
   So cosmetics get their own pair of functions, `loadCosmetic()` / `setCosmetic()`,
   which write the row and the cache but leave `c.version` (`lib/settings.ts:69`)
   alone.

4. **The `KEYS` filter is widened, not bypassed.** `load()` reads
   `inArray(appSettings.key, Object.values(KEYS))` (`lib/settings.ts:44`), so a key
   that is not in `KEYS` is invisible no matter what is in the table. The cosmetic
   keys go into that read list — and only that list; the version bump stays on the
   data keys' path.

5. **`app/layout.tsx` reads both keys and stops emitting the pre-paint script.**
   The nonce read at `app/layout.tsx:23` already makes every page render per
   request, so the server value is available with no extra machinery. With theme
   server-rendered there is nothing to flash and nothing to apply before paint;
   `THEME_SCRIPT` and its nonce go away.

6. **One client store for both cosmetics.** `theme` and `density` are one state,
   because they are written by the same control surface and read by the same
   components. `components/app/use-theme.ts` is rewritten against that store and
   stops touching `localStorage`; `UserMenu` and Settings → Appearance both read
   the store rather than holding copies. Two controls with their own copy of the
   theme is the same bug class as `loaded`/`error`/`found`.

7. **Writes are optimistic.** The control updates local state immediately and
   persists in the background; the layout's re-render on the next navigation is the
   correction. A server round trip before the attribute changes makes the control
   feel broken on a local database.

8. **Failures are quiet and safe.** Any read error yields `comfortable` / `system`;
   any write error is swallowed after the optimistic update. A cosmetic preference
   is never worth an error state or a blocked page.

## Consequences

- Theme now survives a relaunch, which it did not before. That is the user-visible
  point of the ADR and the one claim only the Electron smoke can prove: the mocks
  Playwright project cannot simulate a random port.
- Every page already renders per request, so this adds one indexed primary-key read
  to a request that was already doing several. No cache to invalidate, no header to
  thread.
- The `/api/data` ETag keeps exactly one meaning. Anything that wants a
  browser-visible change without a data refetch has a worked example now.
- `--row-h` and friends exist on `<html>` from the first byte, so the density
  switch is correct on first frame with no script and no layout jump.
- PR2 deletes the `, 44px` fallback in the skeleton row: after it, the row height
  comes from `lib/density.ts` through `--row-h` and there is no second number.

## Rejected

- **A cookie** (the pre-pivot ruling): correct on a fixed origin, empty on every
  relaunch of the desktop app. It cannot work here, and it also cannot hold
  `system`, which the server cannot resolve anyway.
- **`localStorage` + pre-paint script**: the current mechanism, and it loses the
  value on relaunch. It also forces a nonce-carrying inline script and a
  `suppressHydrationWarning` on `<head>`.
- **Bumping `settingsVersion()` on cosmetic writes**: cheapest to write, most
  expensive to live with — every theme toggle refetches the whole data payload and
  re-checks the GitHub connection.
- **A new `preferences` table**: a migration and a second settings path for two
  string values. `app_settings` is exactly this shape already.
- **Reading density in CSS only** (a `@media` or a class): the virtualizers need
  the number in JS to compute scroll offsets, and CSS cannot tell them.
