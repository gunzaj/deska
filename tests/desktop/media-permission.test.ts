// Item 13: the microphone is the one media permission the desktop app grants;
// a request for audio and video must not get the camera too.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("desktop media permission", () => {
  const main = readFileSync(path.join(__dirname, "../../desktop/main.ts"), "utf8");

  it("allows an audio-only request and nothing else", () => {
    expect(main).toContain('mediaTypes?.length === 1 && mediaTypes[0] === "audio"');
    expect(main).not.toContain('mediaTypes?.includes("audio")');
  });
});
