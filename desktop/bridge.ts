// The preload bridge (SPEC §2.2): the only thing the renderer can reach in the
// main process. Token entry, notifications, open-external and app info,
// nothing else. Types only; preload.ts and main.ts implement it.

export type AppInfo = { name: string; version: string; platform: string };

export type TokenStatus = { stored: boolean; encryptionAvailable: boolean };

/**
 * Desktop-only settings (SPEC §2.4, §4.6): kept by the main process in a small
 * file in the profile, because main is what registers the shortcut, shows the
 * notifications and sets the Dock badge (it has no database access).
 */
export type DesktopPrefs = {
  /** Electron accelerator of the global quick-add shortcut; "" = none. */
  shortcut: string;
  /** Native notifications for reminders (the in-app bell always works). */
  notifications: boolean;
  /** Open Deska when the user logs in. Off until the user opts in. */
  launchAtLogin: boolean;
  /** Dock badge: overdue + due today. */
  dockBadge: boolean;
};

export const DEFAULT_SHORTCUT = "Control+Alt+Space";

export const DEFAULT_DESKTOP_PREFS: DesktopPrefs = { shortcut: DEFAULT_SHORTCUT, notifications: true, launchAtLogin: false, dockBadge: true };

/** What Settings shows: the prefs plus whether the shortcut is registered right now. */
export type DesktopState = { prefs: DesktopPrefs; shortcutActive: boolean; notificationsSupported: boolean; canLaunchAtLogin: boolean };

/** A native-notification action on a reminder (SPEC §4.6). */
export type ReminderAction = "complete" | "snooze1h" | "tomorrow";

/** A reminder that just fired: the server hands these to main to show. */
export type ReminderItem = { notificationId: string; taskId: string; title: string };

export interface DeskaBridge {
  appInfo(): Promise<AppInfo>;
  /** Opens a https://github.com/ URL in the default browser; anything else is refused (false). */
  openExternal(url: string): Promise<boolean>;
  /** A native notification. */
  notify(notification: { title: string; body?: string }): Promise<void>;
  /** Desktop-only settings; `set` reports a shortcut that could not be registered. */
  desktop: {
    get(): Promise<DesktopState>;
    set(patch: Partial<DesktopPrefs>): Promise<{ state: DesktopState; error: string | null }>;
  };
  /** The floating quick-add window (§4.6). */
  quickAdd: {
    /** Closes the quick-add window (Esc, or after saving). */
    close(): Promise<void>;
  };
  /** A native notification asked to open this task. Returns an unsubscribe. */
  onOpenTask(listener: (taskId: string) => void): () => void;
  token: {
    /**
     * Encrypts the GitHub token with the OS keychain and hands it to the local
     * server. Never over HTTP. Resolves once the server holds it; rejects for
     * anything but a fine-grained (`github_pat_…`) or classic (`ghp_…`) token.
     */
    set(token: string): Promise<TokenStatus>;
    /** "Disconnect GitHub": deletes the stored token. */
    clear(): Promise<TokenStatus>;
    status(): Promise<TokenStatus>;
  };
}

/** IPC channels the bridge uses. */
export const CHANNELS = {
  appInfo: "deska:app-info",
  openExternal: "deska:open-external",
  notify: "deska:notify",
  tokenSet: "deska:token-set",
  tokenClear: "deska:token-clear",
  tokenStatus: "deska:token-status",
  desktopGet: "deska:desktop-get",
  desktopSet: "deska:desktop-set",
  quickAddClose: "deska:quick-add-close",
  /** main → renderer */
  openTask: "deska:open-task",
} as const;

/** Messages from main to the server process. The secret and token travel only this way. */
export type ServerMessage =
  | {
      type: "start";
      mode: "production" | "development";
      /** The Next.js standalone build (production) or the repo root (development). */
      serverDir: string;
      port: number;
      secret: string;
      dbDir: string;
      env: Record<string, string>;
    }
  /** `id` is echoed in a `token-ack` once the server holds the token. */
  | { type: "token"; token: string | null; source: "launch" | "user"; id: number }
  /** Run a sync now: the Mac woke from sleep (powerMonitor "resume"). */
  | { type: "sync"; reason: "wake" }
  | { type: "stop" };

/** Messages from the server process to main. */
export type ServerReply =
  | { type: "token-ack"; id: number }
  /** Reminders that just fired, to show as native notifications (D12). */
  | { type: "reminders"; items: ReminderItem[] }
  /** The Dock badge: open tasks overdue or due today (D12). */
  | { type: "badge"; count: number };

/** A fine-grained PAT (SPEC §3.1). */
export const FINE_GRAINED_TOKEN = /^github_pat_[A-Za-z0-9_]{20,250}$/;
/** A classic PAT (`ghp_…`), accepted for read-only use when an org hasn't approved a fine-grained one (SPEC §3.1). */
export const CLASSIC_TOKEN = /^ghp_[A-Za-z0-9]{20,250}$/;

declare global {
  interface Window {
    /** Present only inside the desktop app. */
    deska?: DeskaBridge;
  }
}
