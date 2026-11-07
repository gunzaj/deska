import { describe, expect, it } from "vitest";
import { validAccelerator } from "../../desktop/prefs";
import { acceleratorFromKey, prettyAccelerator } from "@/lib/client/accelerator";

const key = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}, code = "") => ({ key, code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

describe("shortcut capture (D12)", () => {
  it("builds Electron accelerators, in a fixed modifier order", () => {
    expect(acceleratorFromKey(key(" ", { ctrlKey: true, altKey: true }))).toBe("Control+Alt+Space");
    expect(acceleratorFromKey(key("k", { metaKey: true, shiftKey: true }))).toBe("Command+Shift+K");
    expect(acceleratorFromKey(key("F5", { altKey: true }))).toBe("Alt+F5");
    expect(acceleratorFromKey(key("ArrowUp", { ctrlKey: true }))).toBe("Control+Up");
  });

  it("uses the physical key when Option composes a character (Option+A is å)", () => {
    expect(acceleratorFromKey(key("å", { altKey: true, ctrlKey: true }, "KeyA"))).toBe("Control+Alt+A");
    expect(acceleratorFromKey(key("¡", { altKey: true, ctrlKey: true }, "Digit1"))).toBe("Control+Alt+1");
  });

  it("waits while only modifiers are down", () => {
    for (const k of ["Control", "Meta", "Alt", "Shift"]) expect(acceleratorFromKey(key(k, { ctrlKey: true }))).toBeNull();
  });

  it("everything it builds with a real modifier is accepted by the main process's check", () => {
    for (const k of [" ", "a", "7", "F12", "Enter", "ArrowLeft", ",", "="]) expect(validAccelerator(acceleratorFromKey(key(k, { ctrlKey: true })) ?? "?"), k).toBe(true);
  });

  it("reads as Mac symbols", () => {
    expect(prettyAccelerator("Control+Alt+Space")).toBe("⌃⌥Space");
    expect(prettyAccelerator("Command+Shift+K")).toBe("⌘⇧K");
    expect(prettyAccelerator("")).toBe("None");
  });
});
