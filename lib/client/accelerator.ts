// Turns a key press into an Electron accelerator ("Control+Alt+Space") for the
// shortcut field in Settings. Pure, so the mapping has a unit test.

const NAMED: Record<string, string> = {
  " ": "Space",
  Tab: "Tab",
  Enter: "Enter",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  "+": "Plus",
  "-": "Minus",
  "=": "Equal",
  ",": "Comma",
  ".": "Period",
  "/": "Slash",
  "\\": "Backslash",
  ";": "Semicolon",
  "'": "Quote",
  "`": "Backquote",
};

type KeyLike = { key: string; code?: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean };

/** The accelerator for this key press, or null while only modifiers are down or the key has no name. */
export function acceleratorFromKey(e: KeyLike): string | null {
  const k = e.key;
  if (["Control", "Meta", "Alt", "Shift", "Dead", "Unidentified"].includes(k)) return null;
  // With Option held, `key` is a composed character (Option+A = å): the physical key is what the user means.
  const fromCode = /^Key([A-Z])$/.exec(e.code ?? "")?.[1] ?? /^Digit(\d)$/.exec(e.code ?? "")?.[1];
  const main = fromCode ?? (/^F([1-9]|1\d|2[0-4])$/.test(k) ? k : NAMED[k] ?? (/^[a-z0-9]$/i.test(k) ? k.toUpperCase() : null));
  if (!main) return null;
  const mods = [e.ctrlKey && "Control", e.metaKey && "Command", e.altKey && "Alt", e.shiftKey && "Shift"].filter(Boolean) as string[];
  return [...mods, main].join("+");
}

/** "Control+Alt+Space" as it reads on a Mac: ⌃⌥Space. */
export function prettyAccelerator(acc: string): string {
  if (!acc) return "None";
  const symbols: Record<string, string> = { Control: "⌃", Ctrl: "⌃", Alt: "⌥", Option: "⌥", Shift: "⇧", Command: "⌘", Cmd: "⌘", CommandOrControl: "⌘", CmdOrCtrl: "⌘" };
  return acc
    .split("+")
    .map((p) => symbols[p] ?? p)
    .join("");
}
