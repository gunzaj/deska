// SPEC §2.3, §4.9: the AI API key's shape check in main, and the bridge's promise
// that no method hands the key back to the page.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AI_KEY, CHANNELS } from "../../desktop/bridge";

describe("AI key (desktop bridge)", () => {
  it("accepts one printable token and refuses spaces, control characters, quotes and short or huge values", () => {
    for (const ok of ["test-key-0123456789", "sk-" + "a".repeat(40), "A".repeat(512), "Bearer_not_needed.x"]) expect(AI_KEY.test(ok), ok).toBe(true);
    for (const bad of ["short", "has space in it", "tab\tkey-0123456789", "new\nline-0123456789", '"quoted-key-0123456"', "A".repeat(513), ""]) expect(AI_KEY.test(bad), JSON.stringify(bad)).toBe(false);
  });

  it("has its own channels, and the preload exposes status without the key", () => {
    expect([CHANNELS.aiKeySet, CHANNELS.aiKeyClear, CHANNELS.aiKeyStatus]).toEqual(["deska:ai-key-set", "deska:ai-key-clear", "deska:ai-key-status"]);
    const preload = readFileSync(path.join(__dirname, "../../desktop/preload.ts"), "utf8");
    expect(preload).toContain('aiKey: {');
    expect(preload).toContain('invoke("deska:ai-key-set", String(key))');
  });

  it("gives Ramble's transcription key the same channels, bridge and no log", () => {
    expect([CHANNELS.transcribeKeySet, CHANNELS.transcribeKeyClear, CHANNELS.transcribeKeyStatus]).toEqual([
      "deska:transcribe-key-set",
      "deska:transcribe-key-clear",
      "deska:transcribe-key-status",
    ]);
    const preload = readFileSync(path.join(__dirname, "../../desktop/preload.ts"), "utf8");
    expect(preload).toContain('transcribeKey: {');
    expect(preload).toContain('invoke("deska:transcribe-key-set", String(key))');
    const main = readFileSync(path.join(__dirname, "../../desktop/main.ts"), "utf8");
    const handlers = main.slice(main.indexOf("CHANNELS.transcribeKeySet"), main.indexOf("CHANNELS.githubStatus"));
    expect(handlers.match(/return transcribeKeyStatus\(\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(handlers).not.toMatch(/log\(|console\./);
  });

  it("main answers with a status only and never logs the key", () => {
    const main = readFileSync(path.join(__dirname, "../../desktop/main.ts"), "utf8");
    const handlers = main.slice(main.indexOf("CHANNELS.aiKeySet"), main.indexOf("CHANNELS.githubStatus"));
    expect(handlers.match(/return aiKeyStatus\(\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(handlers).not.toMatch(/log\(|console\./);
  });
});
