// What Deska keeps of a user's GitHub token, and when (v5 2.8). The only
// reader of `users.token_enc` is the outbox drain, which does nothing while
// WRITE_MODE is off. So the token is stored only while writes are on, and every
// stored token is cleared when the app starts with writes off (Q-C).
import { isNotNull } from "drizzle-orm";
import { databaseUrl, getDb } from "@/db";
import { users } from "@/db/schema";
import { writeEnabled } from "./outbox/queue";

/**
 * Record a signed-in user. The encrypted token is saved only when writes are
 * on; with writes off the user's stored token is cleared instead, so a token
 * from an earlier write-enabled period does not linger.
 */
export async function recordSignIn(user: { githubId: string; login: string; name?: string | null; avatarUrl?: string | null; tokenEnc?: string }): Promise<void> {
  const tokenEnc = writeEnabled() ? (user.tokenEnc ?? null) : null;
  await getDb()
    .insert(users)
    .values({ githubId: user.githubId, login: user.login, name: user.name ?? null, avatarUrl: user.avatarUrl ?? null, tokenEnc })
    // Update the stored token rather than skipping: a returning user kept
    // whatever scopes their token was first issued with otherwise, so flipping
    // WRITE_MODE on never reached the database.
    .onConflictDoUpdate({
      target: users.githubId,
      set: {
        login: user.login,
        name: user.name ?? null,
        avatarUrl: user.avatarUrl ?? null,
        // On: replace it when the sign-in brought one. Off: always clear.
        ...(writeEnabled() ? (user.tokenEnc ? { tokenEnc: user.tokenEnc } : {}) : { tokenEnc: null }),
      },
    });
}

/**
 * Startup: with writes off, no user's token should sit in the database.
 * Returns how many were cleared. Never throws; a database that is down at
 * startup must not stop the app.
 */
export async function clearStoredTokensWhenReadOnly(): Promise<number> {
  if (writeEnabled() || !databaseUrl()) return 0;
  try {
    const cleared = await getDb().update(users).set({ tokenEnc: null }).where(isNotNull(users.tokenEnc)).returning({ id: users.id });
    if (cleared.length) console.warn(`WRITE_MODE is off: cleared ${cleared.length} stored GitHub token(s)`);
    return cleared.length;
  } catch (e) {
    console.error(`could not clear stored GitHub tokens: ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  }
}
