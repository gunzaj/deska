// The local server process (SPEC §2.1). In the app it runs in Electron's
// utilityProcess; `pnpm desktop:dev` forks it with plain Node instead, because
// `next dev` forks its own workers and needs a real Node binary.
//
// Main sends one "start" message over IPC with the port, the per-launch secret
// and the database directory. They go into this process's environment only
// (never into a spawn environment, a file or a log), then the Next.js server
// starts on 127.0.0.1:<port>.
import path from "node:path";
import type { ServerMessage } from "./bridge";

type Port = { on(event: "message", fn: (e: { data: ServerMessage }) => void): void; postMessage(msg: unknown): void };

const parentPort = (process as unknown as { parentPort?: Port }).parentPort;

function onMessage(fn: (msg: ServerMessage) => void) {
  if (parentPort) parentPort.on("message", (e) => fn(e.data));
  else process.on("message", (msg) => fn(msg as ServerMessage));
}

const TOKEN = Symbol.for("deska.githubToken");
const DB = Symbol.for("deska.db");
let started = false;

async function stop() {
  // PGlite flushes and releases its data directory on close.
  const db = (globalThis as Record<symbol, { pg?: { close(): Promise<void>; closed?: boolean } } | undefined>)[DB];
  try {
    if (db?.pg && !db.pg.closed) await db.pg.close();
  } finally {
    process.exit(0);
  }
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
  process.chdir(msg.serverDir);
  process.argv = [process.argv[0]!, "next", "dev", "--hostname", "127.0.0.1", "--port", String(msg.port)];
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- a runtime path, loaded after the env is set
  require(path.join(msg.serverDir, "node_modules", "next", "dist", "bin", "next"));
}

onMessage((msg) => {
  if (msg.type === "start") start(msg);
  else if (msg.type === "token") (globalThis as Record<symbol, unknown>)[TOKEN] = msg.token ?? undefined;
  else if (msg.type === "stop") void stop();
});
