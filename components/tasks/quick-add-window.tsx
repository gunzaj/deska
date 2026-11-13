"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { localTime, localToday } from "@/lib/tasks/dates";
import type { Prefs, TaskLabel, TaskProject, TaskSection } from "@/lib/tasks/model";
import { ComposeForm } from "./compose";
import type { CreateInput } from "./store";
import { TASKS_CHANGED } from "./store";

function browserTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Main clamps the window to 160–480 px of content height. */
const MAX_HEIGHT = 480;

const close = () => void window.deska?.quickAdd?.close();

/**
 * The floating quick-add window (SPEC §4.6): the same form as the in-app quick
 * add (the sidebar's +), pickers included, so a property can be typed or set
 * with the mouse. Enter saves and closes, Esc closes. It has no issue data, so
 * `#1234` stays text and there is no "Link issue" button.
 */
export function QuickAddWindow() {
  const [projects, setProjects] = useState<TaskProject[]>([]);
  const [labels, setLabels] = useState<TaskLabel[]>([]);
  const [sections, setSections] = useState<TaskSection[]>([]);
  const [tz, setTz] = useState(browserTz);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      const [t, p] = await Promise.all([
        fetch("/api/tasks", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null), () => null),
        fetch("/api/me/prefs", { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<Prefs>) : null), () => null),
      ]);
      if (t) {
        setProjects((t.projects as TaskProject[]).filter((x) => !x.archived));
        setLabels((t.labels as TaskLabel[] | undefined) ?? []);
        setSections((t.sections as TaskSection[] | undefined) ?? []);
      }
      if (p?.tz) setTz(p.tz);
    })();
  }, []);

  // Esc closes, wherever the focus is (an open picker or suggestion list takes it first).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The window is as tall as the form, plus the open suggestion list. An open
  // picker (a popover in a portal) gets the full height: the popover re-places
  // itself on the window's resize, below its button.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    let last = 0;
    const fit = () => {
      const picker = [...document.body.children].some((c) => c.getAttribute("role") === "dialog");
      let h = el.offsetHeight;
      for (const list of el.querySelectorAll<HTMLElement>('[role="listbox"]')) h = Math.max(h, list.getBoundingClientRect().bottom + 8);
      const want = Math.ceil(picker ? MAX_HEIGHT : h);
      if (want === last) return;
      last = want;
      void window.deska?.quickAdd?.resize?.(want);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    const mo = new MutationObserver(fit);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  const create = async (input: CreateInput): Promise<{ id: string } | null> => {
    setState("saving");
    setError(null);
    const res = await fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }).catch(() => null);
    if (res?.ok) {
      const body = (await res.json().catch(() => null)) as { task?: { id: string } } | null;
      setState("saved");
      try {
        const ch = new BroadcastChannel(TASKS_CHANGED);
        ch.postMessage("created");
        ch.close();
      } catch {
        // No channel: the main window finds the task on its next refresh.
      }
      return { id: body?.task?.id ?? "" };
    }
    setState("idle");
    setError(
      !res
        ? "Could not reach Deska."
        : res.status === 401
          ? "Connect GitHub in Deska first."
          : ((await res.json().catch(() => null))?.error ?? `Could not save (HTTP ${res.status}).`),
    );
    return null;
  };

  const at = new Date();
  return (
    <main className="h-screen overflow-hidden bg-popover" data-quick-add data-state={state}>
      <div ref={box}>
        <ComposeForm
          projects={projects}
          labels={labels}
          sections={sections}
          clock={{ today: localToday(at, tz), now: localTime(at, tz), tz }}
          onCreate={create}
          onCancel={close}
          onCreated={close}
          error={error}
        />
      </div>
    </main>
  );
}
