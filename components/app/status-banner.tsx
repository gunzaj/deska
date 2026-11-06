"use client";

import Link from "next/link";
import { useSessionExpired } from "@/lib/client/session";
import { MISSING_FIELD } from "@/lib/sync/field-map";
import { useAppData, useAppSync } from "./provider";

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * Data freshness banners (IMPROVEMENTS S3). A 401 from any store means the
 * app lost its local user (the GitHub token was disconnected): it blocks the
 * app until GitHub is connected again (polling has stopped). Any other failed
 * refresh keeps the data and says how old it is.
 */
export function StatusBanners() {
  const expired = useSessionExpired();
  const { staleSince } = useAppSync();
  const { refresh, data } = useAppData();
  const missing = data.meta.mapping.missing;

  if (expired) {
    return (
      <div className="fixed inset-0 z-[60] grid place-items-center bg-underlay p-6">
        <div role="alertdialog" aria-modal="true" aria-labelledby="session-expired-title" aria-describedby="session-expired-desc" className="max-w-sm rounded-xl border border-line bg-surface p-5 text-center shadow-modal">
          <p id="session-expired-title" className="text-[14px] font-semibold">
            GitHub is disconnected
          </p>
          <p id="session-expired-desc" className="mt-1 text-muted">
            Deska stopped refreshing. Anything shown may be out of date.
          </p>
          <a href="/onboarding" className="mt-4 inline-flex h-8 items-center rounded-md bg-brand px-3 font-semibold text-brand-on hover:bg-brand-hover">
            Connect GitHub
          </a>
        </div>
      </div>
    );
  }

  return (
    <>
      {missing.length > 0 && (
        // A mapped field was deleted on GitHub (§4.1): say so instead of showing blank values.
        <div role="status" data-missing-banner className="flex shrink-0 items-center gap-2 border-b border-line bg-warning-soft px-4 py-1.5 text-[12.5px]">
          <span className="min-w-0 flex-1">
            {MISSING_FIELD}: {missing.map((m) => `“${m.name}”`).join(", ")} {missing.length === 1 ? "is" : "are"} no longer in the project.
          </span>
          <Link href="/settings#mapping" className="rounded-md px-2 py-0.5 font-medium hover:bg-hover">
            Field mapping
          </Link>
        </div>
      )}
      {staleSince !== null && (
        <div role="status" className="flex shrink-0 items-center gap-2 border-b border-line bg-warning-soft px-4 py-1.5 text-[12.5px]">
          <span className="min-w-0 flex-1">Couldn&apos;t refresh, showing data from {time(staleSince)}.</span>
          <button type="button" onClick={() => void refresh()} className="rounded-md px-2 py-0.5 font-medium hover:bg-hover">
            Retry
          </button>
        </div>
      )}
    </>
  );
}
