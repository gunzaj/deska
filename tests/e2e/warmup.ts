// Playwright global setup.
//
// `next dev` compiles each route on first request, and the app shell pulls in
// several API routes. Compile them once up front so the first test isn't
// measured against a cold compiler. (The database server seeds itself on
// start: instrumentation-node.ts with DESKA_DEMO_SEED=fixtures.)
// Every page the specs open (a dynamic segment takes any id: it compiles the
// route either way). A page left cold compiles inside its first test, which on
// a loaded machine outlasts the 15 s assertion timeout (issue #6).
const PAGES = ["/issues", "/board", "/epics", "/views", "/views/new", "/watching", "/releases", "/tasks/today", "/tasks/upcoming", "/tasks/completed", "/tasks/p/warm", "/tasks/l/warm", "/tasks/views/warm", "/teams/warm", "/quick-add", "/importing", "/releases/e0000022"];
const ROUTES = [...PAGES, "/my", "/tasks", "/issues/102", "/views/seed-untriaged", "/backlog", "/api/data", "/api/views", "/api/tasks", "/api/tasks/00000000-0000-0000-0000-000000000000", "/api/tasks/00000000-0000-0000-0000-000000000000/restore", "/api/notifications", "/api/me/prefs", "/triage", "/triage/run", "/releases/plan", "/releases/e0000023", "/insights", "/watching", "/api/triage/snoozes", "/api/watches", "/api/releases/e0000023/scope-added?since=2026-10-01", "/settings", "/api/connection", "/api/tasks/completed", "/api/tasks/search?q=warm", "/api/task-projects", "/api/task-labels", "/api/task-sections", "/api/ai/settings", "/api/settings/close", "/api/settings/theme", "/api/settings/writes", "/api/settings/mode", "/api/outbox", "/api/sync-status"];

async function warm(base: string) {
  for (const r of ROUTES) {
    try {
      await fetch(`${base}${r}`, { headers: { "x-e2e-login": "alice" }, signal: AbortSignal.timeout(180_000) });
    } catch {
      /* the test itself will report a real failure */
    }
  }
}

async function warmAnonymous(base: string) {
  try {
    await fetch(`${base}/onboarding`, { signal: AbortSignal.timeout(180_000) });
  } catch {
    /* reported by the test */
  }
}

export default async function warmup() {
  await warmAnonymous("http://localhost:3100");
  await warm("http://localhost:3100");
  await warm("http://localhost:3101");
  await warmAnonymous("http://localhost:3102");
  await warm("http://localhost:3102");
}
