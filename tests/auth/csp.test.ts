import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "@/lib/csp";

describe("content security policy (v5 4.10)", () => {
  const prod = contentSecurityPolicy("abc123", false);
  const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

  it("lets only nonce-stamped scripts run, and no inline or eval in production", () => {
    const script = directive(prod, "script-src");
    expect(script).toContain("'nonce-abc123'");
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
  });

  it("allows eval and websockets only in development", () => {
    const dev = contentSecurityPolicy("n", true);
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(directive(dev, "connect-src")).toContain("ws:");
    expect(directive(prod, "connect-src")).toBe("connect-src 'self'");
  });

  it("keeps the framing, plugin and form restrictions", () => {
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).toContain("object-src 'none'");
    expect(prod).toContain("base-uri 'self'");
    expect(directive(prod, "form-action")).toBe("form-action 'self' https://github.com");
  });

  it("uses a different nonce per call site input", () => {
    expect(contentSecurityPolicy("a", false)).not.toBe(contentSecurityPolicy("b", false));
  });

  it("loads images and videos only from GitHub in the desktop app (SPEC §2.2)", () => {
    expect(directive(prod, "img-src")).toBe("img-src 'self' data: https:");
    expect(directive(prod, "media-src")).toBe("media-src 'self' data: https:");
    const desktop = contentSecurityPolicy("n", false, true);
    expect(directive(desktop, "img-src")).toBe("img-src 'self' data: https://github.com https://*.githubusercontent.com");
    expect(directive(desktop, "media-src")).toBe("media-src 'self' data: https://github.com https://*.githubusercontent.com");
    expect(directive(desktop, "connect-src")).toBe("connect-src 'self'");
  });
});
