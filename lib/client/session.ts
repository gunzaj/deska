"use client";

// Session expiry, shared by every client store (IMPROVEMENTS S3). The issue
// data, PR, task and notification stores poll on their own timers; the first
// one to get a 401 flips this flag, the app shows a blocking "GitHub is disconnected"
// banner, and every poller stops instead of showing old data forever.
import { useSyncExternalStore } from "react";

let expired = false;
const listeners = new Set<() => void>();

export function sessionExpired(): boolean {
  return expired;
}

export function reportSessionExpired(): void {
  if (expired) return;
  expired = true;
  for (const l of listeners) l();
}

/** True (and reported) when the response says the session is gone. */
export function isUnauthorized(res: Response | null | undefined): boolean {
  if (res?.status !== 401) return false;
  reportSessionExpired();
  return true;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useSessionExpired(): boolean {
  return useSyncExternalStore(subscribe, sessionExpired, () => false);
}

/** Tests only. */
export function resetSessionExpired(): void {
  expired = false;
}
