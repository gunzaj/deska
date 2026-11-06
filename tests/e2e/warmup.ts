// Playwright global setup.
//
// 1. With TEST_DATABASE_URL: reset the e2e database and seed it with
//    `pnpm sync:full --db` (fixtures), so the e2e-postgres project starts from
//    the same data as the mocked one.
// 2. `next dev` compiles each route on first request, and the app shell pulls
//    in several API routes. Compile them once up front so the first test isn't
//    measured against a cold compiler.
import { execSync } from "node:child_process";
import { Client } from "pg";

const ROUTES = ["/my", "/tasks", "/pulls", "/pulls/review", "/issues/102", "/views/seed-untriaged", "/backlog", "/tasks/delegated", "/api/data", "/api/views", "/api/tasks", "/api/tasks/00000000-0000-0000-0000-000000000000", "/api/prs", "/api/notifications", "/api/me/prefs", "/triage", "/triage/run", "/releases/plan", "/releases/e0000023", "/insights", "/watching", "/api/triage/snoozes", "/api/watches", "/api/releases/e0000023/scope-added?since=2026-10-01"];

async function seed(url: string) {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    // Everything but the migration bookkeeping: earlier test runs leave rows.
    const { rows } = await c.query<{ name: string }>(`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'`);
    if (rows.length) await c.query(`TRUNCATE ${rows.map((r) => `"${r.name}"`).join(", ")} RESTART IDENTITY CASCADE`);
  } finally {
    await c.end();
  }
  execSync("pnpm sync:full --db", { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });
}

async function warm(base: string) {
  for (const r of ROUTES) {
    try {
      await fetch(`${base}${r}`, { headers: { "x-e2e-login": "alice" }, signal: AbortSignal.timeout(180_000) });
    } catch {
      /* the test itself will report a real failure */
    }
  }
}

export default async function warmup() {
  const pg = process.env.TEST_DATABASE_URL?.trim();
  if (pg) await seed(pg);
  await warm("http://localhost:3100");
  if (pg) await warm("http://localhost:3101");
}
