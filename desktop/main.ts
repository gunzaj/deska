// Electron main process (SPEC §2). Starts the local Next.js server in a
// utilityProcess on 127.0.0.1 and a random free port, sets the per-launch
// secret cookie on the window session, and opens the window on that origin.
// Navigation is locked to the app; https://github.com/ opens in the default
// browser; every other URL and request is blocked (§2.2).
import { fork, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Notification, safeStorage, session, shell, utilityProcess, type IpcMainInvokeEvent, type UtilityProcess, type WebContents } from "electron";
import { CHANNELS, type ServerMessage, type TokenStatus } from "./bridge";
import { classifyUrl, requestAllowed } from "./navigation";

const LAUNCH_COOKIE = "deska_launch"; // lib/desktop/guard.ts
const DEV = process.env.DESKA_DESKTOP_DEV === "1";

app.setName("Deska");
// Tests run the app against a throwaway profile.
if (process.env.DESKA_USER_DATA_DIR) app.setPath("userData", path.resolve(process.env.DESKA_USER_DATA_DIR));

// One app per profile: two servers on one database directory would corrupt it.
if (!app.requestSingleInstanceLock()) app.quit();

type Server = { origin: string; send(msg: ServerMessage): void; kill(): void; onExit(fn: (code: number | null) => void): void };

let server: Server | null = null;
let mainWindow: BrowserWindow | null = null;
let quitting = false;

function log(msg: string) {
  console.log(`deska: ${msg}`);
}

/** A free port on 127.0.0.1, chosen by the OS. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      s.close(() => (addr && typeof addr === "object" ? resolve(addr.port) : reject(new Error("no port"))));
    });
  });
}

/** Where the server code lives: the packaged resources, a staged build, or the repo in dev. */
function serverLocation(): { mode: "production" | "development"; serverDir: string } {
  const repoRoot = path.resolve(__dirname, "..", "..");
  if (DEV) return { mode: "development", serverDir: repoRoot };
  if (app.isPackaged) return { mode: "production", serverDir: path.join(process.resourcesPath, "server") };
  return { mode: "production", serverDir: path.join(repoRoot, "desktop", "build", "server") };
}

function startServerProcess(port: number, secret: string): Server {
  const { mode, serverDir } = serverLocation();
  if (mode === "production" && !existsSync(path.join(serverDir, "server.js"))) {
    throw new Error(`no server build in ${serverDir}; run pnpm desktop:build`);
  }
  const userData = app.getPath("userData");
  const dbDir = path.join(userData, DEV ? "db-dev" : "db");
  mkdirSync(dbDir, { recursive: true });
  const start: ServerMessage = {
    type: "start",
    mode,
    serverDir,
    port,
    secret,
    dbDir,
    env: {
      // Until onboarding (D3): the fictional demo dataset and its user.
      DESKA_DEMO_SEED: process.env.DESKA_DEMO_SEED === "fixtures" ? "fixtures" : "demo",
      DESKA_LOCAL_LOGIN: "alice",
    },
  };
  const entry = path.join(__dirname, "server-entry.js");
  // The child's environment carries no secret: those arrive over IPC.
  const env = { ...process.env } as Record<string, string>;
  for (const k of Object.keys(env)) if (k.startsWith("DESKA_") || k === "ELECTRON_RUN_AS_NODE") delete env[k];
  const origin = `http://127.0.0.1:${port}`;

  if (mode === "development") {
    // `next dev` forks workers, so it needs a real Node, not Electron's.
    const child: ChildProcess = fork(entry, [], { cwd: serverDir, env: env as NodeJS.ProcessEnv, execPath: process.env.DESKA_NODE ?? "node", stdio: "inherit" });
    child.send(start);
    return {
      origin,
      send: (m) => child.connected && child.send(m),
      kill: () => child.kill(),
      onExit: (fn) => child.on("exit", fn),
    };
  }
  const child: UtilityProcess = utilityProcess.fork(entry, [], { cwd: serverDir, env, serviceName: "Deska server", stdio: "inherit" });
  child.postMessage(start);
  return {
    origin,
    send: (m) => child.postMessage(m),
    kill: () => child.kill(),
    onExit: (fn) => child.on("exit", fn),
  };
}

/** Waits until the server answers (any status) on its origin. */
async function waitForServer(origin: string, secret: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const url = new URL("/api/me/prefs", origin);
  for (;;) {
    const ok = await new Promise<boolean>((resolve) => {
      const req = http.get(url, { headers: { cookie: `${LAUNCH_COOKIE}=${secret}` }, timeout: 5_000 }, (res) => {
        res.resume();
        resolve(true);
      });
      req.on("error", () => resolve(false));
      req.on("timeout", () => req.destroy());
    });
    if (ok) return;
    if (Date.now() > deadline) throw new Error("the local server did not start");
    await new Promise((r) => setTimeout(r, 200));
  }
}

// --- token store (SPEC §2.3) ------------------------------------------------

const tokenFile = () => path.join(app.getPath("userData"), "github-token.bin");

function tokenStatus(): TokenStatus {
  return { stored: existsSync(tokenFile()), encryptionAvailable: safeStorage.isEncryptionAvailable() };
}

function readStoredToken(): string | null {
  if (!existsSync(tokenFile()) || !safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(readFileSync(tokenFile()));
  } catch {
    log("the stored GitHub token could not be decrypted");
    return null;
  }
}

// --- window -----------------------------------------------------------------

/** Only the app's own pages may use the bridge. */
function fromApp(e: IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url;
  return !!server && !!url && classifyUrl(url, server.origin) === "app";
}

function lockDown(contents: WebContents, origin: string) {
  const guard = (e: { preventDefault(): void }, url: string) => {
    const where = classifyUrl(url, origin);
    if (where === "app") return;
    e.preventDefault();
    if (where === "github") void shell.openExternal(url);
    else log(`blocked navigation to ${new URL(url).protocol}//…`);
  };
  contents.on("will-navigate", guard);
  contents.on("will-redirect", guard);
  contents.on("will-frame-navigate", (e) => {
    if (!e.isMainFrame) guard(e, e.url);
  });
  contents.on("will-attach-webview", (e) => e.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    const where = classifyUrl(url, origin);
    if (where === "github") void shell.openExternal(url);
    else if (where === "app") void contents.loadURL(url);
    else log("blocked a new window");
    return { action: "deny" };
  });
}

function createWindow(origin: string) {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 720,
    minHeight: 480,
    title: "Deska",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      spellcheck: true,
    },
  });
  lockDown(win.webContents, origin);
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  void win.loadURL(`${origin}/`);
  mainWindow = win;
}

function registerIpc() {
  ipcMain.handle(CHANNELS.appInfo, (e) => (fromApp(e) ? { name: app.getName(), version: app.getVersion(), platform: process.platform } : null));
  ipcMain.handle(CHANNELS.openExternal, async (e, url: unknown) => {
    if (!fromApp(e) || typeof url !== "string" || classifyUrl(url, server!.origin) !== "github") return false;
    await shell.openExternal(url);
    return true;
  });
  ipcMain.handle(CHANNELS.notify, (e, n: { title?: unknown; body?: unknown }) => {
    if (!fromApp(e) || !Notification.isSupported()) return;
    const title = String(n?.title ?? "").slice(0, 200);
    const body = typeof n?.body === "string" ? n.body.slice(0, 1000) : undefined;
    if (title) new Notification({ title, body }).show();
  });
  ipcMain.handle(CHANNELS.tokenSet, (e, token: unknown) => {
    if (!fromApp(e)) return tokenStatus();
    if (typeof token !== "string" || !/^[A-Za-z0-9_]{20,255}$/.test(token.trim())) throw new Error("That does not look like a GitHub token.");
    if (!safeStorage.isEncryptionAvailable()) throw new Error("The system keychain is not available.");
    writeFileSync(tokenFile(), safeStorage.encryptString(token.trim()), { mode: 0o600 });
    server?.send({ type: "token", token: token.trim() });
    return tokenStatus();
  });
  ipcMain.handle(CHANNELS.tokenClear, (e) => {
    if (!fromApp(e)) return tokenStatus();
    rmSync(tokenFile(), { force: true });
    server?.send({ type: "token", token: null });
    return tokenStatus();
  });
  ipcMain.handle(CHANNELS.tokenStatus, (e) => (fromApp(e) ? tokenStatus() : null));
}

async function boot() {
  const port = await freePort();
  // 256 bits per launch, never written anywhere (SPEC §2.2).
  const secret = randomBytes(32).toString("hex");
  const s = startServerProcess(port, secret);
  server = s;
  s.onExit((code) => {
    if (quitting) return;
    dialog.showErrorBox("Deska", `The local server stopped unexpectedly (exit code ${code ?? "unknown"}).`);
    app.exit(1);
  });
  const stored = readStoredToken();
  if (stored) s.send({ type: "token", token: stored });

  const ses = session.defaultSession;
  // Nothing reaches the network from the window but the app and GitHub images.
  ses.webRequest.onBeforeRequest((details, cb) => cb({ cancel: !requestAllowed(details.url, details.resourceType, s.origin) }));
  const allowedPermissions = new Set(["notifications", "clipboard-sanitized-write"]);
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(allowedPermissions.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => allowedPermissions.has(permission));
  // A session cookie (no expiry): HttpOnly keeps it from page scripts,
  // SameSite=Strict from any other site.
  await ses.cookies.set({ url: s.origin, name: LAUNCH_COOKIE, value: secret, httpOnly: true, sameSite: "strict", secure: false });

  await waitForServer(s.origin, secret, DEV ? 180_000 : 60_000);
  createWindow(s.origin);
}

app.on("web-contents-created", (_e, contents) => {
  contents.on("will-attach-webview", (e) => e.preventDefault());
});

app.on("window-all-closed", () => {
  // macOS: the app keeps running with no window; the Dock icon reopens it.
});

app.on("activate", () => {
  if (!mainWindow && server) createWindow(server.origin);
});

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on("before-quit", (e) => {
  if (quitting || !server) return;
  // Let the server close the database cleanly before the app exits.
  quitting = true;
  e.preventDefault();
  const s = server;
  const force = setTimeout(() => {
    s.kill();
    app.quit();
  }, 5_000);
  s.onExit(() => {
    clearTimeout(force);
    app.quit();
  });
  s.send({ type: "stop" });
});

void app.whenReady().then(async () => {
  registerIpc();
  try {
    await boot();
  } catch (e) {
    dialog.showErrorBox("Deska", `Deska could not start: ${e instanceof Error ? e.message : String(e)}`);
    app.exit(1);
  }
});
