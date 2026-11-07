// D14: the release pipeline stays read-only, unsigned and draft-only.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(f, "utf8");

describe("release workflow", () => {
  const wf = read(".github/workflows/release.yml");

  it("runs on v* tags and builds with writes off", () => {
    expect(wf).toMatch(/tags:\s*\["v\*"\]/);
    expect(wf).toMatch(/DESKA_WRITES:\s*"off"/);
    expect(wf).toContain("pnpm desktop:build");
  });

  it("only ever creates a draft release", () => {
    expect(wf).toMatch(/gh release create[^\n]*--draft/);
    expect(wf).not.toMatch(/--draft=false|gh release edit|--latest/);
  });
});

describe("desktop build", () => {
  const script = read("scripts/desktop.mjs");

  it("stamps writes off unless DESKA_WRITES=on is set on purpose", () => {
    expect(script).toContain('process.env.DESKA_WRITES === "on" ? "on" : "off"');
  });

  it("is a hardened-runtime, unsigned universal dmg", () => {
    expect(script).toContain("hardenedRuntime: true");
    expect(script).toContain("identity: null");
    expect(script).toContain('arch: ["universal"]');
  });
});

describe("docs", () => {
  it("has the handoff and release notes with the unsigned-app steps", () => {
    expect(read("docs/handoff.md")).toMatch(/Known limitations/);
    expect(read("docs/release-notes.md")).toMatch(/Open Anyway/);
  });
});
