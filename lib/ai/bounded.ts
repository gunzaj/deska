// A small bounded-parallel map (item 6). A triage batch builds its inputs in
// parallel, but a local GitHub proxy or a slow link should not see one burst per
// issue; at most `limit` builds run at once and the result keeps the input order.
export async function mapBounded<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const width = Math.max(1, Math.min(Math.floor(limit), items.length));
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: width }, worker));
  return out;
}
