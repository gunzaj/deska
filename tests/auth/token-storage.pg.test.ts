// v5 2.8 against Postgres: a GitHub token is stored only while writes are on,
// and cleared at startup (and on the next sign-in) while they are off.
// Skipped unless TEST_DATABASE_URL points at a throwaway, migrated database.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("stored GitHub tokens (Postgres)", async () => {
  const { getDb } = await import("@/db");
  const { clearStoredTokensWhenReadOnly, recordSignIn } = await import("@/lib/auth-tokens");

  const tokens = async () => Object.fromEntries((await getDb().execute(sql`SELECT login, token_enc FROM users`)).rows.map((r) => [r.login, r.token_enc]));

  beforeAll(() => {
    process.env.DATABASE_URL = url;
  });
  beforeEach(async () => {
    await getDb().execute(sql`TRUNCATE users RESTART IDENTITY CASCADE`);
  });
  afterEach(() => {
    delete process.env.WRITE_MODE;
  });
  afterAll(() => {
    delete process.env.DATABASE_URL;
  });

  it("stores the token at sign-in only while writes are on", async () => {
    process.env.WRITE_MODE = "off";
    await recordSignIn({ githubId: "1", login: "alice", tokenEnc: "enc-1" });
    expect(await tokens()).toEqual({ alice: null });

    process.env.WRITE_MODE = "on";
    await recordSignIn({ githubId: "1", login: "alice", tokenEnc: "enc-2" });
    expect(await tokens()).toEqual({ alice: "enc-2" });
  });

  it("a sign-in with writes off clears a token left from a write-enabled period", async () => {
    process.env.WRITE_MODE = "on";
    await recordSignIn({ githubId: "1", login: "alice", tokenEnc: "enc-old" });
    process.env.WRITE_MODE = "off";
    await recordSignIn({ githubId: "1", login: "alice", tokenEnc: "enc-new" });
    expect(await tokens()).toEqual({ alice: null });
  });

  it("starting with writes off clears every stored token; with writes on it keeps them", async () => {
    process.env.WRITE_MODE = "on";
    await recordSignIn({ githubId: "1", login: "alice", tokenEnc: "a" });
    await recordSignIn({ githubId: "2", login: "bob", tokenEnc: "b" });
    expect(await clearStoredTokensWhenReadOnly()).toBe(0);
    expect(await tokens()).toEqual({ alice: "a", bob: "b" });

    process.env.WRITE_MODE = "off";
    expect(await clearStoredTokensWhenReadOnly()).toBe(2);
    expect(await tokens()).toEqual({ alice: null, bob: null });
    expect(await clearStoredTokensWhenReadOnly()).toBe(0); // nothing left to clear
  });
});
