"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { keyboardBusy } from "@/lib/client/keyboard";
import { FILTER_EVENT } from "../explorer/filter-bar";
import { ISSUE_LIST_HELP, TASK_LIST_HELP } from "@/lib/client/shortcuts";
import { Kbd } from "../props";
import { useTasks } from "../tasks/store";
import { Dialog } from "../ui/dialog";
import { HELP_EVENT, PALETTE_EVENT } from "./palette";
import { useAppData } from "./provider";

const GROUPS: { title: string; keys: [string[], string][] }[] = [
  {
    title: "General",
    keys: [
      [["⌘", "K"], "Command palette: search issues, pages, actions"],
      [["?"], "Show keyboard shortcuts"],
      [["Q"], "Quick add a task"],
      [["Esc"], "Close dialog / clear search"],
    ],
  },
  {
    title: "Navigation",
    keys: [
      [["G", "T"], "Triage"],
      [["G", "M"], "My issues"],
      [["G", "D"], "Tasks inbox"],
      [["G", "P"], "Pull requests waiting on my review"],
      [["G", "I"], "All issues"],
      [["G", "B"], "Backlog"],
      [["G", "R"], "Current release"],
      [["G", "E"], "Epics"],
      [["G", "V"], "Views"],
    ],
  },
  {
    title: "Issue lists",
    keys: ISSUE_LIST_HELP.map((h): [string[], string] => [h.keys, h.label]),
  },
  {
    title: "Triage mode",
    keys: [
      [["1", "–", "4"], "Set Priority (1 is the highest)"],
      [["T"], "First mapped dimension (e.g. a team field)"],
      [["R"], "Release"],
      [["A"], "Assign"],
      [["S"], "Skip to the next issue"],
      [["←"], "Previous issue"],
      [["Z"], "Snooze until a date"],
      [["Esc"], "Exit triage"],
    ],
  },
  {
    title: "Task lists",
    keys: TASK_LIST_HELP.map((h): [string[], string] => [h.keys, h.label]),
  },
];

/** App-wide keys: G-then-X navigation, ? for help, F for filter. */
export function GlobalShortcuts() {
  const router = useRouter();
  const { data } = useAppData();
  const { openCompose } = useTasks();
  const [help, setHelp] = useState(false);
  const pendingG = useRef<number>(0);

  useEffect(() => {
    const show = () => setHelp(true);
    window.addEventListener(HELP_EVENT, show);
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.key === "Shift" || keyboardBusy(e)) return;
      const k = e.key.toLowerCase();
      if (Date.now() - pendingG.current < 1200) {
        const cur = data.meta.currentReleaseId;
        const dest: Record<string, string | null> = {
          t: "/triage",
          e: "/epics",
          m: "/my",
          d: "/tasks",
          p: "/pulls/review",
          i: "/issues",
          b: "/backlog",
          r: cur ? `/releases/${cur}` : null,
          v: "/views",
        };
        // Only a real destination is consumed: otherwise G then an unrelated key
        // (say X) swallowed the key and the list shortcut never ran.
        if (dest[k]) {
          pendingG.current = 0;
          // The second key belongs to the chord. Without this, list shortcuts
          // saw it too: G T on a focused row opened quick add as well as Triage.
          e.preventDefault();
          e.stopPropagation();
          router.push(dest[k]!);
          return;
        }
        pendingG.current = 0;
      }
      if (k === "g") {
        pendingG.current = Date.now();
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        setHelp(true);
      } else if (k === "q") {
        e.preventDefault();
        openCompose();
      } else if (k === "f") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(FILTER_EVENT));
      }
    };
    // Capture phase, so a chord's second key is claimed before the page's own handlers see it.
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener(HELP_EVENT, show);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [router, data.meta.currentReleaseId, openCompose]);

  return (
    <Dialog open={help} onClose={() => setHelp(false)} label="Keyboard shortcuts" width={560}>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <p className="text-[14px] font-semibold">Keyboard shortcuts</p>
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent(PALETTE_EVENT))} className="text-[12px] text-faint hover:text-fg">
          Open palette
        </button>
      </div>
      <div className="grid gap-x-8 gap-y-5 p-4 sm:grid-cols-2">
        {GROUPS.map((g) => (
          <section key={g.title} className={g.title === "Issue lists" || g.title === "Task lists" || g.title === "Triage mode" ? "sm:col-span-2" : ""}>
            <h3 className="mb-1.5 text-[11.5px] font-semibold text-faint">{g.title}</h3>
            <ul className={g.title === "Issue lists" || g.title === "Task lists" || g.title === "Triage mode" ? "grid gap-x-8 sm:grid-cols-2" : ""}>
              {g.keys.map(([keys, label]) => (
                <li key={label} className="flex h-8 items-center justify-between gap-3">
                  <span className="text-muted">{label}</span>
                  <span className="flex shrink-0 gap-1">
                    {keys.map((k, i) => (
                      <Kbd key={i}>{k}</Kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
