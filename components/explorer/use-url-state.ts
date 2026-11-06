"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * An explorer's filter/sort/layout state, kept in the `s` query parameter so a
 * view can be shared or reloaded as it is (v5 4.6). It starts from the URL when
 * that holds a valid state, else from `saved`, and re-syncs when `savedKey`
 * changes (navigating between views reuses the component). The URL is written
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
  useEffect(() => {
    if (lastKey.current === savedKey) return;
    lastKey.current = savedKey;
    setStateRaw(decode(params.get("s")) ?? saved);
  }, [savedKey, saved, params, decode]);

  const setState = useCallback(
    (next: S) => {
      setStateRaw(next);
      const url = new URL(window.location.href);
      if (same(next, saved)) url.searchParams.delete("s");
      else url.searchParams.set("s", encode(next));
      window.history.replaceState(null, "", url);
    },
    [saved, same, encode],
  );

  return [state, setState] as const;
}
