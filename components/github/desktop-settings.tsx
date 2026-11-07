"use client";

// Settings → Desktop (SPEC §4.6, D12): the quick-add shortcut, native reminder
// notifications, launch at login and the Dock badge. The settings live in the
// main process (window.deska.desktop); outside the desktop app this renders
// nothing.
import { useEffect, useState } from "react";
import type { DesktopPrefs, DesktopState } from "@/desktop/bridge";
import { acceleratorFromKey, prettyAccelerator } from "@/lib/client/accelerator";

export function DesktopSettings() {
  const [state, setState] = useState<DesktopState | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    void window.deska?.desktop?.get().then(setState, () => setState(null));
  }, []);
  if (!state) return null;

  const change = async (patch: Partial<DesktopPrefs>) => {
    setMessage(null);
    try {
      const r = await window.deska!.desktop.set(patch);
      setState(r.state);
      if (r.error) setMessage({ kind: "error", text: r.error });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "Could not save." });
    }
  };

  const { prefs } = state;
  return (
    <section aria-labelledby="desktop-h" className="space-y-3">
      <h2 id="desktop-h" className="text-[15px] font-semibold">
        Desktop
      </h2>
      <div className="space-y-3 rounded-lg border border-line p-4 text-[13px]">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-medium">Quick add shortcut</p>
            <p className="text-[12px] text-muted">Opens a small window from any app. Enter saves, Esc closes.</p>
          </div>
          <button
            type="button"
            aria-label={capturing ? "Press the new shortcut" : `Quick add shortcut: ${prettyAccelerator(prefs.shortcut)}. Change`}
            data-testid="shortcut-capture"
            onClick={() => setCapturing(true)}
            onBlur={() => setCapturing(false)}
            onKeyDown={(e) => {
              if (!capturing) return;
              e.preventDefault();
              if (e.key === "Escape") return setCapturing(false);
              const acc = acceleratorFromKey(e);
              if (!acc) return;
              setCapturing(false);
              void change({ shortcut: acc });
            }}
            className="inline-flex h-8 min-w-32 items-center justify-center rounded-md border border-line px-3 font-medium hover:bg-hover"
          >
            {capturing ? "Press keys…" : prettyAccelerator(prefs.shortcut)}
          </button>
          {prefs.shortcut && (
            <button type="button" onClick={() => void change({ shortcut: "" })} className="inline-flex h-8 items-center rounded-md px-2 text-muted hover:bg-hover">
              Off
            </button>
          )}
        </div>
        {prefs.shortcut && !state.shortcutActive && <p className="text-[12px] text-critical">This shortcut could not be registered; another app may be using it.</p>}
        <Toggle
          label="Reminder notifications"
          hint={state.notificationsSupported ? "Reminders appear as macOS notifications with Complete, Snooze 1 h and Tomorrow. If macOS blocks them, the bell in the sidebar still shows every reminder." : "Notifications are not available here. The bell in the sidebar still shows every reminder."}
          checked={prefs.notifications}
          disabled={!state.notificationsSupported}
          onChange={(v) => void change({ notifications: v })}
        />
        <Toggle label="Dock badge" hint="Shows the number of tasks overdue or due today." checked={prefs.dockBadge} onChange={(v) => void change({ dockBadge: v })} />
        <Toggle
          label="Open Deska when I log in"
          hint={state.canLaunchAtLogin ? "Starts in the background so sync and reminders keep running." : "Only available in the installed app."}
          checked={prefs.launchAtLogin}
          disabled={!state.canLaunchAtLogin}
          onChange={(v) => void change({ launchAtLogin: v })}
        />
        <p className="text-[12px] text-muted">Closing the window keeps Deska running so sync and reminders continue. Quit with ⌘Q.</p>
        {message && (
          <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-critical" : "text-muted"}>
            {message.text}
          </p>
        )}
      </div>
    </section>
  );
}

function Toggle({ label, hint, checked, disabled, onChange }: { label: string; hint: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3">
      <input type="checkbox" className="mt-0.5" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{label}</span>
        <span className="block text-[12px] text-muted">{hint}</span>
      </span>
    </label>
  );
}
