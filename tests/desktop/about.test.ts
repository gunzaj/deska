// D14: the About window and the build's write switch stamp.
import { describe, expect, it } from "vitest";
import { aboutDetails, parseBuildInfo, RELEASES_URL } from "@/desktop/about";

describe("parseBuildInfo", () => {
  it("is on only when the stamp says so", () => {
    expect(parseBuildInfo({ writes: "on" })).toEqual({ writes: "on" });
    expect(parseBuildInfo({ writes: "off" })).toEqual({ writes: "off" });
  });

  it("treats a missing or damaged stamp as off", () => {
    for (const raw of [null, undefined, "on", 1, {}, { writes: true }, { writes: "ON" }, []]) expect(parseBuildInfo(raw)).toEqual({ writes: "off" });
  });
});

describe("aboutDetails", () => {
  it("shows the version and says the build is read-only", () => {
    const d = aboutDetails("1.0.0", { writes: "off" });
    expect(d.message).toBe("Deska 1.0.0");
    expect(d.detail).toContain("read-only");
    expect(d.detail).toContain("Releases");
  });

  it("links to the Releases page on github.com", () => {
    expect(new URL(RELEASES_URL).origin).toBe("https://github.com");
    expect(RELEASES_URL.endsWith("/releases")).toBe(true);
  });
});
