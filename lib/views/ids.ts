/** Client-safe view ID generator (no server imports). */
export function newViewId(): string {
  return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * The owner of the seed views (v5 2.10). Not a GitHub login (logins cannot
 * contain "@"), so no person can be it. A view it owns is shared and editable,
 * deletable and restorable by anyone (Q-B); before this, the first visitor
 * after the first sync owned the defaults and only they could change them.
 */
export const SYSTEM_OWNER = "@system";

/** Whether `viewer` may change a view owned by `ownerId`. */
export function canEditView(ownerId: string, viewer: string): boolean {
  return ownerId === SYSTEM_OWNER || ownerId.toLowerCase() === viewer.toLowerCase();
}
