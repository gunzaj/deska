#!/usr/bin/env node
// `pnpm dev`: `next dev`, plus a demo preview when nothing else is configured.
//
// With no DATABASE_URL, no .env file and no e2e bypass set, the app serves the
// generated demo dataset (fictional acme/widgets, SPEC §0.2) signed in as
// `alice` through the dev-only bypass (lib/e2e-bypass.ts, never active in
// production). Anything already configured wins: Playwright sets its own env,
// and a .env file means a real local setup.
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";

const env = { ...process.env };
const hasEnvFile = readdirSync(".").some((f) => f.startsWith(".env") && f !== ".env.example");
const configured = env.DATABASE_URL || env.E2E_AUTH_BYPASS || hasEnvFile;

if (!configured) {
  Object.assign(env, {
    GITHUB_REPO: "acme/widgets",
    GITHUB_ORG: "acme",
    GITHUB_PROJECT_NUMBER: "7",
    E2E_AUTH_BYPASS: "1",
    E2E_BYPASS_ACK: "i-understand",
    E2E_DEFAULT_LOGIN: "alice",
    ALLOWED_GITHUB_LOGINS: "alice,bob",
    AUTH_SECRET: "dev-preview-secret-not-for-production",
    TOKEN_ENC_KEY: "0".repeat(64),
  });
  console.log("deska: demo preview (no DATABASE_URL or .env), signed in as alice");
}

const bin = existsSync("node_modules/.bin/next") ? "node_modules/.bin/next" : "next";
const child = spawn(bin, ["dev", ...process.argv.slice(2)], { stdio: "inherit", env });
child.on("exit", (code, signal) => (signal ? process.kill(process.pid, signal) : process.exit(code ?? 0)));
