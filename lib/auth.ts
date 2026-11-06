import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { accessMode, decideAccess, recheckMs } from "./allowlist";
import { dbDir } from "@/db";
import { decryptToken, encryptToken } from "./crypto";
import { checkOrgMembership } from "./github/membership";
import { requestedScopes, scopeMatchesMode, scopeModeOf } from "./github/scopes";

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  trustHost: true,
  providers: [
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID ?? "missing",
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "missing",
      authorization: { params: { scope: requestedScopes(process.env.WRITE_MODE) } },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, account, profile, trigger }) {
      // First sign-in: persist encrypted token (never plaintext) + identity.
      const p = profile as { login?: string; id?: number; name?: string | null; avatar_url?: string | null } | undefined;
      if (account?.access_token) {
        token.tokenEnc = encryptToken(account.access_token);
        // The scopes GitHub granted, and the mode they were issued under: a
        // session from the other WRITE_MODE is sent back to sign in (v5 2.8).
        (token as Record<string, unknown>).scope = account.scope ?? null;
        (token as Record<string, unknown>).scopeMode = scopeModeOf(process.env.WRITE_MODE);
      }
      if (p?.login) {
        (token as Record<string, unknown>).login = p.login;
        if (typeof p.id === "number") {
          (token as Record<string, unknown>).githubId = String(p.id);
        }
        // Best-effort DB upsert; never fail sign-in if DB is unavailable (M1).
        try {
          if (dbDir()) {
            const { recordSignIn } = await import("./auth-tokens");
            await recordSignIn({
              githubId: String(p.id ?? p.login),
              login: p.login,
              name: typeof p.name === "string" ? p.name : null,
              avatarUrl: typeof p.avatar_url === "string" ? p.avatar_url : null,
              tokenEnc: token.tokenEnc as string | undefined,
            });
          }
        } catch {
          // DB unavailable in dev/CI — session JWT remains the auth record.
        }
      }
      // Org mode (SPEC §14): check membership at sign-in, and again when the
      // middleware finds the last check older than ACCESS_RECHECK_HOURS.
      if (accessMode() === "org" && (account?.access_token || trigger === "update")) {
        const t = token as Record<string, unknown>;
        let accessToken = account?.access_token ?? null;
        if (!accessToken && typeof t.tokenEnc === "string") {
          try {
            accessToken = decryptToken(t.tokenEnc);
          } catch {
            accessToken = null;
          }
        }
        const member = accessToken ? await checkOrgMembership(accessToken) : false;
        if (member !== null) {
          t.orgActive = member;
          t.orgCheckedAt = Date.now();
        } else if (t.orgActive === true) {
          // GitHub is down: keep the member in, and try again in an hour.
          t.orgCheckedAt = Date.now() - recheckMs() + 3600_000;
        }
      }
      return token;
    },
    async session({ session, token }) {
      const login = (token as unknown as Record<string, unknown>).login as
        | string
        | undefined;
      (session as unknown as Record<string, unknown>).login = login ?? null;
      const t = token as unknown as { orgActive?: boolean; orgCheckedAt?: number };
      const access = decideAccess({ login, orgActive: t.orgActive, orgCheckedAt: t.orgCheckedAt });
      // A session issued under the other WRITE_MODE counts as signed out.
      const stale = !scopeMatchesMode(token as { scopeMode?: unknown }, process.env.WRITE_MODE);
      if (stale) (session as unknown as Record<string, unknown>).login = null;
      (session as unknown as Record<string, unknown>).access = access;
      (session as unknown as Record<string, unknown>).isAllowed = access !== "deny" && !stale;
      return session;
    },
  },
});
