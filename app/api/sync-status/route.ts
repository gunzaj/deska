import { route } from "@/lib/server/route";
import { readSyncState } from "@/lib/sync/runtime";
import { syncService } from "@/lib/sync/service";

export const dynamic = "force-dynamic";

// Middleware normally guards this, but the status exposes sync internals
// (lastError), so the wrapper checks the session here too rather than trust the matcher.
export const GET = route({ auth: "viewer" }, async () => {
  const state = await readSyncState();
  const service = syncService().state;
  // A successful cycle stores "0" and a corrupt value parses to NaN: the first
  // used to be reported as "until 1970-01-01", the second threw a RangeError
  // from toISOString() and turned the status chip into a 500.
  const until = Number(state.rateLimitedUntil ?? 0);
  const rateLimited = Number.isFinite(until) && until > Date.now();
  return {
    lastSync: state.lastSync,
    rateLimited,
    // ISO rather than raw epoch ms: the chip used to print "rate limited until
    // 1760000000000".
    rateLimitedUntil: rateLimited ? new Date(until).toISOString() : null,
    needsInitialImport: state.needsInitialImport,
    // S3: lets the chip tell "nothing changed" from "failing for hours".
    lastAttemptAt: state.lastAttemptAt,
    lastError: state.lastError,
    consecutiveFailures: state.consecutiveFailures,
    // D5: a run in progress, the first import's progress, and why the last run failed.
    running: service.running,
    import: state.importProgress,
    // The last *completed* run's failure — never read without `running`. It is a log
    // record, cleared only when a run succeeds (lib/sync/service.ts), so a retry still
    // reports the failure it is retrying; a reader that ignores `running` renders an
    // alert and a Retry button over an import that is already going. The screen asks
    // lib/import-view.ts instead, which is where that rule is tested.
    failure: service.lastFailure?.failure ?? null,
  };
});
