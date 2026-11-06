"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A search box that types into a draft; `commit` (the filter and the URL)
 * follows `delay` ms later, so a keystroke does not re-filter thousands of
 * rows. Whitespace-only input counts as empty: comparing the raw value would
 * set the same state again every `delay` ms forever (v5 4.6).
 */
export function useSearchDraft(text: string, commit: (value: string) => void, delay = 120) {
  const [draft, setDraft] = useState(text);
  useEffect(() => setDraft(text), [text]);
  const latest = useRef(commit);
  latest.current = commit;
  useEffect(() => {
    const want = draft.trim() ? draft : "";
    if (want === text) return;
    const t = setTimeout(() => latest.current(want), delay);
    return () => clearTimeout(t);
  }, [draft, text, delay]);
  return [draft, setDraft] as const;
}
