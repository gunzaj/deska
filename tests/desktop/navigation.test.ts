// SPEC §2.2: navigation stays on the app origin, https://github.com/ opens in
// the default browser, everything else is blocked; the window loads nothing
// from the network but the app and GitHub images.
import { describe, expect, it } from "vitest";
import { classifyUrl, requestAllowed } from "@/desktop/navigation";

const APP = "http://127.0.0.1:43123";

describe("classifyUrl", () => {
  it("keeps the app's own pages in the window", () => {
    expect(classifyUrl(`${APP}/issues?s=1`, APP)).toBe("app");
    expect(classifyUrl(`${APP}/`, APP)).toBe("app");
  });

  it("sends github.com links to the default browser", () => {
    expect(classifyUrl("https://github.com/acme/widgets/issues/101", APP)).toBe("github");
    expect(classifyUrl("https://github.com/", APP)).toBe("github");
  });

  it("blocks everything else", () => {
    // Credentials in a github.com URL (built, not written out as user:pw@host).
    const withCredentials = Object.assign(new URL("https://github.com/acme"), { username: "user", password: "pw" }).href;
    for (const url of [
      withCredentials,
      "http://github.com/acme/widgets",
      "https://github.com.evil.example/x",
      "https://evil.example/?u=https://github.com/",
      "https://gist.github.com/alice/1",
      "https://github.com:8443/acme",
      "http://127.0.0.1:43124/",
      "http://localhost:43123/",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "mailto:alice@example.com",
      "not a url",
    ]) {
      expect(classifyUrl(url, APP), url).toBe("blocked");
    }
  });
});

describe("requestAllowed", () => {
  it("allows the app origin and in-page schemes", () => {
    expect(requestAllowed(`${APP}/_next/static/chunks/app.js`, "script", APP)).toBe(true);
    expect(requestAllowed(`${APP}/api/data`, "xhr", APP)).toBe(true);
    expect(requestAllowed("data:image/png;base64,AAAA", "image", APP)).toBe(true);
  });

  it("allows GitHub images only", () => {
    expect(requestAllowed("https://avatars.githubusercontent.com/u/1?v=4", "image", APP)).toBe(true);
    expect(requestAllowed("https://github.com/acme/widgets/assets/1/x.png", "image", APP)).toBe(true);
    expect(requestAllowed("https://avatars.githubusercontent.com/u/1", "script", APP)).toBe(false);
    expect(requestAllowed("https://api.github.com/user", "xhr", APP)).toBe(false);
    expect(requestAllowed("https://github.com/acme/widgets/assets/1/clip.mp4", "media", APP)).toBe(true);
    expect(requestAllowed("https://evil.example/clip.mp4", "media", APP)).toBe(false);
    expect(requestAllowed("https://evil.example/pixel.png", "image", APP)).toBe(false);
    expect(requestAllowed("https://fonts.example/font.woff2", "font", APP)).toBe(false);
  });
});
