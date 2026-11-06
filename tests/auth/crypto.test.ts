import { afterEach, describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "@/lib/crypto";

const HEX_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("token encryption", () => {
  afterEach(() => {
    delete process.env.TOKEN_ENC_KEY;
  });

  it("round-trips without exposing plaintext", () => {
    process.env.TOKEN_ENC_KEY = HEX_KEY;
    const enc = encryptToken("gho_secret-token");
    expect(enc).not.toContain("gho_secret-token");
    expect(decryptToken(enc)).toBe("gho_secret-token");
  });

  it("uses a fresh IV per encryption", () => {
    process.env.TOKEN_ENC_KEY = HEX_KEY;
    expect(encryptToken("same")).not.toBe(encryptToken("same"));
  });

  it("rejects tampered payloads", () => {
    process.env.TOKEN_ENC_KEY = HEX_KEY;
    expect(() => decryptToken("bad-payload")).toThrow();
  });

  it("rejects a truncated auth tag or a wrong-size IV", () => {
    // GCM accepts tags down to 4 bytes unless the length is pinned, which
    // would make forging a stored token much cheaper.
    process.env.TOKEN_ENC_KEY = HEX_KEY;
    const [iv, tag, data] = encryptToken("gho_secret").split(":");
    expect(() => decryptToken(`${iv}:${tag!.slice(0, 8)}:${data}`)).toThrow(/malformed/);
    expect(() => decryptToken(`${iv!.slice(0, 16)}:${tag}:${data}`)).toThrow(/malformed/);
    expect(decryptToken(`${iv}:${tag}:${data}`)).toBe("gho_secret");
  });

  it("accepts a 32-byte base64 key", () => {
    const b64 = Buffer.alloc(32, 7).toString("base64");
    process.env.TOKEN_ENC_KEY = b64;
    expect(decryptToken(encryptToken("tok"))).toBe("tok");
  });

  it("refuses to encrypt with a missing key instead of using a weak fallback", () => {
    // Regression: an unset key used to hash the empty string into a fixed,
    // publicly known AES key, so anyone with the database could decrypt tokens.
    delete process.env.TOKEN_ENC_KEY;
    expect(() => encryptToken("gho_secret")).toThrow(/TOKEN_ENC_KEY/);
  });

  it("refuses an empty or wrong-length key", () => {
    process.env.TOKEN_ENC_KEY = "";
    expect(() => encryptToken("x")).toThrow(/TOKEN_ENC_KEY/);

    process.env.TOKEN_ENC_KEY = "too-short";
    expect(() => encryptToken("x")).toThrow(/TOKEN_ENC_KEY/);
  });
});