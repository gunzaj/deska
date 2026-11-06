// Desktop smoke test (SPEC D2 and D3 acceptance, §2.2, §2.3). Launches the
// built app (the packaged .app when release/ has one, else `electron .` on the
// staged build) against a throwaway profile seeded with the fixture dataset,
// and a mock GitHub API on 127.0.0.1: nothing here talks to real GitHub.
//
// `--use-mock-keychain` keeps safeStorage off the real macOS keychain (no
// prompts, nothing left behind); it still encrypts.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { altFields } from "../../lib/demo/fixtures-alt";
import { fixtureSnapshot } from "../../lib/demo/fixtures";
import type { SnapshotField } from "../../lib/sync/types";

const root = process.cwd();

// Obviously fake, and assembled so no token-shaped literal is committed.
const TOKEN = ["github", "pat", "TEST", "FAKE", "SMOKE", "0".repeat(20)].join("_");

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

// --- a mock GitHub API --------------------------------------------------------

type MockProject = { id: string; number: number; title: string; closed: boolean; fields: SnapshotField[] };
type MockGitHub = {
  url: string;
  requests: { method: string; path: string; auth: string | null; query: string }[];
  projects: "ok" | "forbidden";
  /** The org's projects, fields included; a test renames or deletes fields here. */
  orgProjects: MockProject[];
  close(): Promise<void>;
};

async function mockGitHub(): Promise<MockGitHub> {
  const mock = {
    requests: [] as MockGitHub["requests"],
    projects: "ok" as MockGitHub["projects"],
    orgProjects: [
      { id: "PVT_acme_widgets_roadmap", number: 7, title: "Widgets Roadmap", closed: false, fields: fixtureSnapshot().fields },
      { id: "PVT_acme_ops_board", number: 3, title: "Ops Board", closed: false, fields: altFields() },
    ] as MockProject[],
  };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://mock");
      const auth = req.headers.authorization ?? null;
      const gql = (JSON.parse(body || "{}") as { query?: string; variables?: Record<string, unknown> }) ?? {};
      mock.requests.push({ method: req.method ?? "", path: url.pathname, auth, query: String(gql.query ?? "") });
      const json = (status: number, data: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(status, { "content-type": "application/json", ...headers });
        res.end(JSON.stringify(data));
      };
      if (auth?.replace(/^bearer /i, "") !== TOKEN) return json(401, { message: "Bad credentials" });
      if (req.method === "GET" && url.pathname === "/user") {
        return json(200, { login: "alice", name: "Alice", avatar_url: null }, { "github-authentication-token-expiration": "2027-03-01 00:00:00 UTC" });
      }
      if (req.method === "GET" && url.pathname === "/repos/acme/widgets") return json(200, { full_name: "acme/widgets", private: true });
      if (req.method === "GET" && url.pathname === "/repos/acme/widgets/issues") return json(200, []);
      if (req.method === "POST" && url.pathname === "/graphql") {
        const query = String(gql.query ?? "");
        const forbidden = { data: { organization: null }, errors: [{ type: "FORBIDDEN", message: "Resource not accessible by personal access token" }] };
        if (query.includes("DeskaOrgProjects")) {
          if (mock.projects === "forbidden") return json(200, forbidden);
          return json(200, { data: { organization: { projectsV2: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: mock.orgProjects.map(({ fields: _f, ...p }) => p) } } } });
        }
        if (query.includes("DeskaProjectFields")) {
          if (mock.projects === "forbidden") return json(200, forbidden);
          const p = mock.orgProjects.find((x) => x.number === Number(gql.variables?.number));
          if (!p) return json(200, { data: { organization: { projectV2: null } }, errors: [{ type: "NOT_FOUND", message: "Could not resolve to a ProjectV2" }] });
          const nodes = p.fields.map((f) => ({ id: f.id, name: f.name, dataType: f.dataType, ...(f.options ? { options: f.options } : {}), ...(f.iterations ? { configuration: { iterations: f.iterations, completedIterations: [] } } : {}) }));
          return json(200, { data: { organization: { projectV2: { id: p.id, number: p.number, title: p.title, fields: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } } } });
        }
        if (query.includes("projectV2")) {
          if (mock.projects === "forbidden") return json(200, { data: { organization: { projectV2: null } }, errors: [{ type: "FORBIDDEN", message: "Resource not accessible by personal access token" }] });
          return json(200, { data: { organization: { projectV2: { id: "PVT_acme_widgets_roadmap" } } } });
        }
        return json(200, { data: { organization: { issueTypes: { totalCount: 3 } } } });
      }
      return json(404, { message: "Not Found" });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return Object.assign(mock, {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  });
}

// --- launching ----------------------------------------------------------------

type Launched = { app: ElectronApplication; win: Page; origin: string; logs: () => string };

/**
 * `envTarget`: also set GITHUB_REPO / _ORG / _PROJECT_NUMBER (tests may; the
 * token check uses them until a project is chosen). Without it the app knows
 * only what onboarding step 2 stores (D4).
 */
async function launch(userData: string, github: MockGitHub, opts: { seed?: string; envTarget?: boolean } = {}): Promise<Launched> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("DESKA_") && !k.startsWith("GITHUB_")) env[k] = v;
  Object.assign(env, {
    DESKA_USER_DATA_DIR: userData,
    DESKA_DEMO_SEED: opts.seed ?? "fixtures",
    DESKA_GITHUB_API_URL: github.url,
    ...(opts.envTarget === false ? {} : { GITHUB_REPO: "acme/widgets", GITHUB_ORG: "acme", GITHUB_PROJECT_NUMBER: "7" }),
  });
  const exe = packagedApp();
  const args = ["--use-mock-keychain"];
  const app = await electron.launch(exe ? { executablePath: exe, args, env } : { args: [root, ...args], env });
  let out = "";
  app.process().stdout?.on("data", (d) => (out += String(d)));
  app.process().stderr?.on("data", (d) => (out += String(d)));
  const win = await app.firstWindow();
  await win.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 120_000 });
  return { app, win, origin: new URL(win.url()).origin, logs: () => out };
}

/** Onboarding step 2 through the UI: repository, find projects, pick one; `beforeSave` may change the suggested mapping. */
async function chooseProject(win: Page, origin: string, title: string, beforeSave?: () => Promise<void>) {
  await expect(win.getByRole("heading", { name: "Choose your project" })).toBeVisible({ timeout: 60_000 });
  await win.getByLabel("Repository").fill("acme/widgets");
  await win.getByRole("button", { name: "Find projects" }).click();
  await win.getByRole("radio", { name: new RegExp(`^${title}`) }).check();
  await expect(win.locator("[data-mapping-form]")).toBeVisible({ timeout: 30_000 });
  await beforeSave?.();
  await win.getByRole("button", { name: "Save and open Deska" }).click();
  await win.waitForURL(`${origin}/issues`, { timeout: 60_000 });
}

/** Onboarding through the UI: paste, connect, choose the project, continue to the issue list. */
async function connect(win: Page, origin: string) {
  if (!new URL(win.url()).pathname.startsWith("/onboarding")) await win.goto(`${origin}/onboarding`);
  await expect(win.getByRole("heading", { name: "Connect GitHub" })).toBeVisible({ timeout: 60_000 });
  await win.getByLabel("Fine-grained personal access token").fill(TOKEN);
  await win.getByRole("button", { name: "Connect" }).click();
  await expect(win.getByText("Connected as")).toContainText("@alice", { timeout: 30_000 });
  await win.getByRole("button", { name: "Continue" }).click();
  await chooseProject(win, origin, "Widgets Roadmap");
  await expect(win.getByText("Bug: crash on start")).toBeVisible({ timeout: 60_000 });
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

/** Files under `dir` whose bytes contain `needle`. */
function filesContaining(dir: string, needle: string): string[] {
  const hits: string[] = [];
  const bytes = Buffer.from(needle);
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = path.join(d, e);
      const st = statSync(p, { throwIfNoEntry: false });
      if (!st) continue;
      if (st.isDirectory()) walk(p);
      else if (st.isFile() && st.size < 256 * 1024 * 1024 && readFileSync(p).includes(bytes)) hits.push(path.relative(dir, p));
    }
  };
  walk(dir);
  return hits;
}

test.describe("desktop shell", () => {
  let userData: string;
  let github: MockGitHub;

  test.beforeEach(async () => {
    userData = mkdtempSync(path.join(os.tmpdir(), "deska-smoke-"));
    github = await mockGitHub();
  });
  test.afterEach(async () => {
    await github.close();
    rmSync(userData, { recursive: true, force: true });
  });

  test("first launch opens onboarding; a read-only token connects and reaches the issue list; the token stays in main and memory", async () => {
    const { app, win, origin, logs } = await launch(userData, github);
    try {
      expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      await win.waitForURL(`${origin}/onboarding`);
      await expect(win.getByRole("heading", { name: "How to create it" })).toBeVisible({ timeout: 60_000 });
      // The renderer has no Node, only the typed bridge.
      expect(await win.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe("undefined");
      expect(await win.evaluate(() => typeof (globalThis as { process?: unknown }).process)).toBe("undefined");
      expect(await win.evaluate(() => Object.keys(window.deska ?? {}).sort())).toEqual(["appInfo", "notify", "openExternal", "token"]);
      expect(await win.evaluate(() => window.deska!.appInfo())).toMatchObject({ name: "Deska", platform: "darwin" });
      // main refuses anything but a fine-grained token, with its own words.
      expect(await win.evaluate(() => window.deska!.token.set("ghp_classic").then(() => "stored", (e: Error) => e.message))).toContain("fine-grained personal access token");

      await win.getByLabel("Fine-grained personal access token").fill(TOKEN);
      await win.getByRole("button", { name: "Connect" }).click();
      await expect(win.getByText("Connected as")).toContainText("@alice", { timeout: 30_000 });
      await expect(win.getByText("Read-only token")).toBeVisible();
      await expect(win.locator('[data-permission="projects"]')).toContainText("Granted");
      await expect(win.getByText("2027-03-01")).toBeVisible();
      await win.getByRole("button", { name: "Continue" }).click();
      await chooseProject(win, origin, "Widgets Roadmap");
      await expect(win.getByText("Bug: crash on start")).toBeVisible({ timeout: 60_000 });
      await expect(win.getByText("Epic: dashboard overhaul")).toBeVisible();
      await expect(win.getByText(/^Sample data\./)).toBeVisible();
      await expect(win.locator("[data-connection-state]")).toHaveCount(0);
      // `me` is the token's owner.
      await expect(win.locator("[data-user-menu]").first()).toContainText("alice");
      // Edit controls say why they are off.
      await win.goto(`${origin}/issues?issue=101`);
      const panel = win.getByRole("complementary", { name: "Issue #101" });
      await expect(panel.getByRole("button", { name: /Close issue/ })).toHaveAttribute("title", "Read-only token", { timeout: 60_000 });

      // The server checked the token and discovered the project against the (mock) API with reads only.
      expect(github.requests.length).toBeGreaterThan(0);
      for (const r of github.requests) {
        expect(r.method === "GET" || (r.method === "POST" && r.path === "/graphql"), `${r.method} ${r.path}`).toBe(true);
        expect(r.query).not.toMatch(/\bmutation\b/);
      }

      // The token is nowhere the renderer can reach: page, storage, any API answer, the bundle.
      const leaks = await win.evaluate(async (token) => {
        const found: string[] = [];
        const check = (where: string, text: string) => {
          if (text.includes(token)) found.push(where);
        };
        check("DOM", document.documentElement.outerHTML);
        check("storage", JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie);
        for (const api of ["/api/connection", "/api/connection?refresh=1", "/api/data", "/api/views", "/api/tasks", "/api/me/prefs", "/api/sync-status", "/api/issues/101"]) {
          check(api, await fetch(api).then((r) => r.text()));
        }
        const scripts = [...new Set([...document.scripts].map((s) => s.src).filter(Boolean).concat(performance.getEntriesByType("resource").map((e) => e.name).filter((n) => n.includes("/_next/static/"))))];
        for (const src of scripts) check(src, await fetch(src).then((r) => r.text()));
        return { found, scripts: scripts.length };
      }, TOKEN);
      expect(leaks.scripts).toBeGreaterThan(0);
      expect(leaks.found).toEqual([]);

      // On disk: ciphertext only; the database never holds it.
      expect(existsSync(path.join(userData, "github-token.bin"))).toBe(true);
      expect(filesContaining(userData, TOKEN)).toEqual([]);
      // Not in any log line of main or the server.
      expect(logs()).not.toContain(TOKEN);
    } finally {
      await app.close();
    }
  });

  test("a token missing Projects read names the permission, also over the issue list", async () => {
    github.projects = "forbidden";
    const { app, win, origin } = await launch(userData, github);
    try {
      await win.waitForURL(`${origin}/onboarding`);
      await win.getByLabel("Fine-grained personal access token").fill(TOKEN);
      await win.getByRole("button", { name: "Connect" }).click();
      await expect(win.getByText("This token is missing a permission: Organization → Projects: Read").first()).toBeVisible({ timeout: 30_000 });
      await expect(win.locator('[data-permission="projects"]')).toContainText("Missing");
      await win.getByRole("button", { name: "Continue" }).click();
      // Step 2 can't list the projects either: it names the permission, never an empty list.
      await win.getByLabel("Repository").fill("acme/widgets");
      await win.getByRole("button", { name: "Find projects" }).click();
      await expect(win.getByRole("alert").filter({ hasText: "This token is missing a permission: Organization → Projects: Read" })).toBeVisible({ timeout: 30_000 });
      await expect(win.getByRole("radio")).toHaveCount(0);
      // The app stays on step 2 until a project is chosen.
      await win.goto(`${origin}/issues`);
      await win.waitForURL(`${origin}/onboarding?step=2`);
    } finally {
      await app.close();
    }
  });

  test("the local server answers 403 without the secret cookie or with a wrong Host", async () => {
    const { app, win, origin } = await launch(userData, github);
    try {
      await connect(win, origin);
      const secret = await launchSecret(app);
      expect(secret).toMatch(/^[0-9a-f]{64}$/);
      const host = new URL(origin).host;
      const cookie = `deska_launch=${secret}`;
      // No cookie, a wrong one, a wrong Host: 403 for pages, API and static files.
      for (const p of ["/", "/issues", "/onboarding", "/api/views", "/api/data", "/api/connection", "/favicon.ico"]) {
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
    const { app, win, origin } = await launch(userData, github);
    try {
      await connect(win, origin);
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

  test("the connection and a saved view survive a relaunch; disconnecting returns to onboarding", async () => {
    const view = { name: "Smoke: open bugs", visibility: "personal", layout: "list", filters: [{ field: "state", op: "in", values: ["open"] }], sort: [] };
    const first = await launch(userData, github);
    let saved: { id: string };
    try {
      await connect(first.win, first.origin);
      saved = await first.win.evaluate(async (body) => {
        const r = await fetch("/api/views", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        if (!r.ok) throw new Error(`POST /api/views: ${r.status} ${await r.text()}`);
        return r.json();
      }, view);
      expect(saved.id).toBeTruthy();
    } finally {
      await first.app.close();
    }

    const second = await launch(userData, github);
    try {
      // A new launch: a new port and a new secret, the same database and token, no onboarding.
      expect(second.origin).not.toBe(first.origin);
      expect(new URL(second.win.url()).pathname).not.toBe("/onboarding");
      const views = await second.win.evaluate(() => fetch("/api/views").then((r) => r.json()));
      const list = (Array.isArray(views) ? views : (views.views ?? [])) as { id: string; name: string }[];
      expect(list.find((v) => v.id === saved.id)?.name).toBe(view.name);

      // Disconnect: the token file goes, the app is back at onboarding, and the API has no user.
      await second.win.goto(`${second.origin}/settings`);
      await second.win.getByRole("button", { name: "Disconnect GitHub…" }).click();
      await second.win.getByRole("button", { name: "Disconnect", exact: true }).click();
      await second.win.waitForURL(`${second.origin}/onboarding`);
      expect(existsSync(path.join(userData, "github-token.bin"))).toBe(false);
      expect(await second.win.evaluate(() => fetch("/api/views").then((r) => r.status))).toBe(401);
    } finally {
      await second.app.close();
    }
  });

  test("D4: step 2 maps a project with differently named fields; Settings remaps, follows a rename and reports a deleted field", async () => {
    const { app, win, origin } = await launch(userData, github, { seed: "alt", envTarget: false });
    const data = () => win.evaluate(() => fetch("/api/data").then((r) => r.json()));
    try {
      await win.waitForURL(`${origin}/onboarding`);
      await win.getByLabel("Fine-grained personal access token").fill(TOKEN);
      await win.getByRole("button", { name: "Connect" }).click();
      await expect(win.getByText("Connected as")).toContainText("@alice", { timeout: 30_000 });
      // No repository or project yet (and no env): only `GET /user` is checked.
      await expect(win.locator('[data-permission="projects"]')).toContainText("Not checked yet");
      await win.getByRole("button", { name: "Continue" }).click();
      await expect(win.getByRole("heading", { name: "Choose your project" })).toBeVisible({ timeout: 60_000 });
      // A connected user without a project is sent back to step 2.
      await win.goto(`${origin}/issues`);
      await win.waitForURL(`${origin}/onboarding?step=2`);

      await chooseProject(win, origin, "Ops Board", async () => {
        // Suggested by name and type: Stage, Urgency (options highest first), Cycle; Squad and Surface as dimensions.
        await expect(win.locator("#map-status")).toHaveValue("PVTSSF_acme_stage");
        await expect(win.locator("#map-priority")).toHaveValue("PVTSSF_acme_urgency");
        await expect(win.locator("#map-sprint")).toHaveValue("PVTIF_acme_cycle");
        await expect(win.locator("[data-priority-preview]")).toContainText("P0 › P1 › P2");
        await expect(win.getByRole("checkbox", { name: /^Squad/ })).toBeChecked();
        await expect(win.getByRole("checkbox", { name: /^Surface/ })).toBeChecked();
        await expect(win.getByRole("checkbox", { name: "Estimate" })).toHaveCount(0);
        // "Status options that also count as done": empty by default.
        await expect(win.getByRole("checkbox", { name: "Shipped" })).not.toBeChecked();
        await win.getByRole("checkbox", { name: "Shipped" }).check();
        // No Sprint: sprint features stay hidden.
        await win.locator("#map-sprint").selectOption("");
      });

      // The differently named fields work end to end.
      await expect(win.getByText("Bug: crash on start")).toBeVisible({ timeout: 60_000 });
      const meta = (await data()).meta;
      expect(meta.mapping).toMatchObject({ status: { name: "Stage" }, priority: { name: "Urgency" }, sprint: null, doneStatusIds: ["f0000003"] });
      expect(meta.dimensions.map((d: { name: string }) => d.name)).toEqual(["Squad", "Surface"]);
      await expect(win.getByRole("link", { name: "All issues" }).first()).toBeVisible();
      await expect(win.getByRole("link", { name: "Releases" })).toHaveCount(0);
      await expect(win.getByRole("link", { name: "Backlog" })).toHaveCount(0);
      await win.goto(`${origin}/releases`);
      await expect(win.getByText("No Sprint field mapped")).toBeVisible({ timeout: 60_000 });
      const squad = Buffer.from(JSON.stringify({ filters: [{ field: "dim:PVTSSF_acme_squad", op: "in", values: ["h0000001"] }], sort: [{ field: "priority", dir: "desc" }], groupBy: "dim:PVTSSF_acme_squad", layout: "list" })).toString("base64url");
      await win.goto(`${origin}/issues?s=${squad}`);
      await expect(win.locator("[data-row-id]")).toHaveCount(2, { timeout: 60_000 });
      await expect(win.getByRole("button", { name: /Falcons/ }).first()).toBeVisible();
      // P0 (the first option) is the top priority: #100 sorts first.
      await expect(win.locator("[data-row-id]").first()).toHaveAttribute("data-issue", "100");

      // Settings: the stored project is checked now, and the mapping can change.
      await win.goto(`${origin}/settings`);
      await expect(win.locator("[data-project-target]")).toContainText("Ops Board · acme #3", { timeout: 60_000 });
      await expect(win.locator("[data-project-target]")).toContainText("PVT_acme_ops_board");
      await expect(win.locator('[data-permission="projects"]')).toContainText("Granted", { timeout: 30_000 });
      await win.locator("#map-sprint").selectOption("PVTIF_acme_cycle");
      await win.getByRole("radio", { name: "Last option is the highest priority" }).check();
      await expect(win.locator("[data-priority-preview]")).toContainText("P2 › P1 › P0");
      await win.getByRole("button", { name: "Save mapping" }).click();
      await expect(win.getByText("Saved", { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(win.getByRole("link", { name: "Releases" })).toBeVisible({ timeout: 30_000 });
      const remapped = (await data()).meta;
      expect(remapped.mapping.sprint.name).toBe("Cycle");
      expect(remapped.releases.length).toBeGreaterThan(0);
      // Priority rank follows the setting: P2 is now the top.
      expect(remapped.fields.priority.map((o: { name: string }) => o.name)).toEqual(["P0", "P1", "P2"]);

      // GitHub renames Squad and deletes Surface; "Reload fields" picks it up.
      const ops = github.orgProjects.find((p) => p.number === 3)!;
      ops.fields = ops.fields.filter((f) => f.id !== "PVTSSF_acme_surface").map((f) => (f.id === "PVTSSF_acme_squad" ? { ...f, name: "Crew" } : f));
      await win.getByRole("button", { name: "Reload fields" }).click();
      await expect(win.getByRole("checkbox", { name: /^Crew/ })).toBeChecked({ timeout: 30_000 });
      await expect(win.locator("[data-mapping-form] [data-missing-field]")).toContainText("Missing field — remap");
      await expect(win.locator("[data-missing-summary]")).toContainText("Surface");
      const after = (await data()).meta;
      expect(after.dimensions.map((d: { name: string; missing: boolean }) => [d.name, d.missing])).toEqual([
        ["Crew", false],
        ["Surface", true],
      ]);
      // In the app: a banner, and the issue panel shows the renamed field's value and "Missing field — remap" for the deleted one.
      await win.goto(`${origin}/issues?issue=100`);
      await expect(win.locator("[data-missing-banner]")).toContainText("Surface", { timeout: 60_000 });
      const panel = win.getByRole("complementary", { name: "Issue #100" });
      await expect(panel.getByText("Crew", { exact: true })).toBeVisible({ timeout: 60_000 });
      await expect(panel.getByText("Falcons")).toBeVisible();
      await expect(panel.locator("[data-missing-field]")).toContainText("Missing field — remap");

      // Reads only, all along.
      for (const r of github.requests) {
        expect(r.method === "GET" || (r.method === "POST" && r.path === "/graphql"), `${r.method} ${r.path}`).toBe(true);
        expect(r.query).not.toMatch(/\bmutation\b/);
      }
    } finally {
      await app.close();
    }
  });
});
