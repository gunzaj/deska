// Next's standalone output copies the repo's .env files. They must never ship in the app.
import { readdirSync, rmSync } from "node:fs";
import path from "node:path";

/** Deletes `.env*` at the top of the staged server and throws if any remain anywhere in it (outside node_modules). */
export function scrubEnvFiles(server) {
  for (const e of readdirSync(server)) if (e.startsWith(".env")) rmSync(path.join(server, e), { force: true, recursive: true });
  const left = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules") continue;
      const p = path.join(dir, e.name);
      if (e.name.startsWith(".env")) left.push(p);
      else if (e.isDirectory()) walk(p);
    }
  };
  walk(server);
  if (left.length) throw new Error(`staged server still has env files: ${left.join(", ")}`);
}
