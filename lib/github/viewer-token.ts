import type { NextRequest } from "next/server";
import { decryptToken } from "@/lib/crypto";
import { getSessionToken } from "@/lib/session-token";

/**
 * The signed-in user's own GitHub token (decrypted from the session JWT), so
 * GitHub sees the real person. Reads fall back to the server's GITHUB_TOKEN;
 * writes pass `{ fallback: false }`, because an edit sent with the shared
 * token would be attributed to the wrong account and bypass the acting user's
 * own permissions (SPEC §5, §14).
 */
export async function viewerToken(
  req: NextRequest,
  { fallback = true }: { fallback?: boolean } = {},
): Promise<string | null> {
  try {
    // Not getToken() directly: on https it missed the `__Secure-` cookie.
    const token = await getSessionToken(req);
    const enc = (token as { tokenEnc?: string } | null)?.tokenEnc;
    if (enc) return decryptToken(enc);
  } catch {
    /* fall back to the env token, if allowed */
  }
  return fallback ? (process.env.GITHUB_TOKEN ?? null) : null;
}
