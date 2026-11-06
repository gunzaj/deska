"use client";

import { useSessionExpired } from "@/lib/client/session";

export function Loading({ viewer, error, retry }: { viewer: string; error: string | null; retry: () => void }) {
  const expired = useSessionExpired();
  return (
    <div className="grid h-dvh place-items-center p-6 text-center">
      <div className="anim-fade">
        <svg viewBox="0 0 24 24" width={36} height={36} aria-hidden className="mx-auto">
          <rect width="24" height="24" rx="7" fill="var(--brand)" />
          <path d="M8 6.5h4.2a5.5 5.5 0 0 1 0 11H8z" fill="none" stroke="var(--brand-on)" strokeWidth="2.4" strokeLinejoin="round" />
        </svg>
        {expired ? (
          <>
            <p className="mt-4 text-[14px] font-semibold">Session expired</p>
            <p className="mt-1 max-w-sm text-muted">Sign in again to keep using Deska.</p>
            <a href="/signin" className="mt-4 inline-flex h-8 items-center rounded-md bg-brand px-3 font-semibold text-brand-on hover:bg-brand-hover">
              Sign in
            </a>
          </>
        ) : error ? (
          <>
            <p className="mt-4 text-[14px] font-semibold">Could not load issues</p>
            <p className="mt-1 max-w-sm text-muted">{error}</p>
            <button type="button" onClick={retry} className="mt-4 inline-flex h-8 items-center rounded-md bg-brand px-3 font-semibold text-brand-on hover:bg-brand-hover">
              Try again
            </button>
          </>
        ) : (
          <p className="mt-4 animate-pulse text-muted" role="status">
            Loading issues for {viewer}…
          </p>
        )}
      </div>
    </div>
  );
}
