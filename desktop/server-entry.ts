// The local server process (SPEC §2.1). In the app it runs in Electron's
// utilityProcess; `pnpm desktop:dev` forks it with plain Node instead, because
// `next dev` needs a real Node binary.
//
// Main sends one "start" message over IPC with the port, the per-launch secret
// and the database directory. They go into this process's environment only
// (never into a spawn environment, a file or a log), then the Next.js server
// starts on 127.0.0.1:<port>, in this process, so the GitHub token main sends
// next is visible to every request handler (SPEC §2.3: memory only).
import http from "node:http";
import path from "node:path";
import type { ServerMessage, ServerReply } from "./bridge";

type Port = { on(event: "message", fn: (e: { data: ServerMessage }) => void): void; postMessage(msg: unknown): void };

const parentPort = (process as unknown as { parentPort?: Port }).parentPort;

function onMessage(fn: (msg: ServerMessage) => void) {
  if (parentPort) parentPort.on("message", (e) => fn(e.data));
  else process.on("message", (msg) => fn(msg as ServerMessage));
}

function reply(msg: ServerReply) {
  if (parentPort) parentPort.postMessage(msg);
  else process.send?.(msg);
}

// The same globalThis slots lib/github/local-token.ts reads.
const TOKEN = Symbol.for("deska.githubToken");
const TOKEN_STATE = Symbol.for("deska.githubTokenState");
const DB = Symbol.for("deska.db");
// lib/sync/service.ts, registered when the Next server starts.
const SYNC = Symbol.for("deska.syncService");
// lib/desktop/reminders.ts sends reminders and the badge count to main through this.
const MAIN = Symbol.for("deska.mainChannel");
(globalThis as Record<symbol, unknown>)[MAIN] = (msg: ServerReply) => reply(msg);
let started = false;

type SyncHandle = { request(reason: string): Promise<unknown>; stop(): Promise<void> };
const syncHandle = () => (globalThis as Record<symbol, SyncHandle | undefined>)[SYNC];

/** Ask the sync service for a run, if it is up (it runs one on start anyway). */
function requestSync(reason: "wake" | "token") {
  syncHandle()
    ?.request(reason)
    .catch((e: unknown) => console.error(`deska: sync request failed: ${e instanceof Error ? e.message : String(e)}`));
}

function setToken(token: string | null, source: "launch" | "user") {
  const g = globalThis as Record<symbol, unknown>;
  const prev = (g[TOKEN_STATE] as { generation?: number; changedByUser?: boolean } | undefined) ?? {};
  g[TOKEN] = token ?? undefined;
  g[TOKEN_STATE] = { generation: (prev.generation ?? 0) + 1, changedByUser: !!prev.changedByUser || source === "user" };
}

async function stop() {
  // A running import stops after the page it is writing; its checkpoint is
  // where the next launch resumes.
  try {
    await syncHandle()?.stop();
  } catch {
    /* quitting anyway */
  }
  // PGlite flushes and releases its data directory on close.
  const db = (globalThis as Record<symbol, { pg?: { close(): Promise<void>; closed?: boolean } } | undefined>)[DB];
  try {
    if (db?.pg && !db.pg.closed) await db.pg.close();
  } finally {
    process.exit(0);
  }
}

type NextApp = {
  prepare(): Promise<void>;
  getRequestHandler(): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>;
  getUpgradeHandler?(): (req: http.IncomingMessage, socket: unknown, head: Buffer) => Promise<void>;
};

/** `next dev` in this process (the CLI would fork a child the token never reaches). */
async function startDev(serverDir: string, port: number) {
  process.chdir(serverDir);
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- a runtime path, loaded after the env is set
  const next = require(path.join(serverDir, "node_modules", "next")) as (opts: Record<string, unknown>) => NextApp;
  const app = next({ dev: true, dir: serverDir, hostname: "127.0.0.1", port });
  await app.prepare();
  const handle = app.getRequestHandler();
  const server = http.createServer((req, res) => void handle(req, res));
  const upgrade = app.getUpgradeHandler?.();
  if (upgrade) server.on("upgrade", (req, socket, head) => void upgrade(req, socket, head));
  server.listen(port, "127.0.0.1", () => console.log(`deska: dev server on http://127.0.0.1:${port}`));
}

function start(msg: Extract<ServerMessage, { type: "start" }>) {
  if (started) return;
  started = true;
  Object.assign(process.env, msg.env, {
    HOSTNAME: "127.0.0.1",
    PORT: String(msg.port),
    DESKA_DESKTOP: "1",
    DESKA_HOST: `127.0.0.1:${msg.port}`,
    DESKA_LAUNCH_SECRET: msg.secret,
    DESKA_DB_DIR: msg.dbDir,
  });
  if (msg.mode === "production") {
    Object.assign(process.env, { NODE_ENV: "production", DESKA_MIGRATIONS_DIR: path.join(msg.serverDir, "drizzle") });
    // The standalone server changes into its own folder and listens on HOSTNAME:PORT.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- a runtime path, loaded after the env is set
    require(path.join(msg.serverDir, "server.js"));
    return;
  }
  startDev(msg.serverDir, msg.port).catch((e) => {
    console.error(`deska: the dev server failed to start: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}

onMessage((msg) => {
  if (msg.type === "start") start(msg);
  else if (msg.type === "token") {
    setToken(msg.token, msg.source);
    reply({ type: "token-ack", id: msg.id });
    if (msg.token) requestSync("token");
  } else if (msg.type === "sync") requestSync(msg.reason);
  else if (msg.type === "stop") void stop();
});
