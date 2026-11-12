// Desktop smoke test (SPEC D2 and D3 acceptance, §2.2, §2.3). Launches the
// built app against a throwaway profile and a mock GitHub API on 127.0.0.1:
// nothing here talks to real GitHub.
//
// Three launch options decide what a test actually sees, and each one is a trap
// when it is left at its default:
//
// - `seed: ""` — the default seeds the fixture dataset, and seeding also writes
//   the poll cursor (`lib/sync/initial.ts`), so a seeded launch is never asked to
//   import and `/importing` is unreachable. Only the empty-seed test reaches it.
// - `envTarget: false` — otherwise GITHUB_REPO/_ORG/_PROJECT_NUMBER are set and
//   the app has a target before onboarding step 2 stores one, which hides a save
//   that did not persist.
// - `DESKA_SMOKE_TARGET=staged` — otherwise `packagedApp()` prefers any build
//   under `release/`, so a stale packaged app runs instead of the code under test.
//
// `--use-mock-keychain` keeps safeStorage off the real macOS keychain (no
// prompts, nothing left behind); it still encrypts.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
// Obviously fake; not token-shaped, so no literal trips the leak guard.
const AI_TEST_KEY = "test-ai-key-" + "9".repeat(20);
// What the fake GitHub CLI prints (D15): an OAuth-shaped token, just as fake.
const GH_TOKEN = ["gho", `TESTFAKESMOKE${"0".repeat(24)}`].join("_");

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
  /** Per-request latency on the issue pages, so a first import's progress can be observed. */
  delayMs: number;
  /** `x-oauth-scopes` GitHub reports for the fake GitHub CLI's token (D15). */
  ghScopes: string;
  close(): Promise<void>;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** More than one REST page of 100, so the first import really pages. */
const ISSUE_COUNT = 120;
/** Also more than one page: the metadata import must follow `link`. */
const LABEL_COUNT = 120;

function mockIssue(number: number, state: "open" | "closed") {
  // A minute apart, so the checkpoint (`since`) moves forward page by page.
  const at = new Date(Date.UTC(2026, 9, 1) + (number - 100) * 60_000).toISOString();
  return {
    node_id: `I_${number}`,
    number,
    title: number === 102 ? "Bug: crash on start" : `Issue ${number}`,
    body: `Body of ${number}`,
    state,
    state_reason: null,
    user: { login: number % 2 ? "bob" : "alice", id: number % 2 ? 2 : 1, avatar_url: null },
    html_url: `https://github.com/acme/widgets/issues/${number}`,
    created_at: at,
    updated_at: at,
    closed_at: state === "closed" ? at : null,
    labels: [],
    assignees: number % 3 ? [] : [{ id: 1, login: "alice", avatar_url: null }],
    milestone: null,
  };
}

async function mockGitHub(): Promise<MockGitHub> {
  const snapshot = fixtureSnapshot();
  const issues = [...Array.from({ length: ISSUE_COUNT }, (_, i) => mockIssue(100 + i, "open")), mockIssue(900, "closed"), mockIssue(901, "closed")];
  const mock = {
    requests: [] as MockGitHub["requests"],
    projects: "ok" as MockGitHub["projects"],
    delayMs: 0,
    ghScopes: "gist, read:org, read:project, repo",
    orgProjects: [
      { id: "PVT_acme_widgets_roadmap", number: 7, title: "Widgets Roadmap", closed: false, fields: snapshot.fields },
      { id: "PVT_acme_ops_board", number: 3, title: "Ops Board", closed: false, fields: altFields() },
    ] as MockProject[],
  };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => void (async () => {
      const url = new URL(req.url ?? "/", "http://mock");
      const auth = req.headers.authorization ?? null;
      const gql = (JSON.parse(body || "{}") as { query?: string; variables?: Record<string, unknown> }) ?? {};
      mock.requests.push({ method: req.method ?? "", path: url.pathname, auth, query: String(gql.query ?? "") });
      const json = (status: number, data: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(status, { "content-type": "application/json", ...headers });
        res.end(JSON.stringify(data));
      };
      // Paging as GitHub does it: `page`/`per_page`, and a `link` header the
      // metadata reads follow. A list that fits on one page has no next link.
      const paged = <T,>(rows: T[]) => {
        const perPage = Number(url.searchParams.get("per_page") ?? "30");
        const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
        const start = (page - 1) * perPage;
        const headers: Record<string, string> = {};
        if (start + perPage < rows.length) {
          const next = new URL(url.toString());
          next.searchParams.set("page", String(page + 1));
          headers.link = `<http://${req.headers.host}${next.pathname}${next.search}>; rel="next"`;
        }
        return json(200, rows.slice(start, start + perPage), headers);
      };
      // Octokit sends `bearer …` from GraphQL and `token …` from REST.
      const sent = auth?.replace(/^(bearer|token) /i, "");
      if (sent !== TOKEN && sent !== GH_TOKEN) return json(401, { message: "Bad credentials" });
      // The GitHub CLI's OAuth token: classic scopes, no expiry.
      if (sent === GH_TOKEN && req.method === "GET" && url.pathname === "/user") return json(200, { login: "alice", name: "Alice", avatar_url: null }, { "x-oauth-scopes": mock.ghScopes });
      if (req.method === "GET" && url.pathname === "/user") {
        return json(200, { login: "alice", name: "Alice", avatar_url: null }, { "github-authentication-token-expiration": "2027-03-01 00:00:00 UTC" });
      }
      if (req.method === "GET" && url.pathname === "/repos/acme/widgets") return json(200, { full_name: "acme/widgets", private: true });
      if (req.method === "GET" && url.pathname === "/repos/acme/widgets/issues") {
        if (mock.delayMs) await sleep(mock.delayMs);
        const state = url.searchParams.get("state") ?? "open";
        const since = url.searchParams.get("since");
        // `since` is inclusive on updated_at: it is what stops the import re-reading a page it wrote.
        const rows = issues.filter((i) => (state === "all" || i.state === state) && (!since || i.updated_at >= since));
        return paged(rows);
      }
      if (req.method === "GET" && url.pathname === "/repos/acme/widgets/labels") {
        return paged(Array.from({ length: LABEL_COUNT }, (_, i) => ({ id: 1000 + i, name: `label-${i}`, color: "blue", description: "" })));
      }
      if (req.method === "GET" && url.pathname === "/repos/acme/widgets/milestones") {
        return paged([{ number: 12, title: "Sprint 23", state: "open", due_on: null }]);
      }
      if (req.method === "GET" && url.pathname === "/repos/acme/widgets/assignees") {
        return paged([
          { id: 1, login: "alice", avatar_url: null },
          { id: 2, login: "bob", avatar_url: null },
        ]);
      }
      if (req.method === "POST" && url.pathname === "/graphql") {
        const query = String(gql.query ?? "");
        const forbidden = { data: { organization: null }, errors: [{ type: "FORBIDDEN", message: "Resource not accessible by personal access token" }] };
        if (query.includes("DeskaWriteCheck")) {
          // W0: the read-only token's write permissions, detected with read-only
          // viewerCan fields. Nothing here is writable.
          return json(200, {
            data: {
              repository: { issues: { nodes: [{ viewerCanUpdate: false, viewerCanLabel: false, viewerCanAssign: false, viewerCanClose: false }] } },
              organization: { projectV2: { viewerCanUpdate: false } },
            },
          });
        }
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
        // The sync's own reads (D5): the first import's metadata, native issue
        // types and parents, and the project items, in their paged shapes.
        if (query.includes("DeskaSyncFields")) {
          if (mock.projects === "forbidden") return json(200, forbidden);
          const p = mock.orgProjects.find((x) => x.number === Number(gql.variables?.num));
          if (!p) return json(200, { data: { organization: { projectV2: null } }, errors: [{ type: "NOT_FOUND", message: "Could not resolve to a ProjectV2" }] });
          const nodes = p.fields.map((f) => ({ id: f.id, name: f.name, dataType: f.dataType, ...(f.options ? { options: f.options } : {}), ...(f.iterations ? { configuration: { iterations: f.iterations, completedIterations: [] } } : {}) }));
          return json(200, { data: { organization: { projectV2: { id: p.id, fields: { nodes } } } } });
        }
        if (query.includes("DeskaSyncIssueTypes") || query.includes("DeskaIssueTypesCheck")) {
          return json(200, { data: { organization: { issueTypes: { totalCount: snapshot.issueTypes.length, nodes: snapshot.issueTypes } } } });
        }
        if (query.includes("DeskaIssueExtras")) {
          const ids = (gql.variables?.ids ?? []) as string[];
          const nodes = ids.map((id) => ({ id, issueType: { id: id === "I_102" ? "IT_acme_bug" : "IT_acme_task" }, parent: null }));
          return json(200, { data: { nodes } });
        }
        if (query.includes("DeskaSyncItems")) {
          const rows = [100, 101, 102].map((n, i) => ({
            id: `PVTI_${n}`,
            updatedAt: new Date(Date.UTC(2026, 9, 1) + i * 60_000).toISOString(),
            content: { id: `I_${n}` },
            fieldValues: {
              nodes: [
                { optionId: i === 0 ? "a0000001" : "a0000002", field: { id: "PVTSSF_acme_status", name: "Status" } },
                { optionId: i === 0 ? "b0000003" : "b0000002", field: { id: "PVTSSF_acme_priority", name: "Priority" } },
                { iterationId: "e0000023", field: { id: "PVTIF_acme_release", name: "Release" } },
              ],
            },
          }));
          // The paged shape even though it fits one page: the import must finish
          // on `hasNextPage: false`, not on a count.
          const after = (gql.variables?.after as string | null) ?? null;
          return json(200, { data: { organization: { projectV2: { items: { totalCount: rows.length, pageInfo: { hasNextPage: false, endCursor: null }, nodes: after ? [] : rows } } } } });
        }
        if (query.includes("projectV2")) {
          if (mock.projects === "forbidden") return json(200, { data: { organization: { projectV2: null } }, errors: [{ type: "FORBIDDEN", message: "Resource not accessible by personal access token" }] });
          return json(200, { data: { organization: { projectV2: { id: "PVT_acme_widgets_roadmap" } } } });
        }
        return json(200, { data: { organization: { issueTypes: { totalCount: 3 } } } });
      }
      return json(404, { message: "Not Found" });
    })());
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
async function launch(userData: string, github: MockGitHub, opts: { seed?: string; envTarget?: boolean; ghDir?: string } = {}): Promise<Launched> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("DESKA_") && !k.startsWith("GITHUB_")) env[k] = v;
  Object.assign(env, {
    DESKA_USER_DATA_DIR: userData,
    DESKA_DEMO_SEED: opts.seed ?? "fixtures",
    DESKA_GITHUB_API_URL: github.url,
    // The PATH `gh` is looked up on (D15): the folder with a fake `gh`, or a
    // folder with nothing in it. Never the login shell's or a system folder,
    // so no test can reach a real GitHub CLI.
    DESKA_TEST_PATH: opts.ghDir ?? path.join(userData, "no-gh"),
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
  await win.getByLabel("Repository", { exact: true }).fill("acme/widgets");
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
  await win.getByLabel("Personal access token").fill(TOKEN);
  await win.getByRole("button", { name: "Connect" }).click();
  await expect(win.getByText("Connected as")).toContainText("@alice", { timeout: 30_000 });
  await win.getByRole("button", { name: "Continue" }).click();
  await chooseProject(win, origin, "Widgets Roadmap");
  await expect(win.getByText("Bug: crash on start")).toBeVisible({ timeout: 60_000 });
}

/** A fake `gh` in `dir`: logged in as alice with GH_TOKEN, or logged out. It logs how it was called. */
function fakeGh(dir: string, state: "logged-in" | "logged-out") {
  mkdirSync(dir, { recursive: true });
  const log = `printf '%s\\n' "$*" >> "${dir}/calls.log"`;
  const body =
    state === "logged-in"
      ? `case "$1 $2" in\n  "auth token") echo "${GH_TOKEN}" ;;\n  "auth status") echo "  ✓ Logged in to github.com account alice (keyring)" ;;\n  *) exit 2 ;;\nesac`
      : `echo "no oauth token found for github.com" >&2\nexit 1`;
  writeFileSync(path.join(dir, "gh"), `#!/bin/sh\n${log}\n${body}\n`);
  chmodSync(path.join(dir, "gh"), 0o755);
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
      expect(await win.evaluate(() => Object.keys(window.deska ?? {}).sort())).toEqual(["aiKey", "appInfo", "desktop", "github", "notify", "onOpenTask", "openExternal", "quickAdd", "token", "transcribeKey"]);
      expect(await win.evaluate(() => window.deska!.appInfo())).toMatchObject({ name: "Deska", platform: "darwin" });
      // main refuses anything that is not a GitHub PAT, with its own words.
      expect(await win.evaluate(() => window.deska!.token.set("ghp_classic").then(() => "stored", (e: Error) => e.message))).toContain("GitHub personal access token");

      // The AI API key (SPEC §2.3, §4.9): main refuses a malformed one, stores a good one encrypted and answers with a status only.
      expect(await win.evaluate(() => window.deska!.aiKey!.set("has a space in it").then(() => "stored", (e: Error) => e.message))).toContain("does not look like an API key");
      const aiStatus = await win.evaluate((key) => window.deska!.aiKey!.set(key), AI_TEST_KEY);
      expect(aiStatus).toEqual({ stored: true, encryptionAvailable: true });
      expect(await win.evaluate(() => window.deska!.aiKey!.status())).toEqual({ stored: true, encryptionAvailable: true });

      await win.getByLabel("Personal access token").fill(TOKEN);
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
      // The token reads "Read-only token" in Settings (line above); this build is
      // read-only, so the edit controls name the build's write switch (W0).
      await expect(panel.getByRole("button", { name: /Close issue/ })).toHaveAttribute("title", "Editing is off for this deployment", { timeout: 60_000 });

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
      // The AI key: ciphertext on disk, nowhere in the page or any answer, no log line; "Remove key" deletes the file.
      expect(existsSync(path.join(userData, "ai-key.bin"))).toBe(true);
      expect(filesContaining(userData, AI_TEST_KEY)).toEqual([]);
      expect(logs()).not.toContain(AI_TEST_KEY);
      const aiLeaks = await win.evaluate(async (key) => {
        const texts = [document.documentElement.outerHTML, JSON.stringify({ ...localStorage }) + document.cookie];
        for (const api of ["/api/ai/settings", "/api/connection", "/api/data", "/api/local-data/export"]) texts.push(await fetch(api).then((r) => r.text()));
        return texts.filter((t) => t.includes(key)).length;
      }, AI_TEST_KEY);
      expect(aiLeaks).toBe(0);
      expect(await win.evaluate(() => window.deska!.aiKey!.clear())).toEqual({ stored: false, encryptionAvailable: true });
      expect(existsSync(path.join(userData, "ai-key.bin"))).toBe(false);
    } finally {
      await app.close();
    }
  });

  test("a token missing Projects read names the permission, also over the issue list", async () => {
    github.projects = "forbidden";
    const { app, win, origin } = await launch(userData, github);
    try {
      await win.waitForURL(`${origin}/onboarding`);
      await win.getByLabel("Personal access token").fill(TOKEN);
      await win.getByRole("button", { name: "Connect" }).click();
      await expect(win.getByText("This token is missing a permission: Organization → Projects: Read").first()).toBeVisible({ timeout: 30_000 });
      await expect(win.locator('[data-permission="projects"]')).toContainText("Missing");
      await win.getByRole("button", { name: "Continue" }).click();
      // Step 2 can't list the projects either: it names the permission, never an empty list.
      await win.getByLabel("Repository", { exact: true }).fill("acme/widgets");
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

  test("D5: an empty cache imports from GitHub with progress, then opens the issue list", async () => {
    // Each issue page is slow enough that the progress screen is observably on
    // screen before the import finishes; the import itself is real.
    github.delayMs = 3_000;
    // No seed and no env target: an empty cache and a project chosen in step 2,
    // exactly as a user's first launch.
    const { app, win, origin } = await launch(userData, github, { seed: "", envTarget: false });
    try {
      await win.waitForURL(`${origin}/onboarding`);
      await win.getByLabel("Personal access token").fill(TOKEN);
      await win.getByRole("button", { name: "Connect" }).click();
      await expect(win.getByText("Connected as")).toContainText("@alice", { timeout: 30_000 });
      await win.getByRole("button", { name: "Continue" }).click();
      await expect(win.getByRole("heading", { name: "Choose your project" })).toBeVisible({ timeout: 60_000 });
      await win.getByLabel("Repository", { exact: true }).fill("acme/widgets");
      await win.getByRole("button", { name: "Find projects" }).click();
      await win.getByRole("radio", { name: /^Widgets Roadmap/ }).check();
      await expect(win.locator("[data-mapping-form]")).toBeVisible({ timeout: 30_000 });
      await win.getByRole("button", { name: "Save and open Deska" }).click();

      // The progress screen, never a half-filled issue list (D5).
      await win.waitForURL(`${origin}/importing`, { timeout: 60_000 });
      await expect(win.getByRole("heading", { name: "Importing from GitHub" })).toBeVisible();
      await expect(win.locator("[data-import-steps] li[data-step]")).toHaveCount(4);
      // Every row's label comes from the one copy map the screen renders.
      for (const label of ["Project fields, labels and milestones", "Open issues", "Recently closed issues", "Project items"]) {
        await expect(win.getByText(label, { exact: true })).toBeVisible();
      }
      // The import pages: 120 open issues at 100 a page needs a second request.
      const issuePages = () => github.requests.filter((r) => r.path === "/repos/acme/widgets/issues").length;
      await expect.poll(issuePages, { timeout: 120_000 }).toBeGreaterThan(1);
      await expect(win.locator("[data-import-progress]")).toBeVisible();

      // When it finishes, the app opens on the issue list with GitHub's issues in it.
      await win.waitForURL(`${origin}/issues`, { timeout: 180_000 });
      // The list is virtualized: assert the rows that are on screen, not a
      // title that may be scrolled out of the window.
      await expect(win.locator("[data-row-id]").first()).toBeVisible({ timeout: 60_000 });
      const data = await win.evaluate(() => fetch("/api/data").then((r) => r.json()));
      expect(data.issues.length).toBeGreaterThan(100);
      // Wire rows are compact: `n` is the issue number.
      expect(data.issues.map((i: { n: number }) => i.n)).toContain(102);
      // The metadata followed its `link` header instead of stopping at page 1.
      expect(data.meta.labels.length).toBe(120);
      // Reads only, all along, and never a pull request (D6).
      for (const r of github.requests) {
        expect(r.method === "GET" || (r.method === "POST" && r.path === "/graphql"), `${r.method} ${r.path}`).toBe(true);
        expect(r.query).not.toMatch(/\bmutation\b/);
        expect(r.path).not.toMatch(/\/pulls\b/);
        expect(r.query).not.toMatch(/pullRequest|PullRequest/);
      }
    } finally {
      await app.close();
    }
  });

  test("D8: backups are written without the token; export → Reset everything → import restores local data", async () => {
    const { app, win, origin } = await launch(userData, github);
    try {
      await connect(win, origin);
      const call = (url: string, method: string, body?: unknown) =>
        win.evaluate(
          async ([u, m, b]) => {
            const r = await fetch(u as string, { method: m as string, headers: { "content-type": "application/json" }, body: b === undefined ? undefined : JSON.stringify(b) });
            return { status: r.status, body: await r.json().catch(() => null) };
          },
          [url, method, body] as const,
        );
      const task = await call("/api/tasks", "POST", { title: "Survives a reset" });
      expect(task.status).toBeLessThan(300);
      const view = await call("/api/views", "POST", { name: "D8 view", layout: "list", filters: [], sort: [] });
      expect(view.status).toBeLessThan(300);

      // The daily backup taken at launch and one on demand; neither holds the token.
      expect((await call("/api/local-data/backup", "POST")).status).toBe(200);
      const dir = path.join(userData, "backups");
      const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
      expect(files.some((f) => f.endsWith("-daily.json"))).toBe(true);
      expect(files.some((f) => f.endsWith("-manual.json"))).toBe(true);
      expect(filesContaining(dir, TOKEN)).toEqual([]);

      const exported = await win.evaluate(() => fetch("/api/local-data/export").then((r) => r.text()));
      expect(exported).not.toContain(TOKEN);
      expect(exported).toContain("Survives a reset");

      // Reset everything needs its confirmation, then local data is gone...
      expect((await call("/api/local-data/reset-all", "POST", {})).status).toBe(400);
      expect((await call("/api/local-data/reset-all", "POST", { confirm: "reset-everything" })).status).toBe(200);
      expect(readdirSync(dir).some((f) => f.endsWith("-reset.json"))).toBe(true);
      const empty = await win.evaluate(() => fetch("/api/data").then((r) => r.status));
      expect(empty).toBeLessThan(500);
      // ...and import brings it back.
      const imported = await win.evaluate(async (text) => {
        const r = await fetch("/api/local-data/import", { method: "POST", headers: { "content-type": "application/json" }, body: text });
        return { status: r.status, body: await r.json() };
      }, exported);
      expect(imported.status).toBe(200);
      expect(imported.body.added).toBeGreaterThan(0);
      const back = await win.evaluate(() => fetch("/api/local-data/export").then((r) => r.text()));
      expect(back).toContain("Survives a reset");
      expect(back).toContain("D8 view");
    } finally {
      await app.close();
    }
  });

  test("D15: a logged-in GitHub CLI connects without pasting; nothing of its token is stored; logged out, missing and missing a scope each say so", async () => {
    const ghDir = path.join(userData, "..", `${path.basename(userData)}-bin`);
    fakeGh(ghDir, "logged-in");
    const first = await launch(userData, github, { ghDir });
    try {
      const { win, origin } = first;
      await win.waitForURL(`${origin}/onboarding`);
      // Offered first, with the account the CLI is signed in as; then paste; then tasks only.
      const useCli = win.getByRole("button", { name: /Use my GitHub CLI login/ });
      await expect(useCli).toContainText("signed in as alice", { timeout: 60_000 });
      const order = await win.evaluate(() => {
        const y = (sel: string) => document.querySelector(sel)?.getBoundingClientRect().top ?? -1;
        return [y("[data-github-cli]"), y("#github-token"), y("[data-skip-github]")];
      });
      expect(order.every((v) => v >= 0) && order[0]! < order[1]! && order[1]! < order[2]!, JSON.stringify(order)).toBe(true);
      await useCli.click();
      await expect(win.getByText("Connected as")).toContainText("@alice", { timeout: 30_000 });
      await expect(win.locator('[data-auth-source="gh"]')).toContainText("GitHub CLI login");
      await expect(win.locator("[data-scopes]")).toHaveText("gist, read:org, read:project, repo");
      // `repo` can write: Settings says the write gate is what keeps Deska read-only.
      await expect(win.getByText(/The GitHub CLI login can also write \(gist, repo\)/)).toBeVisible();
      await win.getByRole("button", { name: "Continue" }).click();
      await chooseProject(win, origin, "Widgets Roadmap");
      await expect(win.getByText("Bug: crash on start")).toBeVisible({ timeout: 60_000 });
      await expect(win.locator("[data-connection-state]")).toHaveCount(0);
      await expect(win.locator("[data-user-menu]").first()).toContainText("alice");

      // The mock saw the CLI's token, reads only.
      expect(github.requests.some((r) => r.auth?.endsWith(GH_TOKEN))).toBe(true);
      for (const r of github.requests) expect(r.method === "GET" || (r.method === "POST" && r.path === "/graphql"), `${r.method} ${r.path}`).toBe(true);
      // Deska only reads from the CLI: never a login or a refresh.
      const calls = readFileSync(path.join(ghDir, "calls.log"), "utf8").trim().split("\n");
      expect([...new Set(calls)].sort()).toEqual(["auth status --hostname github.com", "auth token --hostname github.com"]);

      // No token file, and the token is in no file of the profile: only the choice of source is stored.
      expect(existsSync(path.join(userData, "github-token.bin"))).toBe(false);
      expect(filesContaining(userData, GH_TOKEN)).toEqual([]);
      expect(JSON.parse(readFileSync(path.join(userData, "desktop-prefs.json"), "utf8"))).toMatchObject({ githubAuthSource: "gh" });
      expect(first.logs()).not.toContain(GH_TOKEN);
      // Nor in any process's arguments or environment (macOS shows both for one's own processes).
      expect(execFileSync("ps", ["-A", "-ww", "-E", "-o", "command="], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })).not.toContain(GH_TOKEN);
      // Nor anywhere the renderer can reach.
      const leaks = await win.evaluate(async (token) => {
        const found: string[] = [];
        if (document.documentElement.outerHTML.includes(token)) found.push("DOM");
        for (const api of ["/api/connection?refresh=1", "/api/data", "/api/sync-status", "/api/local-data/export"]) {
          if ((await fetch(api).then((r) => r.text())).includes(token)) found.push(api);
        }
        return found;
      }, GH_TOKEN);
      expect(leaks).toEqual([]);
    } finally {
      await first.app.close();
    }

    // A relaunch reads the token from the CLI again: no onboarding, nothing stored in between.
    const second = await launch(userData, github, { ghDir });
    try {
      const { win, origin } = second;
      await win.goto(`${origin}/settings`);
      await expect(win.locator('[data-connection-summary="ok"]')).toContainText("@alice", { timeout: 60_000 });
      await expect(win.locator('[data-auth-source="gh"]')).toBeVisible();
      const again = win.getByRole("button", { name: "Check again" }).first();

      // Logged out of the CLI: its own message, the command to run, and the way to a pasted token.
      fakeGh(ghDir, "logged-out");
      await again.click();
      await expect(win.locator('[data-connection-summary="gh-logged-out"]')).toContainText("GitHub CLI isn't logged in", { timeout: 30_000 });
      await expect(win.locator('[data-connection-summary] [data-command]')).toHaveText("gh auth login");
      const banner = win.locator('[data-connection-state="gh-logged-out"]');
      await expect(banner).toContainText("GitHub CLI isn't logged in");
      await expect(banner.getByRole("link", { name: "Paste a token instead" })).toBeVisible();
      await expect(win.getByRole("heading", { name: "Paste a token instead" })).toBeVisible();
      // The cached data stays up, under the banner: an error is never an empty list.
      await win.goto(`${origin}/issues`);
      await expect(win.getByText("Bug: crash on start")).toBeVisible({ timeout: 60_000 });
      await expect(win.locator('[data-connection-state="gh-logged-out"]')).toBeVisible();

      // The CLI gone from the PATH: a different message.
      rmSync(path.join(ghDir, "gh"));
      await win.locator("[data-connection-state]").getByRole("button", { name: "Check again" }).click();
      await expect(win.locator('[data-connection-state="gh-not-found"]')).toContainText("GitHub CLI isn't installed", { timeout: 30_000 });

      // Back, but the login lacks read:project: the scope and the exact command.
      github.ghScopes = "gist, read:org, repo";
      fakeGh(ghDir, "logged-in");
      await win.locator("[data-connection-state]").getByRole("button", { name: "Check again" }).click();
      const scope = win.locator('[data-connection-state="missing-scope"]');
      await expect(scope).toContainText("Your GitHub CLI login is missing the read:project scope", { timeout: 30_000 });
      await expect(scope).toContainText("gh auth refresh -h github.com -s read:project");

      // The scope added: connected again, without a restart.
      github.ghScopes = "gist, project, read:org, repo";
      await scope.getByRole("button", { name: "Check again" }).click();
      await expect(win.locator("[data-connection-state]")).toHaveCount(0, { timeout: 30_000 });

      // "Paste a token instead": the source switches, and now a token file exists (encrypted).
      await win.goto(`${origin}/settings`);
      await win.getByLabel("Personal access token").fill(TOKEN);
      await win.getByRole("button", { name: "Use this token" }).click();
      await expect(win.locator('[data-auth-source="token"]')).toBeVisible({ timeout: 30_000 });
      expect(existsSync(path.join(userData, "github-token.bin"))).toBe(true);
      expect(JSON.parse(readFileSync(path.join(userData, "desktop-prefs.json"), "utf8"))).toMatchObject({ githubAuthSource: "token" });
      expect(filesContaining(userData, GH_TOKEN)).toEqual([]);
      expect(filesContaining(userData, TOKEN)).toEqual([]);
      // And back from Settings: the stored token is deleted again.
      await win.getByRole("button", { name: /^Use GitHub CLI login/ }).click();
      await expect(win.locator('[data-auth-source="gh"]')).toBeVisible({ timeout: 30_000 });
      expect(existsSync(path.join(userData, "github-token.bin"))).toBe(false);
      expect(second.logs()).not.toContain(GH_TOKEN);
    } finally {
      await second.app.close();
      rmSync(ghDir, { recursive: true, force: true });
    }
  });

  test("D15: without a GitHub CLI, onboarding offers only the token and tasks only", async () => {
    const { app, win, origin } = await launch(userData, github);
    try {
      await win.waitForURL(`${origin}/onboarding`);
      await expect(win.getByRole("heading", { name: "Paste a token" })).toBeVisible({ timeout: 60_000 });
      await expect(win.getByRole("button", { name: /GitHub CLI/ })).toHaveCount(0);
      await expect(win.locator("[data-skip-github]")).toBeVisible();
      expect(await win.evaluate(() => window.deska!.github!.status())).toEqual({ source: "token", cli: "not-found", cliLogin: null });
      // Asking to use a CLI that isn't there changes nothing.
      expect(await win.evaluate(() => window.deska!.github!.useCli())).toMatchObject({ source: "token", cli: "not-found" });
      expect(existsSync(path.join(userData, "desktop-prefs.json")) ? JSON.parse(readFileSync(path.join(userData, "desktop-prefs.json"), "utf8")).githubAuthSource : "token").toBe("token");
    } finally {
      await app.close();
    }
  });

  test("the connection and a saved view survive a relaunch; disconnecting returns to onboarding", async () => {
    const view = { name: "Smoke: open bugs", layout: "list", filters: [{ field: "state", op: "in", values: ["open"] }], sort: [] };
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
      await win.getByLabel("Personal access token").fill(TOKEN);
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
      await expect(win.getByRole("link", { name: "Releases", exact: true })).toHaveCount(0);
      await expect(win.getByRole("link", { name: /^Backlog/ })).toHaveCount(0);
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
      await expect(win.getByRole("link", { name: "Releases", exact: true })).toBeVisible({ timeout: 30_000 });
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
  // --- D12: desktop-native tasks -------------------------------------------------

  /** A call to the local API from the app window. */
  const api = (page: Page, method: string, url: string, body?: unknown) =>
    page.evaluate(
      async ([m, u, b]) => {
        const r = await fetch(u as string, { method: m as string, headers: { "content-type": "application/json" }, body: b === undefined ? undefined : JSON.stringify(b) });
        return { status: r.status, body: await r.json().catch(() => null) };
      },
      [method, url, body] as const,
    );

  /**
   * Closes every window; the app keeps running (SPEC §4.6). Playwright's Electron driver
   * (not the app: an empty Electron app with a no-op `window-all-closed` does the same)
   * lets the process exit a few seconds after the last window closed, so no test waits
   * with zero windows; the "no window" case is checked by hand (Maintainer to-do).
   */
  const closeAllWindows = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.close()));

  /** Opens the main window again, as a Dock click does. */
  async function reopen(app: ElectronApplication): Promise<Page> {
    const next = app.waitForEvent("window");
    await app.evaluate(({ app: a }) => a.emit("activate"));
    const page = await next;
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60_000 });
    return page;
  }

  test("D12: the global shortcut opens the floating quick add; Enter saves and closes, Esc closes", async () => {
    const { app, win, origin } = await launch(userData, github);
    try {
      await connect(win, origin);
      expect(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered("Control+Alt+Space"))).toBe(true);
      // The shortcut's own callback, without the keyboard.
      const quick = app.waitForEvent("window");
      await app.evaluate(({ app: a }) => a.emit("deska:quick-add"));
      const q = await quick;
      await q.waitForURL(/\/quick-add$/, { timeout: 60_000 });
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.isAlwaysOnTop()).length)).toBe(1);
      await q.getByRole("combobox", { name: "Task" }).fill("Water the plants tomorrow high");
      await q.keyboard.press("Enter");
      await q.waitForEvent("close", { timeout: 30_000 });

      const tasks = (await api(win, "GET", "/api/tasks")).body.tasks as { title: string; dueDate: string | null; priority: number }[];
      const saved = tasks.find((t) => t.title === "Water the plants");
      expect(saved, "the task is saved with its parsed properties").toBeTruthy();
      expect(saved!.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(saved!.priority).toBe(2);

      // Esc closes without saving; nothing was written.
      const again = app.waitForEvent("window");
      await app.evaluate(({ app: a }) => a.emit("deska:quick-add"));
      const q2 = await again;
      await q2.waitForURL(/\/quick-add$/, { timeout: 60_000 });
      await q2.getByRole("combobox", { name: "Task" }).fill("Never saved");
      // Escape closes the window under the key press itself, so the press may report a closed page.
      await Promise.all([q2.waitForEvent("close", { timeout: 30_000 }), q2.keyboard.press("Escape").catch(() => undefined)]);
      const after = (await api(win, "GET", "/api/tasks")).body.tasks as { title: string }[];
      expect(after.some((t) => t.title === "Never saved")).toBe(false);
      // It opened over the app and never gave the window a second origin.
      expect(win.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
    } finally {
      await app.close();
    }
  });

  test("D12: Settings → Desktop changes the shortcut (and keeps the old one when the new is refused), the badge and survives a relaunch", async () => {
    const first = await launch(userData, github);
    try {
      await connect(first.win, first.origin);
      await first.win.goto(`${first.origin}/settings`);
      await expect(first.win.getByRole("heading", { name: "Desktop" })).toBeVisible({ timeout: 60_000 });
      await expect(first.win.getByTestId("shortcut-capture")).toHaveText("⌃⌥Space");
      // Capture a new one with the keyboard.
      await first.win.getByTestId("shortcut-capture").click();
      await first.win.keyboard.press("Control+Alt+K");
      await expect(first.win.getByTestId("shortcut-capture")).toHaveText("⌃⌥K", { timeout: 15_000 });
      const registered = (acc: string) => first.app.evaluate(({ globalShortcut }, a) => globalShortcut.isRegistered(a), acc);
      expect(await registered("Control+Alt+K")).toBe(true);
      expect(await registered("Control+Alt+Space")).toBe(false);

      // A refused shortcut is reported and the working one stays.
      const refused = await first.win.evaluate(() => window.deska!.desktop.set({ shortcut: "A" }));
      expect(refused.error).toMatch(/shortcut/);
      expect(refused.state.prefs.shortcut).toBe("Control+Alt+K");
      expect(await registered("Control+Alt+K")).toBe(true);

      await first.win.evaluate(() => window.deska!.desktop.set({ dockBadge: false }));

      // App icon (1.1.2): Settings shows all eight, Coral selected; a pick sets the Dock icon at once.
      // The ⌃⌥K keystrokes above also open the ⌘K palette (⌃K): close it by its backdrop.
      if (await first.win.locator(".bg-underlay").count()) await first.win.locator(".bg-underlay").click({ position: { x: 5, y: 5 } });
      await expect(first.win.locator(".bg-underlay")).toHaveCount(0);
      await expect(first.win.locator("[data-app-icon]")).toHaveCount(8);
      await expect(first.win.locator('[data-app-icon="coral"]')).toHaveAttribute("aria-pressed", "true");
      await expect.poll(() => first.win.locator('[data-app-icon="violet"] img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(128);
      await first.win.locator('[data-app-icon="violet"]').click();
      await expect(first.win.locator('[data-app-icon="violet"]')).toHaveAttribute("aria-pressed", "true");
     
      const refusedIcon = await first.win.evaluate(() => window.deska!.desktop.set({ appIcon: "../icon" as never }));
      expect(refusedIcon.error).toMatch(/app icon/);
      expect(refusedIcon.state.prefs.appIcon).toBe("violet");
    } finally {
      await first.app.close();
    }
    // The prefs file keeps no secret and is read again on the next launch.
    expect(JSON.parse(readFileSync(path.join(userData, "desktop-prefs.json"), "utf8"))).toEqual({ shortcut: "Control+Alt+K", notifications: true, launchAtLogin: false, dockBadge: false, backupFolder: "", githubAuthSource: "token", appIcon: "violet" });
    const second = await launch(userData, github);
    try {
      expect(await second.app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered("Control+Alt+K"))).toBe(true);
      expect(await second.win.evaluate(() => window.deska!.desktop.get().then((s) => s.prefs.dockBadge))).toBe(false);
      expect(await second.win.evaluate(() => window.deska!.desktop.get().then((s) => s.prefs.appIcon))).toBe("violet");
    } finally {
      await second.app.close();
    }
  });

  test("D12: the Dock badge matches Today (overdue + due today) and clears when tasks are done", async () => {
    const { app, win, origin } = await launch(userData, github);
    try {
      await connect(win, origin);
      const badge = () => app.evaluate(({ app: a }) => a.dock?.getBadge() ?? "");
      const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
      await api(win, "POST", "/api/tasks", { title: "Overdue", dueDate: day(-3) });
      const today = await api(win, "POST", "/api/tasks", { title: "Due today", dueDate: day(0) });
      await api(win, "POST", "/api/tasks", { title: "Next week", dueDate: day(7) });
      await expect.poll(badge, { timeout: 30_000 }).toBe("2");
      await api(win, "PATCH", `/api/tasks/${today.body.task.id}`, { completed: true });
      await expect.poll(badge, { timeout: 30_000 }).toBe("1");
      // Off: no badge, whatever the count.
      await win.evaluate(() => window.deska!.desktop.set({ dockBadge: false }));
      await expect.poll(badge, { timeout: 15_000 }).toBe("");
    } finally {
      await app.close();
    }
  });

  test("D12: a reminder becomes a native notification from the server's own timer; Complete and Snooze work; with notifications off the bell still has it", async () => {
    const { app, win, origin, logs } = await launch(userData, github);
    try {
      await connect(win, origin);
      const soon = () => new Date(Date.now() + 3_000).toISOString();
      const a = await api(win, "POST", "/api/tasks", { title: "Reminder A", reminders: [{ kind: "absolute", at: soon() }] });
      const b = await api(win, "POST", "/api/tasks", { title: "Reminder B", reminders: [{ kind: "absolute", at: soon() }] });
      // Whoever fires it first (the page's poll or the server's 30 s timer), main shows it once; the
      // timer alone is covered in tests/tasks/desktop-reminders.test.ts (no page polling at all).
      const started = Date.now();
      for (const t of [a, b]) {
        await expect.poll(() => logs().includes(`reminder notification shown for task ${t.body.task.id}`), { timeout: 60_000, intervals: [1_000] }).toBe(true);
      }
      expect(Date.now() - started).toBeLessThan(60_000);
      expect(logs()).not.toContain("Reminder A"); // titles never reach the log

      const page = win;
      const notes = (await api(page, "GET", "/api/notifications")).body as { list: { id: string; taskId: string }[]; unread: number };
      const forA = notes.list.find((n) => n.taskId === a.body.task.id)!;
      const forB = notes.list.find((n) => n.taskId === b.body.task.id)!;
      expect(forA && forB).toBeTruthy();

      // The buttons: Complete finishes A and marks its notification read; Snooze 1 h and Tomorrow add a reminder to B.
      await app.evaluate(({ app: x }, args) => x.emit("deska:reminder-action", args.item, "complete"), { item: { notificationId: forA.id, taskId: a.body.task.id, title: "Reminder A" } });
      await expect
        .poll(async () => ((await api(page, "GET", `/api/tasks/${a.body.task.id}`)).body.task as { completedAt: string | null }).completedAt, { timeout: 15_000 })
        .not.toBeNull();
      await app.evaluate(({ app: x }, args) => x.emit("deska:reminder-action", args.item, "snooze1h"), { item: { notificationId: forB.id, taskId: b.body.task.id, title: "Reminder B" } });
      await expect
        .poll(async () => ((await api(page, "GET", `/api/tasks/${b.body.task.id}`)).body.task as { reminders: { at: string }[] }).reminders.map((r) => Date.parse(r.at) - Date.now()).filter((ms) => ms > 55 * 60_000 && ms <= 61 * 60_000).length, { timeout: 15_000 })
        .toBe(1);
      await expect.poll(async () => ((await api(page, "GET", "/api/notifications")).body as { list: { id: string; readAt: string | null }[] }).list.filter((n) => n.id === forA.id || n.id === forB.id).every((n) => n.readAt), { timeout: 15_000 }).toBe(true);

      // Notifications off: the reminder still reaches the bell, but no banner is shown.
      await page.evaluate(() => window.deska!.desktop.set({ notifications: false }));
      const c = await api(page, "POST", "/api/tasks", { title: "Reminder C", reminders: [{ kind: "absolute", at: soon() }] });
      await expect
        .poll(async () => ((await api(page, "GET", "/api/notifications")).body as { list: { taskId: string }[] }).list.some((n) => n.taskId === c.body.task.id), { timeout: 60_000, intervals: [1_000] })
        .toBe(true);
      expect(logs()).not.toContain(`reminder notification shown for task ${c.body.task.id}`);
    } finally {
      await app.close();
    }
  });

  test("D12: closing the window keeps Deska running; the Dock click brings a window back", async () => {
    const { app, win, origin } = await launch(userData, github);
    try {
      await connect(win, origin);
      await closeAllWindows(app);
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), { timeout: 15_000 }).toBe(0);
      // The server is still answering: main talks to it, the window is gone.
      const page = await reopen(app);
      expect((await api(page, "GET", "/api/tasks")).status).toBe(200);
    } finally {
      await app.close();
    }
  });

  test("tasks only: skipping GitHub opens the tasks app, tasks work with no token, it survives a restart, and connecting later switches it off", async () => {
    // No seed, no env target, no token: a first launch that never connects GitHub.
    let session = await launch(userData, github, { seed: "", envTarget: false });
    try {
      await session.win.waitForURL(`${session.origin}/onboarding`);
      await session.win.locator("[data-skip-github]").click();
      await session.win.waitForURL(`${session.origin}/tasks`, { timeout: 60_000 });
      // No GitHub screens in the way: no issue links, a way back to GitHub, no connection banner.
      await expect(session.win.getByRole("link", { name: "Connect GitHub" })).toBeVisible({ timeout: 60_000 });
      await expect(session.win.getByRole("link", { name: "All issues" })).toHaveCount(0);
      await expect(session.win.locator("[data-connection-state]")).toHaveCount(0);
      // Tasks are saved without a token (no 401).
      const created = await session.win.evaluate(() =>
        fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Buy milk" }) }).then((r) => r.status),
      );
      expect(created).toBeLessThan(300);
      // Nothing went to GitHub.
      expect(github.requests).toHaveLength(0);
    } finally {
      await session.app.close();
    }

    // The choice is remembered: the next launch opens the app, not onboarding.
    session = await launch(userData, github, { seed: "", envTarget: false });
    try {
      await session.win.goto(`${session.origin}/`);
      await session.win.waitForURL(`${session.origin}/tasks`, { timeout: 60_000 });
      const titles = await session.win.evaluate(() => fetch("/api/tasks").then((r) => r.json()).then((b: { tasks: { title: string }[] }) => b.tasks.map((t) => t.title)));
      expect(titles).toContain("Buy milk");

      // Connecting GitHub from the sidebar ends tasks-only mode.
      await session.win.getByRole("link", { name: "Connect GitHub" }).click();
      await expect(session.win.getByRole("heading", { name: "Connect GitHub" })).toBeVisible({ timeout: 60_000 });
      await session.win.getByLabel("Personal access token").fill(TOKEN);
      await session.win.getByRole("button", { name: "Connect" }).click();
      await expect(session.win.getByText("Connected as")).toContainText("@alice", { timeout: 30_000 });
      await session.win.getByRole("button", { name: "Continue" }).click();
      await chooseProject(session.win, session.origin, "Widgets Roadmap");
      await expect(session.win.getByRole("link", { name: "All issues" })).toBeVisible({ timeout: 120_000 });
      expect(await session.win.evaluate(() => fetch("/api/settings/mode").then((r) => r.json()))).toEqual({ tasksOnly: false });
    } finally {
      await session.app.close();
    }
  });
});
