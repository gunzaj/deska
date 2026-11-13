// The write gate (SPEC §3.4): a GitHub write happens only when all three hold.
//
// 1. The token has the write permissions (§3.3). Detected with read-only
//    queries by the connection check (`checkToken`): classic and GitHub CLI
//    tokens from `x-oauth-scopes`, a fine-grained token from GitHub's
//    `viewerCan*` fields. The result is stored, because a relaunch must not
//    re-ask GitHub before it knows whether writes are allowed.
// 2. Settings → "GitHub writes" is on. Off by default, and off again after
//    every token change (the token message sets a flag this module consumes).
// 3. The build allows writes (`DESKA_WRITES=on`). Anything else, including an
//    unstamped dev build and the `DESKA_WRITES=off` release, is off.
//
// The gate fails closed: a database or settings read error leaves writes off.
import { buildAllowsWrites } from "../config";
import { localToken } from "../github/local-token";
import { readWriteAccess, readWrites, saveWriteAccess, saveWrites, type StoredWriteAccess } from "../settings";
import { dbDir } from "@/db";
import { failPendingEdits, SIGN_IN_CHANGED } from "../outbox/store";
import { takeTokenChange } from "./token-change";

export type WriteAccess = StoredWriteAccess["state"];

export type WriteGate = {
  /** All three parts hold. */
  allowed: boolean;
  /** Why writes are off, in the order the user can act on it; null when allowed. */
  reason: string | null;
  buildAllows: boolean;
  settingOn: boolean;
  tokenAccess: WriteAccess;
  /** What the check said about the token's permissions (null while unknown). */
  tokenMessage: string | null;
};

export const WRITE_MESSAGES = {
  // The predecessor's wording for a build that can't write; Settings shows the build detail.
  buildOff: "Editing is off for this deployment",
  notConnected: "GitHub is not connected",
  notChecked: "Write permissions not checked yet — Check again in Settings → GitHub",
  readOnly: "Read-only token",
  settingOff: "GitHub writes are off in Settings",
  /** The settings switch can't turn on: the token has no write permissions. */
  cannotTurnOn: (why: string) => `GitHub writes can't be turned on: ${why}`,
} as const;

/** Apply a pending token change: writes off, write permissions unknown again. */
export async function consumeTokenChangeReset(): Promise<boolean> {
  if (!takeTokenChange()) return false;
  await saveWrites(false);
  await saveWriteAccess({ state: "unknown", message: null, checkedAt: null });
  await failWaitingEdits();
  return true;
}

/**
 * Edits still waiting in the outbox were made under the previous sign-in: they
 * are failed, not kept for whenever writes are turned on again (§3.4).
 */
async function failWaitingEdits(): Promise<void> {
  if (!dbDir()) return;
  const n = await failPendingEdits(SIGN_IN_CHANGED).catch((e) => {
    console.error(`write gate: could not fail the waiting edits: ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  });
  if (n) console.log(`write gate: failed ${n} waiting edit(s) after a sign-in change`);
}

/**
 * The token now belongs to another GitHub account without the user having
 * replaced it here (the GitHub CLI switched accounts, §2.3): the same as a token
 * change for writes. The new token's own permissions are still recorded by the
 * check that noticed it.
 */
export async function accountChanged(): Promise<void> {
  await saveWrites(false);
  await failWaitingEdits();
}

/** The gate for the current settings and token. Never throws; reads fail closed. */
export async function writeGate(): Promise<WriteGate> {
  const buildAllows = buildAllowsWrites();
  try {
    await consumeTokenChangeReset();
    const settingOn = await readWrites();
    const access = await readWriteAccess();
    const tokenAccess = access.state;
    const allowed = buildAllows && settingOn && tokenAccess === "yes";
    return {
      allowed,
      reason: allowed ? null : reasonFor({ buildAllows, settingOn, tokenAccess, tokenMessage: access.message }),
      buildAllows,
      settingOn,
      tokenAccess,
      tokenMessage: access.message,
    };
  } catch (e) {
    // The settings table could not be read: no write may be risked.
    console.error(`write gate: settings unavailable: ${e instanceof Error ? e.message : String(e)}`);
    return { allowed: false, reason: WRITE_MESSAGES.buildOff, buildAllows, settingOn: false, tokenAccess: "unknown", tokenMessage: null };
  }
}

function reasonFor(g: { buildAllows: boolean; settingOn: boolean; tokenAccess: WriteAccess; tokenMessage: string | null }): string | null {
  if (!g.buildAllows) return WRITE_MESSAGES.buildOff;
  if (g.tokenAccess === "no") return g.tokenMessage ?? WRITE_MESSAGES.readOnly;
  if (g.tokenAccess === "unknown") return localToken() ? WRITE_MESSAGES.notChecked : WRITE_MESSAGES.notConnected;
  if (!g.settingOn) return WRITE_MESSAGES.settingOff;
  return null;
}

/**
 * Store a detection result from the connection check. `unknown` is not stored:
 * a transient GitHub failure must not forget a permission the token had.
 */
export async function recordWriteAccess(state: WriteAccess, message: string | null): Promise<void> {
  if (state === "unknown") return;
  await saveWriteAccess({ state, message, checkedAt: new Date().toISOString() });
}

/**
 * Turn Settings → "GitHub writes" on or off. Turning it on requires a token whose
 * write permissions were detected; the caller runs the connection check first.
 * Returns the new gate.
 */
export async function setWritesOn(on: boolean): Promise<WriteGate> {
  if (!on) {
    await saveWrites(false);
    return writeGate();
  }
  const access = await readWriteAccess();
  if (access.state !== "yes") {
    // Refuse without touching the setting: the caller shows the reason.
    return writeGate();
  }
  await saveWrites(true);
  return writeGate();
}
