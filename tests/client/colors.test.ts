import { describe, expect, it } from "vitest";
import { hashColor } from "@/lib/client/colors";

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

function luminance([r, g, b]: [number, number, number]): number {
  const c = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}

function whiteContrast(css: string): number {
  const m = /^hsl\((\d+) (\d+)% (\d+)%\)$/.exec(css);
  if (!m) throw new Error(`unexpected colour ${css}`);
  const rgb = hslToRgb(Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100);
  return 1.05 / (luminance(rgb) + 0.05);
}

describe("hashColor", () => {
  it("is deterministic per key", () => {
    expect(hashColor("alice")).toBe(hashColor("alice"));
  });

  it("keeps white avatar initials at 4.5:1 or better on every hue", () => {
    // Keys that hit all 360 hues: the hash is (h * 31 + code) % 360.
    const hues = new Set<string>();
    for (let i = 0; i < 5000 && hues.size < 360; i++) hues.add(hashColor(`user-${i}`));
    expect(hues.size).toBe(360);
    for (const c of hues) expect(whiteContrast(c), c).toBeGreaterThanOrEqual(4.5);
    for (const login of ["alice", "bob", "carol", "dave"]) expect(whiteContrast(hashColor(login))).toBeGreaterThanOrEqual(4.5);
  });
});
