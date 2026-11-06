"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 767.98px)";

/** True below Tailwind's md breakpoint. Server and first paint say false. */
export function useNarrow(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(QUERY);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
