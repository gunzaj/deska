import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { APP_ICONS, DEFAULT_DESKTOP_PREFS } from "../../desktop/bridge";
import { parseDesktopPrefs, parsePrefsPatch, validAccelerator } from "../../desktop/prefs";

describe("global shortcut accelerators (D12)", () => {
  it("accepts a modifier plus one key, and the empty string for none", () => {
    for (const ok of ["Control+Alt+Space", "Command+Shift+K", "Alt+F5", "Control+1", "CommandOrControl+Plus", ""]) expect(validAccelerator(ok), ok).toBe(true);
  });

  it("refuses what would steal typing from every app or is not a shortcut", () => {
    // A bare key, Shift alone, two keys, a repeated or unknown modifier, junk.
    for (const bad of ["A", "Shift+A", "Control+A+B", "Control+Control+A", "Meta+A", "Control+", "+A", "Control+Alt+Shift+Command+A", "Control+ab", "Control+F25", "rm -rf"]) {
      expect(validAccelerator(bad), bad).toBe(false);
    }
  });
});

describe("desktop prefs (D12)", () => {
  it("defaults: ⌃⌥Space, notifications and badge on, launch at login off", () => {
    expect(parseDesktopPrefs(null)).toEqual({ shortcut: "Control+Alt+Space", notifications: true, launchAtLogin: false, dockBadge: true, backupFolder: "", githubAuthSource: "token", appIcon: "coral" });
    expect(DEFAULT_DESKTOP_PREFS.launchAtLogin).toBe(false);
  });

  it("replaces each wrong field with its default and keeps the right ones", () => {
    expect(parseDesktopPrefs({ shortcut: "nope", notifications: "yes", launchAtLogin: true, dockBadge: false })).toEqual({
      shortcut: "Control+Alt+Space",
      notifications: true,
      launchAtLogin: true,
      dockBadge: false,
      backupFolder: "",
      githubAuthSource: "token",
      appIcon: "coral",
    });
  });

  it("the second backup folder must be an absolute path; anything else is no folder", () => {
    expect(parseDesktopPrefs({ backupFolder: "/Volumes/Backup/Deska" }).backupFolder).toBe("/Volumes/Backup/Deska");
    for (const bad of ["relative/dir", "~/Documents", 5, null, "/tmp/a\0b"]) expect(parseDesktopPrefs({ backupFolder: bad }).backupFolder, String(bad)).toBe("");
  });

  it("the app icon is one of the offered icons, Coral by default", () => {
    expect(APP_ICONS.map((i) => i.id)).toEqual(["coral", "ocean-blue", "green", "violet", "sunny-yellow", "charcoal", "coral-pink-gradient", "orange"]);
    expect(parseDesktopPrefs({ appIcon: "violet" }).appIcon).toBe("violet");
    for (const bad of [undefined, "", "Violet", "../../etc/passwd", 3, null, { id: "violet" }]) expect(parseDesktopPrefs({ appIcon: bad }).appIcon, String(bad)).toBe("coral");
    expect(parsePrefsPatch({ appIcon: "charcoal" })).toEqual({ patch: { appIcon: "charcoal" }, error: null });
    const bad = parsePrefsPatch({ appIcon: "../icon" });
    expect(bad.patch).toEqual({});
    expect(bad.error).toMatch(/app icon/);
  });

  it("every offered icon has its Dock image and its Settings thumbnail", () => {
    for (const { id } of APP_ICONS) {
      expect(existsSync(`desktop/assets/app-icons/${id}.png`), id).toBe(true);
      expect(existsSync(`public/app-icons/${id}-128.png`), id).toBe(true);
    }
  });

  it("the page cannot set the backup folder through a patch", () => {
    expect(parsePrefsPatch({ backupFolder: "/Users/someone/Documents" })).toEqual({ patch: {}, error: null });
  });

  it("a patch takes known fields of the right type and names a refused shortcut", () => {
    expect(parsePrefsPatch({ dockBadge: false, extra: 1, notifications: "x" })).toEqual({ patch: { dockBadge: false }, error: null });
    const bad = parsePrefsPatch({ shortcut: "A" });
    expect(bad.patch).toEqual({});
    expect(bad.error).toMatch(/shortcut/);
    expect(parsePrefsPatch({ shortcut: "" }).patch).toEqual({ shortcut: "" });
    expect(parsePrefsPatch(null)).toEqual({ patch: {}, error: null });
  });
});
