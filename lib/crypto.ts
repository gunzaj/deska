// Server-only AES-256-GCM token encryption. Never store plaintext tokens.
// TOKEN_ENC_KEY: 32 random bytes as 64-char hex or base64. Anything else is a
// hard error — silently deriving a key from a weak or missing value would let
// anyone holding the database decrypt every stored GitHub token.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function resolveKey(): Buffer {
  const raw = process.env.TOKEN_ENC_KEY ?? "";
  if (!raw.trim()) {
    throw new Error(
      "TOKEN_ENC_KEY is not set. Generate one with: openssl rand -hex 32",
    );
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  // Buffer.from(_, "base64") never throws — it silently ignores invalid
  // characters — so validate by round-trip instead of relying on try/catch.
  const b64 = Buffer.from(raw, "base64");
  if (b64.length === 32 && b64.toString("base64").replace(/=+$/, "") === raw.replace(/=+$/, "")) {
    return b64;
  }
  throw new Error(
    "TOKEN_ENC_KEY must be 32 bytes as 64-char hex (openssl rand -hex 32) or base64.",
  );
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

export function encryptToken(plaintext: string): string {
  const key = resolveKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decryptToken(payload: string): string {
  const key = resolveKey();
  const [ivHex, tagHex, dataHex] = payload.split(":");
  if (!ivHex || !tagHex || !dataHex) throw new Error("malformed token payload");
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  // Pin the tag length: GCM otherwise accepts tags as short as 4 bytes, so a
  // truncated tag would make forging a stored token far cheaper.
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error("malformed token payload");
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  return (
    decipher.update(Buffer.from(dataHex, "hex")).toString("utf8") +
    decipher.final("utf8")
  );
}
