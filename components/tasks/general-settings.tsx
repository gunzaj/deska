"use client";

// Settings → General (improvement 14): the app-wide time zone. It used to sit
// under the notification bell; the value and its effect are unchanged.
import { useMemo } from "react";
import { timeZoneOptions } from "@/lib/tasks/dates";
import { usePrefs } from "./notifications";

export function GeneralSettings() {
  const { setPrefs, tz } = usePrefs();
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
      </div>
    </section>
  );
}
