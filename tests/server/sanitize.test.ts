import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "@/lib/server/issue-detail";

describe("sanitizeHtml bypasses", () => {
  const cases = [
    `<img/onerror=alert(1) src=x>`,
    `<img src="x"onerror="alert(1)">`,
    `<p onclick="a()"onmouseover="b()">x</p>`,
    `<a title="a>b" onclick="alert(1)">x</a>`,
    `<a href="jav&#x61;script:alert(1)">x</a>`,
    `<a href="java&#9;script:alert(1)">x</a>`,
    `<a href=" &#106;avascript:alert(1)">x</a>`,
    `<a href="data:text/html,<script>alert(1)</script>">x</a>`,
    `<svg><animate attributeName="href" values="javascript:alert(1)"/></svg>`,
  ];
  for (const html of cases) {
    it(`neutralises ${html}`, () => {
      expect(sanitizeHtml(html)).not.toMatch(/\son\w+=|javascript|&#|data:text|<animate/i);
    });
  }

  it("makes a description video playable", () => {
    const out = sanitizeHtml('<video src="https://github.com/acme/widgets/assets/1/clip.mp4"></video>');
    expect(out).toContain("controls");
    expect(out).toContain("playsinline");
    expect(out).toContain('preload="metadata"');
    expect(out).not.toMatch(/\son\w+=/);
  });

  it("leaves ordinary markup and text alone", () => {
    expect(sanitizeHtml(`<p>Set onboarding=true</p>`)).toBe(`<p>Set onboarding=true</p>`);
    expect(sanitizeHtml(`<a href="https://x.dev/online=1">x</a>`)).toBe(
      `<a target="_blank" rel="noreferrer noopener" href="https://x.dev/online=1">x</a>`,
    );
    expect(sanitizeHtml(`<img src="data:image/png;base64,AAAA" alt="">`)).toBe(`<img src="data:image/png;base64,AAAA" alt="">`);
  });
});
