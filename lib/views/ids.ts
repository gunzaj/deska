/** Client-safe view ID generator (no server imports). */
export function newViewId(): string {
  return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
