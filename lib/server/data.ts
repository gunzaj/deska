import { buildClientData } from "@/lib/client/build";
import type { WireData } from "@/lib/client/types";
import { listPendingCreates } from "@/lib/outbox/store";
import { doneStatusOption } from "@/lib/outbox/runtime";
import { writeGate } from "@/lib/writes/gate";
import { demoSeed } from "@/lib/db-bootstrap";
import { demoEnabled, getStoreWithGeneration } from "@/lib/store";
import { currentTarget, settingsVersion } from "@/lib/settings";
import { dbDir } from "@/db";

/**
 * The client payload is the same for every viewer of one cache generation on
 * one day (the current/next Release is resolved by date). It carries no viewer:
 * the browser already knows who is signed in and puts that into `meta.viewer`
 * itself, and `generatedAt` is the time the payload was built, not the time of
 * the request. So one build, one serialization and one ETag serve everyone
 * (v5 3.7); the body used to be rebuilt per viewer and serialized per request.
 */
let memo: { key: string; data: WireData; json: string } | null = null;

export type ClientDataResult = { etag: string; data: () => WireData; json: () => string };

/**
 * The payload and its ETag. The ETag is known before the payload is built, so
 * a matching If-None-Match skips the build entirely.
 */
export async function loadClientData(now = new Date()): Promise<ClientDataResult> {
  const { store, generation } = await getStoreWithGeneration();
  // SPEC §3.4: the gate is the only place writes are turned on or off.
  const gate = await writeGate();
  const writeMode = gate.allowed;
  // Sample data: the in-memory preview, or a database seeded with it (D2).
  const demo = (!dbDir() && demoEnabled()) || demoSeed() !== null;
  const today = now.toISOString().slice(0, 10);
  // closeBlocked is derived from the Done Status chosen in Settings (W2), which
  // can change without a cache-generation bump; it is part of the ETag too.
  const closeBlocked = writeMode ? await (async () => {
    const d = await doneStatusOption(store);
    return d.ok ? null : d.reason;
  })() : null;
  // The stored repository (links) and field mapping (§4.1) change without a
  // cache-generation bump: a remap must still reach the browser.
  const target = await currentTarget();
  const repo = target?.repoFull;
  // W3: create jobs GitHub has not confirmed yet show as pending rows in the lists.
  const pendingCreates = dbDir() ? await listPendingCreates().catch(() => []) : [];
  const pendingKey = pendingCreates.map((p) => `${p.id}${p.status === "sending" ? "s" : "p"}`).join(",");
  const variant = `${demo ? "d" : "n"}${closeBlocked ? "c" : "o"}${writeMode ? "w" : "r"}s${settingsVersion()}p${pendingKey}`;
  const key = `${generation}|${today}|${writeMode ? 1 : 0}|${variant}`;
  const build = () => {
    if (memo?.key !== key) {
      const data = buildClientData(store, { viewer: "", writeMode, demo, now, repo, projectTitle: target?.projectTitle });
      data.meta.closeBlocked = closeBlocked;
      data.meta.pendingCreates = pendingCreates;
      if (!writeMode) data.meta.editOffReason = gate.reason ?? undefined;
      memo = { key, data, json: JSON.stringify(data) };
    }
    return memo;
  };
  return { etag: dataEtag(generation, writeMode, today, variant), data: () => build().data, json: () => build().json };
}

/**
 * `"<generation>-<writeMode>-<day>[-<variant>]"`, the same for every viewer. The
 * day is part of it because the payload's current/next Release and `today`
 * change at midnight (UTC) even when the cache does not; `variant` carries
 * inputs that can change without a generation bump (demo mode, closeBlocked).
 */
export function dataEtag(generation: string, writeMode: boolean, today: string, variant = ""): string {
  return `"${generation}-${writeMode ? "w" : "r"}-${today}${variant ? `-${variant}` : ""}"`;
}

/** Whether an If-None-Match header lists `etag` (weak or strong, or `*`). */
export function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header.split(",").some((t) => {
    const v = t.trim();
    return v === "*" || v.replace(/^W\//, "") === etag;
  });
}
