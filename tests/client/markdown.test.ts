import { describe, expect, it } from "vitest";
import { renderMarkdownLite, sanitizeHtml } from "@/lib/server/issue-detail";

describe("sanitizeHtml", () => {
  it("drops scripts, inline handlers and javascript: URLs", () => {
    const out = sanitizeHtml(`<p onclick="x()">hi</p><script>alert(1)</script><a href="javascript:alert(1)">x</a><img src=x onerror=alert(1)><iframe src="https://evil"></iframe>`);
    expect(out).not.toMatch(/script|onclick|onerror|javascript:|iframe/i);
    expect(out).toContain("<p>hi</p>");
  });

  it("renders images in a description", () => {
    expect(sanitizeHtml(renderMarkdownLite("![A widget](https://github.com/acme/widgets/assets/1/a.png)"))).toBe(
      '<p><img src="https://github.com/acme/widgets/assets/1/a.png" alt="A widget"></p>',
    );
  });

  it("opens links in a new tab without opener", () => {
    expect(sanitizeHtml('<a href="https://github.com">gh</a>')).toBe('<a target="_blank" rel="noreferrer noopener" href="https://github.com">gh</a>');
  });
});

describe("renderMarkdownLite", () => {
  it("renders headings, task lists, code and escapes HTML", () => {
    const html = renderMarkdownLite("## Steps\n\n1. Open <Widget>\n- [x] done\n- [ ] todo\n\n```\nconst a = '<b>';\n```\nSee #123 and **bold**");
    expect(html).toContain("<h3>Steps</h3>");
    expect(html).toContain("<li>Open &lt;Widget&gt;</li>");
    expect(html).toContain('<input type="checkbox" disabled checked> done');
    expect(html).toContain("<pre><code>const a = '&lt;b&gt;';</code></pre>");
    expect(html).toContain('<a href="https://github.com/acme/widgets/issues/123">#123</a>');
    expect(html).toContain("<strong>bold</strong>");
    expect(html).not.toContain("<Widget>");
  });
});
