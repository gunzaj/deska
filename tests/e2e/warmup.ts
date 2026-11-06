// Playwright global setup.
//
// `next dev` compiles each route on first request, and the app shell pulls in
// several API routes. Compile them once up front so the first test isn't
// measured against a cold compiler. (The database server seeds itself on
// start: instrumentation-node.ts with DESKA_DEMO_SEED=fixtures.)
const ROUTES = ["/my", "/tasks", "/pulls", "/pulls/review", "/issues/102", "/views/seed-untriaged", "/backlog", "/tasks/delegated", "/api/data", "/api/views", "/api/tasks", "/api/tasks/00000000-0000-0000-0000-000000000000", "/api/prs", "/api/notifications", "/api/me/prefs", "/triage", "/triage/run", "/releases/plan", "/releases/e0000023", "/insights", "/watching", "/api/triage/snoozes", "/api/watches", "/api/releases/e0000023/scope-added?since=2026-10-01"];

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
  await warm("http://localhost:3100");
  await warm("http://localhost:3101");
}
