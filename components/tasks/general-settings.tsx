"use client";

// Settings → General (improvement 14): the app-wide time zone, and the page
// Deska opens on (HOME-SPEC §3.1).
import { useMemo } from "react";
import { timeZoneOptions } from "@/lib/tasks/dates";
import type { StartPage } from "@/lib/tasks/model";
import { useTasksOnly } from "../app/tasks-only";
import { usePrefs } from "./notifications";

export function GeneralSettings() {
  const { prefs, setPrefs, tz } = usePrefs();
  const tasksOnly = useTasksOnly();
  const zones = useMemo(() => timeZoneOptions(tz), [tz]);
  return (
    <section aria-labelledby="general-h" className="space-y-3">
      <h2 id="general-h" className="text-[15px] font-semibold">
        General
      </h2>
      <div className="space-y-2 rounded-lg border border-line p-4 text-[13px]">
        <label className="flex items-center gap-3">
          <span className="min-w-0 flex-1">
            <span className="block font-medium">Time zone</span>
            <span className="block text-[12px] text-muted">Dates, reminders and relative dates use this zone.</span>
          </span>
          <select
            value={tz}
            onChange={(e) => void setPrefs({ tz: e.target.value })}
            aria-label="Time zone"
            className="h-8 w-56 rounded-md border border-line bg-surface px-2 text-[12.5px] outline-none"
          >
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-3 border-t border-line pt-2">
          <span className="min-w-0 flex-1">
            <span className="block font-medium">Start page</span>
            <span className="block text-[12px] text-muted">The page Deska opens on.</span>
          </span>
          <select
            value={prefs.startPage ?? "home"}
            onChange={(e) => void setPrefs({ startPage: e.target.value as StartPage })}
            aria-label="Start page"
            className="h-8 w-56 rounded-md border border-line bg-surface px-2 text-[12.5px] outline-none"
          >
            <option value="home">Home</option>
            {/* My issues needs GitHub: not offered in tasks-only mode. */}
            {!tasksOnly && <option value="my">My issues</option>}
            <option value="today">Today</option>
          </select>
        </label>
      </div>
    </section>
  );
}
