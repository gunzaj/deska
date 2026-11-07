/**
 * The one owner of everything Deska keeps locally (SPEC §4.6, §4.7): tasks,
 * projects, labels, saved views' snoozes, watches, notifications and settings.
 * They belong to this install, not to a GitHub account, so connecting a
 * different account never hides them. The GitHub login stays what `me` means in
 * issue filters; it is never a key for local data.
 */
export const LOCAL_OWNER = "local";
