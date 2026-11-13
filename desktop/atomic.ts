// Files the app must never leave half-written (prefs, token files).
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";

/** Writes to `<file>.tmp`, then renames over `file`: a crash or full disk leaves the old file whole. */
export function writeAtomic(file: string, data: string | Uint8Array, mode = 0o600): void {
  const tmp = `${file}.tmp`;
  try {
    writeFileSync(tmp, data, { mode });
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

/**
 * Reads JSON. A missing file is `null`; an unparsable one is moved to
 * `<file>.bad` (so the next save cannot overwrite what might be recovered) and is also `null`.
 */
export function readJsonOrQuarantine(file: string): unknown {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    try {
      renameSync(file, `${file}.bad`);
    } catch {
      // keep going with the defaults
    }
    return null;
  }
}
