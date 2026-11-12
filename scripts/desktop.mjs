#!/usr/bin/env node
// The desktop app (SPEC §2, D2).
//
//   pnpm desktop:dev     Electron + `next dev` (hot reload); it imports from GitHub
//                        after onboarding, or set DESKA_DEMO_SEED=demo for sample data
//   pnpm desktop:stage   build the Next standalone server and the Electron code
//                        into desktop/build (enough to run `electron .`)
//   pnpm desktop:build   stage, then package an unsigned universal .dmg in release/
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = process.cwd();
const DIST_DIR = ".next-desktop";
const BUILD = path.join(root, "desktop", "build");
const bin = (name) => path.join(root, "node_modules", ".bin", name);

function run(file, args, env = {}) {
  execFileSync(file, args, { stdio: "inherit", env: { ...process.env, ...env } });
}

function compileDesktop() {
  rmSync(path.join(root, "desktop", "dist"), { recursive: true, force: true });
  run(bin("tsc"), ["-p", "tsconfig.desktop.json"]);
}

function dev() {
  compileDesktop();
  const electron = require("electron");
  const child = spawn(electron, ["."], { stdio: "inherit", env: { ...process.env, DESKA_DESKTOP_DEV: "1" } });
  child.on("exit", (code, signal) => (signal ? process.kill(process.pid, signal) : process.exit(code ?? 0)));
}

function findSymlink(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) return p;
    if (e.isDirectory()) {
      const found = findSymlink(p);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Every package in pnpm's store (`.pnpm/<id>/node_modules/<name>`, a real
 * folder; its dependencies there are links) becomes `node_modules/<name>`.
 * Two versions of one package would need nesting, so that fails the build.
 * sharp (Next's image optimizer, off in next.config.ts) is left out: its
 * native binary exists for the build machine's architecture only.
 */
function flattenNodeModules(src, dest) {
  const store = path.join(src, ".pnpm");
  const placed = new Map();
  for (const id of readdirSync(store)) {
    const nm = path.join(store, id, "node_modules");
    if (!existsSync(nm)) continue;
    const names = [];
    for (const e of readdirSync(nm, { withFileTypes: true })) {
      if (e.name.startsWith("@")) for (const s of readdirSync(path.join(nm, e.name), { withFileTypes: true })) names.push([`${e.name}/${s.name}`, s]);
      else names.push([e.name, e]);
    }
    for (const [name, entry] of names) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (name === "sharp" || name.startsWith("@img/")) continue;
      if (placed.has(name)) throw new Error(`two copies of ${name}: ${placed.get(name)} and ${id}`);
      placed.set(name, id);
      mkdirSync(path.dirname(path.join(dest, name)), { recursive: true });
      execFileSync("cp", ["-R", path.join(nm, name), path.join(dest, name)]);
    }
  }
}

function stage() {
  compileDesktop();
  rmSync(path.join(root, DIST_DIR), { recursive: true, force: true });
  rmSync(BUILD, { recursive: true, force: true });
  run(bin("next"), ["build"], { NEXT_OUTPUT: "standalone", NEXT_DIST_DIR: DIST_DIR });

  // The server: Next's standalone output, plus the static assets Next leaves
  // out of it, and the migrations. pnpm's symlinked node_modules is flattened
  // into plain folders (an app bundle should hold no links into .pnpm).
  const server = path.join(BUILD, "server");
  const standalone = path.join(root, DIST_DIR, "standalone");
  mkdirSync(server, { recursive: true });
  for (const e of readdirSync(standalone)) {
    if (e !== "node_modules") execFileSync("cp", ["-R", path.join(standalone, e), path.join(server, e)]);
  }
  flattenNodeModules(path.join(standalone, "node_modules"), path.join(server, "node_modules"));
  if (findSymlink(server)) throw new Error(`staged server still has a symlink: ${findSymlink(server)}`);
  cpSync(path.join(root, DIST_DIR, "static"), path.join(server, DIST_DIR, "static"), { recursive: true });
  if (existsSync(path.join(root, "public"))) cpSync(path.join(root, "public"), path.join(server, "public"), { recursive: true });
  cpSync(path.join(root, "drizzle"), path.join(server, "drizzle"), { recursive: true });
  for (const f of ["server.js", path.join("drizzle", "meta", "_journal.json"), path.join("node_modules", "@electric-sql", "pglite", "package.json")]) {
    if (!existsSync(path.join(server, f))) throw new Error(`staged server is missing ${f}`);
  }

  // The Electron app: compiled main, preload and server entry, and a
  // package.json without dependencies (the server brings its own).
  const appDir = path.join(BUILD, "app");
  mkdirSync(appDir, { recursive: true });
  for (const f of readdirSync(path.join(root, "desktop", "dist"))) cpSync(path.join(root, "desktop", "dist", f), path.join(appDir, f));
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  // The build's write switch (SPEC §3.4): off unless DESKA_WRITES=on is set
  // on purpose. main.js reads it and tells the server.
  writeFileSync(path.join(appDir, "build-info.json"), JSON.stringify({ writes: process.env.DESKA_WRITES === "on" ? "on" : "off" }, null, 2));
  writeFileSync(
    path.join(appDir, "package.json"),
    JSON.stringify({ name: "deska", productName: "Deska", version: pkg.version, description: "Deska: GitHub issues, sprints and personal tasks", main: "main.js", private: true }, null, 2),
  );
}

/** An electron-builder afterPack hook that copies the staged server into each packed app. */
function afterPackHook() {
  const hook = path.join(BUILD, "after-pack.cjs");
  writeFileSync(
    hook,
    `const { cpSync } = require("node:fs");
const path = require("node:path");
exports.default = async (context) => {
  const app = path.join(context.appOutDir, context.packager.appInfo.productFilename + ".app");
  cpSync(${JSON.stringify(path.join(BUILD, "server"))}, path.join(app, "Contents", "Resources", "server"), { recursive: true });
};
`,
  );
  return hook;
}

function build() {
  // --skip-stage repackages the last staged build (packaging fixes only).
  if (!process.argv.includes("--skip-stage")) stage();
  const electronVersion = JSON.parse(readFileSync(path.join(root, "node_modules", "electron", "package.json"), "utf8")).version;
  const config = {
    appId: "app.deska.desktop",
    productName: "Deska",
    electronVersion,
    directories: { output: path.join(root, "release") },
    files: ["**/*"],
    // The server goes into Contents/Resources/server after packing:
    // extraResources silently drops node_modules folders.
    afterPack: afterPackHook(),
    // The Dock icons Settings offers (Contents/Resources/app-icons/<id>.png).
    extraResources: [{ from: path.join(root, "desktop", "assets", "app-icons"), to: "app-icons", filter: ["*.png"] }],
    asar: true,
    npmRebuild: false,
    nodeGypRebuild: false,
    mac: {
      target: [{ target: "dmg", arch: ["universal"] }],
      category: "public.app-category.productivity",
      icon: path.join(root, "desktop", "assets", "icon.icns"),
      // Unsigned until the maintainer has a Developer ID (SPEC §1.3).
      identity: null,
      // The flag is set for when a Developer ID exists; it has no effect on an unsigned build.
      hardenedRuntime: true,
      gatekeeperAssess: false,
      // The server folder is the same JavaScript in both architectures.
      x64ArchFiles: "Contents/Resources/server/**",
      // Ramble records audio (item 13); macOS shows this line in the prompt.
      extendInfo: { NSMicrophoneUsageDescription: "Deska records a short voice note to create tasks. The audio goes only to the transcription endpoint you set." },
    },
    dmg: { title: "Deska" },
    copyright: "MIT License",
  };
  const configFile = path.join(BUILD, "electron-builder.json");
  writeFileSync(configFile, JSON.stringify(config, null, 2));
  rmSync(path.join(root, "release"), { recursive: true, force: true });
  // electron-builder walks up to the pnpm workspace and would pack the repo's
  // dependencies into the asar; a copy of the app folder outside the repo
  // has none.
  const projectDir = mkdtempSync(path.join(os.tmpdir(), "deska-builder-"));
  cpSync(path.join(BUILD, "app"), projectDir, { recursive: true });
  try {
    run(bin("electron-builder"), ["--mac", "dmg", "--universal", "--projectDir", projectDir, "--config", configFile, "--publish", "never"], { CSC_IDENTITY_AUTO_DISCOVERY: "false" });
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
  const dmg = readdirSync(path.join(root, "release")).find((f) => f.endsWith(".dmg"));
  if (!dmg) throw new Error("electron-builder produced no .dmg");
  console.log(`desktop: built release/${dmg}`);
}

const commands = { dev, stage, build };
const cmd = commands[process.argv[2]];
if (!cmd) {
  console.error("usage: node scripts/desktop.mjs dev|stage|build");
  process.exit(2);
}
cmd();
