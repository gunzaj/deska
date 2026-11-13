import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readJsonOrQuarantine, writeAtomic } from "../../desktop/atomic";
import { parseDesktopPrefs } from "../../desktop/prefs";
import { scrubEnvFiles } from "../../scripts/desktop-env.mjs";

let dir: string;
beforeEach(() => void (dir = mkdtempSync(path.join(os.tmpdir(), "deska-atomic-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("writeAtomic (D-3)", () => {
  it("replaces the file whole, leaves no temp file, and keeps the mode", () => {
    const f = path.join(dir, "p.json");
    writeFileSync(f, "old");
    writeAtomic(f, "new");
    expect(readFileSync(f, "utf8")).toBe("new");
    expect(existsSync(`${f}.tmp`)).toBe(false);
    expect(statSync(f).mode & 0o777).toBe(0o600);
  });

  it("a failed write leaves the old file intact", () => {
    const f = path.join(dir, "p.json");
    writeFileSync(f, "old");
    // The temp path is a directory, so the write fails before the rename.
    mkdirSync(`${f}.tmp`);
    expect(() => writeAtomic(f, "new")).toThrow();
    expect(readFileSync(f, "utf8")).toBe("old");
  });
});

describe("readJsonOrQuarantine (D-3)", () => {
  it("a truncated prefs file falls back to defaults and is kept as .bad", () => {
    const f = path.join(dir, "desktop-prefs.json");
    writeFileSync(f, '{"githubAuthSource":"gh","backupFol');
    const prefs = parseDesktopPrefs(readJsonOrQuarantine(f));
    expect(prefs.githubAuthSource).toBe("token");
    expect(existsSync(f)).toBe(false);
    expect(readFileSync(`${f}.bad`, "utf8")).toContain("githubAuthSource");
  });

  it("a missing file is null and creates nothing", () => {
    const f = path.join(dir, "none.json");
    expect(readJsonOrQuarantine(f)).toBeNull();
    expect(existsSync(`${f}.bad`)).toBe(false);
  });
});

describe("staging scrubs env files (D-2)", () => {
  it("no .env* is left under the staged server", () => {
    const server = path.join(dir, "server");
    mkdirSync(path.join(server, "sub"), { recursive: true });
    writeFileSync(path.join(server, ".env"), "TOKEN=dummy");
    writeFileSync(path.join(server, ".env.production"), "TOKEN=dummy");
    writeFileSync(path.join(server, "server.js"), "");
    writeFileSync(path.join(server, "sub", ".env.local"), "TOKEN=dummy");
    // A nested one is not removed silently: staging fails.
    expect(() => scrubEnvFiles(server)).toThrow(/env files/);
    expect(existsSync(path.join(server, ".env"))).toBe(false);
    expect(existsSync(path.join(server, ".env.production"))).toBe(false);
    expect(existsSync(path.join(server, "server.js"))).toBe(true);
    rmSync(path.join(server, "sub", ".env.local"));
    expect(() => scrubEnvFiles(server)).not.toThrow();
  });
});
