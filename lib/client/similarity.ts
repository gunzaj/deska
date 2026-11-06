// Title similarity for "possible duplicates" (IMPROVEMENTS F7). The same
// measure as Postgres' pg_trgm `similarity()`: split into words, pad each with
// two spaces before and one after, take the 3-character windows, and compare
// the sets (shared / all). Postgres does this in production, with an index; this
// is the same thing for runs without a database, and for tests.

export function trigrams(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (!word) continue;
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  }
  return out;
}

export function similarity(a: string, b: string): number {
  const x = trigrams(a);
  const y = trigrams(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const t of x) if (y.has(t)) shared++;
  return shared / (x.size + y.size - shared);
}

/** Titles scoring at or above this count as possibly the same issue. */
export const SIMILARITY_THRESHOLD = 0.4;
/** How many suggestions the panel shows. */
export const MAX_DUPLICATES = 3;
/** Closed issues stay candidates this long after they closed. */
export const CLOSED_WINDOW_DAYS = 90;

export type DuplicateCandidate = { number: number; title: string; state: "open" | "closed"; url: string; similarity: number };

type Row = { number: number; title: string; state: string; url: string; closedAt: string | null };

/**
 * The best matches for `of` among `rows`: open issues and ones closed within the
 * window, never itself, best first. The in-memory twin of the Postgres query.
 */
export function findDuplicates(rows: Row[], of: { number: number; title: string }, now = Date.now()): DuplicateCandidate[] {
  const cutoff = now - CLOSED_WINDOW_DAYS * 86_400_000;
  const out: DuplicateCandidate[] = [];
  for (const r of rows) {
    if (r.number === of.number) continue;
    if (r.state !== "open" && !(r.closedAt && Date.parse(r.closedAt) >= cutoff)) continue;
    const s = similarity(r.title, of.title);
    if (s >= SIMILARITY_THRESHOLD) out.push({ number: r.number, title: r.title, state: r.state === "open" ? "open" : "closed", url: r.url, similarity: Math.round(s * 100) / 100 });
  }
  return out.sort((a, b) => b.similarity - a.similarity || a.number - b.number).slice(0, MAX_DUPLICATES);
}
