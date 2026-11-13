"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * An explorer's filter/sort/layout state, kept in the `s` query parameter so a
 * view can be shared or reloaded as it is (v5 4.6). It starts from the URL when
 * that holds a valid state, else from `saved`, and re-syncs when `savedKey`
 * changes (navigating between views reuses the component) or the URL's `s`
 * changes without this hook having written it. The URL is written
 * with the native history API: Next's useSearchParams stays in step without a
 * server round trip per keystroke.
 *
 * `decode`, `encode` and `same` must be stable (module-level functions).
 */
export function useUrlExplorerState<S>({
  saved,
  savedKey,
  decode,
  encode,
  same,
}: {
  saved: S;
  savedKey: string;
  decode: (raw: string | null) => S | null;
  encode: (state: S) => string;
  same: (a: S, b: S) => boolean;
}): readonly [S, (next: S) => void] {
  const params = useSearchParams();
  const [state, setStateRaw] = useState<S>(() => decode(params.get("s")) ?? saved);

  const lastKey = useRef(savedKey);
  // The `s` this hook last read or wrote. A different one in the URL came from
  // a navigation to the same page (⌘K "Search all issues" on All issues, a
  // sidebar link back to the plain list): the page stays mounted, so the state
  // has to follow the URL, or the next edit writes the stale state over it.
  const lastS = useRef(params.get("s"));
  useEffect(() => {
    const s = params.get("s");
    if (lastKey.current === savedKey && lastS.current === s) return;
    lastKey.current = savedKey;
    lastS.current = s;
    setStateRaw(decode(s) ?? saved);
  }, [savedKey, saved, params, decode]);

  const setState = useCallback(
    (next: S) => {
      setStateRaw(next);
      const url = new URL(window.location.href);
      if (same(next, saved)) url.searchParams.delete("s");
      else url.searchParams.set("s", encode(next));
      lastS.current = url.searchParams.get("s");
      window.history.replaceState(null, "", url);
    },
    [saved, same, encode],
  );

  return [state, setState] as const;
}
