// Desktop shell smoke test (SPEC D2 acceptance, §2.2). Launches the built app
// (the packaged .app when release/ has one, else `electron .` on the staged
// build) against a throwaway profile seeded with the fixture dataset.
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";

const root = process.cwd();

function packagedApp(): string | null {
  if (process.env.DESKA_SMOKE_TARGET === "staged") return null;
  const release = path.join(root, "release");
  if (!existsSync(release)) return null;
  for (const dir of readdirSync(release)) {
    const exe = path.join(release, dir, "Deska.app", "Contents", "MacOS", "Deska");
    if (existsSync(exe)) return exe;
  }
  return null;
}

async function launch(userData: string): Promise<{ app: ElectronApplication; win: Page; origin: string }> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("DESKA_")) env[k] = v;
  Object.assign(env, { DESKA_USER_DATA_DIR: userData, DESKA_DEMO_SEED: "fixtures" });
  const exe = packagedApp();
  const app = await electron.launch(exe ? { executablePath: exe, args: [], env } : { args: [root], env });
  const win = await app.firstWindow();
  await win.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 120_000 });
  return { app, win, origin: new URL(win.url()).origin };
}

/** A raw request from outside the app window, with full control of Host and Cookie. */
function rawGet(origin: string, pathname: string, headers: Record<string, string>): Promise<number> {
  const u = new URL(origin);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: Number(u.port), path: pathname, method: "GET", headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });
}

const launchSecret = (app: ElectronApplication) =>
  app.evaluate(async ({ session }) => (await session.defaultSession.cookies.get({ name: "deska_launch" }))[0]?.value ?? "");

test.describe("desktop shell", () => {
  let userData: string;

  test.beforeEach(() => {
    userData = mkdtempSync(path.join(os.tmpdir(), "deska-smoke-"));
  });
  test.afterEach(() => {
    rmSync(userData, { recursive: true, force: true });
  });

  test("launches the app with its own server and loads the issue list", async () => {
    const { app, win, origin } = await launch(userData);
    try {
      expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      await win.goto(`${origin}/issues`);
      await expect(win.getByText("Bug: crash on start")).toBeVisible({ timeout: 60_000 });
      await expect(win.getByText("Epic: dashboard overhaul")).toBeVisible();
      await expect(win.getByText(/^Sample data\./)).toBeVisible();
      // The renderer has no Node, only the typed bridge.
      expect(await win.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe("undefined");
      expect(await win.evaluate(() => typeof (globalThis as { process?: unknown }).process)).toBe("undefined");
      expect(await win.evaluate(() => Object.keys(window.deska ?? {}).sort())).toEqual(["appInfo", "notify", "openExternal", "token"]);
      expect(await win.evaluate(() => window.deska!.appInfo())).toMatchObject({ name: "Deska", platform: "darwin" });
    } finally {
      await app.close();
    }
  });

  test("the local server answers 403 without the secret cookie or with a wrong Host", async () => {
    const { app, win, origin } = await launch(userData);
    try {
      const secret = await launchSecret(app);
      expect(secret).toMatch(/^[0-9a-f]{64}$/);
      const host = new URL(origin).host;
      const cookie = `deska_launch=${secret}`;
      // No cookie, a wrong one, a wrong Host: 403 for pages, API and static files.
      for (const p of ["/", "/issues", "/api/views", "/api/data", "/favicon.ico"]) {
        expect(await rawGet(origin, p, { host }), `${p} without cookie`).toBe(403);
        expect(await rawGet(origin, p, { host, cookie: `deska_launch=${"0".repeat(64)}` }), `${p} wrong cookie`).toBe(403);
      }
      for (const badHost of [`localhost:${new URL(origin).port}`, "evil.example", `127.0.0.1:${Number(new URL(origin).port) + 1}`]) {
        expect(await rawGet(origin, "/api/views", { host: badHost, cookie }), badHost).toBe(403);
      }
      // Static files are guarded too.
      const chunk = await win.evaluate(() => [...document.scripts].map((s) => s.src).find((s) => s.includes("/_next/static/")));
      expect(chunk).toBeTruthy();
      const chunkPath = new URL(chunk!).pathname;
      expect(await rawGet(origin, chunkPath, { host })).toBe(403);
      expect(await rawGet(origin, chunkPath, { host, cookie })).toBe(200);
      // The right Host and secret get through, and so does the window itself.
      expect(await rawGet(origin, "/api/views", { host, cookie })).toBe(200);
      expect(await win.evaluate(() => fetch("/api/views").then((r) => r.status))).toBe(200);
      // HttpOnly: page scripts never see the secret.
      expect(await win.evaluate(() => document.cookie)).not.toContain("deska_launch");
    } finally {
      await app.close();
    }
  });

  test("GitHub links open in the default browser; other external URLs are blocked", async () => {
    const { app, win, origin } = await launch(userData);
    try {
      await win.goto(`${origin}/issues`);
      await expect(win.getByText("Bug: crash on start")).toBeVisible({ timeout: 60_000 });
      // Record instead of opening a real browser.
      await app.evaluate(({ shell }) => {
        const opened: string[] = [];
        (globalThis as { opened?: string[] }).opened = opened;
        shell.openExternal = async (url: string) => {
          opened.push(url);
        };
      });
      const opened = () => app.evaluate(() => (globalThis as { opened?: string[] }).opened ?? []);

      // A target=_blank link to GitHub, and a same-window navigation to GitHub.
      await win.evaluate(() => {
        const a = document.createElement("a");
        a.href = "https://github.com/acme/widgets/issues/101";
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = "on GitHub";
        document.body.append(a);
        a.click();
      });
      await expect.poll(opened).toEqual(["https://github.com/acme/widgets/issues/101"]);
      await win.evaluate(() => (window.location.href = "https://github.com/acme/widgets/issues/102"));
      await expect.poll(opened).toEqual(["https://github.com/acme/widgets/issues/101", "https://github.com/acme/widgets/issues/102"]);
      expect(win.url()).toBe(`${origin}/issues`);

      // Anything else: no navigation, no new window, no browser, no request.
      await win.evaluate(() => (window.location.href = "https://example.com/"));
      await win.evaluate(() => window.open("https://example.com/popup"));
      await win.waitForTimeout(500);
      expect(win.url()).toBe(`${origin}/issues`);
      expect(app.windows()).toHaveLength(1);
      expect(await opened()).toHaveLength(2);
      expect(await win.evaluate(() => fetch("https://example.com/").then(() => "loaded", () => "blocked"))).toBe("blocked");
      // The bridge refuses non-GitHub URLs too.
      expect(await win.evaluate(() => window.deska!.openExternal("https://example.com/"))).toBe(false);
      expect(await win.evaluate(() => window.deska!.openExternal("https://github.com/acme/widgets"))).toBe(true);
      expect(await opened()).toHaveLength(3);
    } finally {
      await app.close();
    }
  });

  test("a saved view survives a relaunch", async () => {
    const view = { name: "Smoke: open bugs", visibility: "personal", layout: "list", filters: [{ field: "state", op: "in", values: ["open"] }], sort: [] };
    const first = await launch(userData);
    let saved: { id: string };
    try {
      saved = await first.win.evaluate(async (body) => {
        const r = await fetch("/api/views", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        if (!r.ok) throw new Error(`POST /api/views: ${r.status} ${await r.text()}`);
        return r.json();
      }, view);
      expect(saved.id).toBeTruthy();
    } finally {
      await first.app.close();
    }

    const second = await launch(userData);
    try {
      // A new launch: a new port and a new secret, the same database.
      expect(second.origin).not.toBe(first.origin);
      const views = await second.win.evaluate(() => fetch("/api/views").then((r) => r.json()));
      const list = (Array.isArray(views) ? views : (views.views ?? [])) as { id: string; name: string }[];
      expect(list.find((v) => v.id === saved.id)?.name).toBe(view.name);
    } finally {
      await second.app.close();
    }
  });
});
