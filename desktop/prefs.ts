// Desktop-only settings (SPEC §2.4, §4.6). Pure: main reads and writes the
// JSON file, this decides what a file or a request may contain. A damaged or
// hand-edited file falls back to the defaults per field, never to a crash.
import { DEFAULT_DESKTOP_PREFS, type DesktopPrefs } from "./bridge";

const MODIFIERS = new Set(["Command", "Cmd", "Control", "Ctrl", "CommandOrControl", "CmdOrCtrl", "Alt", "Option", "Shift"]);
const KEY = /^([A-Z0-9]|F([1-9]|1\d|2[0-4])|Space|Tab|Enter|Return|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right|Plus|Minus|Equal|Comma|Period|Slash|Backslash|Semicolon|Quote|Backquote)$/;

/**
 * An Electron accelerator for a *global* shortcut: at least one of Control,
 * Command or Alt (a bare letter or Shift+letter would steal typing from every
 * app), then exactly one key. "" is allowed and means no shortcut.
 */
export function validAccelerator(value: string): boolean {
  if (value === "") return true;
  const parts = value.split("+");
  const key = parts.pop() ?? "";
  if (!KEY.test(key) || parts.length === 0 || parts.length > 3) return false;
  if (new Set(parts).size !== parts.length || !parts.every((p) => MODIFIERS.has(p))) return false;
  return parts.some((p) => p !== "Shift");
}

/** The stored prefs: every field checked, anything wrong replaced by its default. */
export function parseDesktopPrefs(raw: unknown): DesktopPrefs {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_DESKTOP_PREFS;
  return {
    shortcut: typeof o.shortcut === "string" && validAccelerator(o.shortcut) ? o.shortcut : d.shortcut,
    notifications: typeof o.notifications === "boolean" ? o.notifications : d.notifications,
    launchAtLogin: typeof o.launchAtLogin === "boolean" ? o.launchAtLogin : d.launchAtLogin,
    dockBadge: typeof o.dockBadge === "boolean" ? o.dockBadge : d.dockBadge,
  };
}

/** A change request from the page: only known fields of the right type; `error` names the first refused one. */
export function parsePrefsPatch(raw: unknown): { patch: Partial<DesktopPrefs>; error: string | null } {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const patch: Partial<DesktopPrefs> = {};
  let error: string | null = null;
  if (o.shortcut !== undefined) {
    if (typeof o.shortcut === "string" && validAccelerator(o.shortcut)) patch.shortcut = o.shortcut;
    else error = "That is not a usable shortcut. Use Control, Command or Alt with a key, e.g. Control+Alt+Space.";
  }
  for (const k of ["notifications", "launchAtLogin", "dockBadge"] as const) {
    if (o[k] !== undefined && typeof o[k] === "boolean") patch[k] = o[k] as boolean;
  }
  return { patch, error };
}
