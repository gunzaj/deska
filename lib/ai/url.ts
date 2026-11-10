// The base URL of an OpenAI-compatible endpoint (SPEC §4.9): `https` for any
// host; plain `http` only where the traffic stays on the user's machine or
// network: loopback, private ranges and `*.local`.
export type BaseUrl = { ok: true; url: string } | { ok: false; error: string };

function ipv4(host: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number) as [number, number, number, number];
  return parts.every((n) => n <= 255) ? parts : null;
}

/** Loopback, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `localhost`, `*.local`. */
export function isLocalNetworkHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (h === "localhost" || h === "[::1]" || h.endsWith(".local")) return true;
  const ip = ipv4(h);
  if (!ip) return false;
  const [a, b] = ip;
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** The normalised base URL (no trailing slash, no query or fragment), or why it is refused. "" is not a URL. */
export function checkBaseUrl(raw: string): BaseUrl {
  const text = raw.trim();
  if (!text) return { ok: false, error: "Enter the endpoint's base URL, e.g. https://example.test/v1." };
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return { ok: false, error: "That is not a URL." };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, error: "The base URL must start with https:// (or http:// for a server on this machine or your own network)." };
  if (u.username || u.password) return { ok: false, error: "Leave credentials out of the URL: put the API key in the key field." };
  if (u.protocol === "http:" && !isLocalNetworkHost(u.hostname)) {
    return { ok: false, error: "Plain http is only allowed for this machine and your own network (localhost, 10.x, 172.16–31.x, 192.168.x, *.local). Use https for anything else." };
  }
  const path = u.pathname.replace(/\/+$/, "");
  return { ok: true, url: `${u.protocol}//${u.host}${path}` };
}
