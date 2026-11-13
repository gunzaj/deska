"use client";

import { useCallback, useState } from "react";

export type Theme = "system" | "light" | "dark";

function applyTheme(t: Theme) {
  const el = document.documentElement;
  if (t === "system") el.removeAttribute("data-theme");
  else el.setAttribute("data-theme", t);
}

/** What the server rendered on `<html>` (ADR-001): the stored theme, or none for "system". */
function renderedTheme(): Theme {
  if (typeof document === "undefined") return "system";
  const t = document.documentElement.getAttribute("data-theme");
  return t === "light" || t === "dark" ? t : "system";
}

/**
 * The colour theme, stored in the app's settings (ADR-001): `localStorage` is
 * emptied on every launch because the window's port changes. The change shows
 * at once; the save runs in the background and a failure is ignored.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(renderedTheme);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    applyTheme(t);
    void fetch("/api/settings/theme", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ theme: t }),
    }).catch(() => {
      /* a cosmetic setting is never worth an error */
    });
  }, []);

  return { theme, setTheme };
}
