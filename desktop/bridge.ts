// The preload bridge (SPEC §2.2): the only thing the renderer can reach in the
// main process. Token entry, notifications, open-external and app info,
// nothing else. Types only; preload.ts and main.ts implement it.

export type AppInfo = { name: string; version: string; platform: string };

export type TokenStatus = { stored: boolean; encryptionAvailable: boolean };

/** The AI API key (SPEC §2.3, §4.9): whether one is stored, never the key. */
export type AiKeyStatus = { stored: boolean; encryptionAvailable: boolean };

/** Where the GitHub token comes from (SPEC §2.3): a pasted token main stores encrypted, or the GitHub CLI's login. */
export type GithubAuthSource = "token" | "gh";

/** What `gh auth token` said: "not-found" = no `gh` on the login-shell PATH, "logged-out" = it gave no token. */
export type GithubCliState = "ok" | "not-found" | "logged-out";

/** What the page may know about the sign-in: the source and the CLI's state and account. Never a token. */
export type GithubAuthStatus = { source: GithubAuthSource; cli: GithubCliState; cliLogin: string | null };

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
  /**
   * A second folder every backup is also copied to (iCloud Drive, a sync folder,
   * an external drive); "" = none. Chosen only through the folder dialog
   * (`desktop.chooseBackupFolder`), never through `desktop.set`, so the page
   * cannot name a path itself.
   */
  backupFolder: string;
  /**
   * "gh": no token is stored; main reads it from the GitHub CLI (SPEC §2.3).
   * Changed only by `github.useCli`, `token.set` and `token.clear`, never
   * through `desktop.set`.
   */
  githubAuthSource: GithubAuthSource;
  /** The Dock icon while Deska runs: one of `APP_ICONS`. The packaged icon is always Coral. */
  appIcon: AppIconId;
};

/**
 * The app icons Settings offers, in picker order. Main loads
 * `app-icons/<id>.png` for the Dock; the page shows `/app-icons/<id>-128.png`.
 */
export const APP_ICONS = [
  { id: "coral", name: "Coral" },
  { id: "ocean-blue", name: "Ocean blue" },
  { id: "green", name: "Green" },
  { id: "violet", name: "Violet" },
  { id: "sunny-yellow", name: "Sunny yellow" },
  { id: "charcoal", name: "Charcoal" },
  { id: "coral-pink-gradient", name: "Coral-pink gradient" },
  { id: "orange", name: "Orange" },
] as const;
export type AppIconId = (typeof APP_ICONS)[number]["id"];
export const DEFAULT_APP_ICON: AppIconId = "coral";
export const isAppIconId = (v: unknown): v is AppIconId => APP_ICONS.some((i) => i.id === v);

/** The prefs the page may change through `desktop.set`. */
export type SettablePrefs = Omit<DesktopPrefs, "backupFolder" | "githubAuthSource">;

export const DEFAULT_SHORTCUT = "Control+Alt+Space";

export const DEFAULT_DESKTOP_PREFS: DesktopPrefs = { shortcut: DEFAULT_SHORTCUT, notifications: true, launchAtLogin: false, dockBadge: true, backupFolder: "", githubAuthSource: "token", appIcon: DEFAULT_APP_ICON };

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
    set(patch: Partial<SettablePrefs>): Promise<{ state: DesktopState; error: string | null }>;
    /** Opens the folder dialog; resolves with the new state (`error` when the folder was refused, none when the dialog was cancelled). */
    chooseBackupFolder(): Promise<{ state: DesktopState; error: string | null }>;
    /** Stops copying backups to the second folder (the copies already there stay). */
    clearBackupFolder(): Promise<{ state: DesktopState; error: string | null }>;
  };
  /** The floating quick-add window (§4.6). */
  quickAdd: {
    /** Closes the quick-add window (Esc, or after saving). */
    close(): Promise<void>;
    /** Sets the window's content height (px), so an open suggestion list is not clipped. */
    resize(height: number): Promise<void>;
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
  /**
   * The API key of an OpenAI-compatible AI endpoint (SPEC §2.3, §4.9). Same rules
   * as the GitHub token: encrypted by main, held in memory by the server, never
   * returned to the page. Absent in builds before AI0.
   */
  aiKey?: {
    /** Encrypts the key with the OS keychain and hands it to the local server. Resolves once the server holds it. */
    set(key: string): Promise<AiKeyStatus>;
    /** "Remove key". */
    clear(): Promise<AiKeyStatus>;
    status(): Promise<AiKeyStatus>;
  };
  /** The GitHub CLI login as a token source (SPEC §3.1). Absent in builds before D15. */
  github?: {
    /** The current source, and whether `gh` is installed and logged in (and as whom). */
    status(): Promise<GithubAuthStatus>;
    /**
     * "Use my GitHub CLI login": reads the token with `gh auth token`, deletes
     * any stored token and hands the CLI's to the local server. Nothing is
     * written to disk but the choice. Changes nothing when `gh` gives no token.
     */
    useCli(): Promise<GithubAuthStatus>;
    /** "Check again": with the CLI source, reads its token again. */
    recheck(): Promise<GithubAuthStatus>;
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
  aiKeySet: "deska:ai-key-set",
  aiKeyClear: "deska:ai-key-clear",
  aiKeyStatus: "deska:ai-key-status",
  githubStatus: "deska:github-status",
  githubUseCli: "deska:github-use-cli",
  githubRecheck: "deska:github-recheck",
  desktopGet: "deska:desktop-get",
  desktopSet: "deska:desktop-set",
  backupFolderChoose: "deska:backup-folder-choose",
  backupFolderClear: "deska:backup-folder-clear",
  quickAddClose: "deska:quick-add-close",
  quickAddResize: "deska:quick-add-resize",
  /** main → renderer */
  openTask: "deska:open-task",
} as const;

/** Where a token message's token came from. */
export type TokenAuth = { source: "token" } | { source: "gh"; cli: GithubCliState };

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
      /** The login-shell PATH (§2.1): where the server finds `claude` (§4.9). Not a secret. */
      loginPath: string;
    }
  /**
   * `id` is echoed in a `token-ack` once the server holds the token. `auth`
   * says where it came from (absent = a stored token); with the GitHub CLI
   * source a null token carries why (`cli`). `reread` marks the answer to a
   * `gh-reread`.
   */
  | { type: "token"; token: string | null; source: "launch" | "user"; id: number; auth?: TokenAuth; reread?: boolean }
  /** The AI API key (null = none). `id` is echoed in an `ai-key-ack` once the server holds it. */
  | { type: "ai-key"; key: string | null; id: number }
  /** The second backup folder (null = none), set by main from its prefs at start and on every change. */
  | { type: "backup-mirror"; dir: string | null }
  /** Run a sync now: the Mac woke from sleep (powerMonitor "resume"). */
  | { type: "sync"; reason: "wake" }
  | { type: "stop" };

/** Messages from the server process to main. */
export type ServerReply =
  | { type: "token-ack"; id: number }
  | { type: "ai-key-ack"; id: number }
  /** GitHub answered 401 to the GitHub CLI's token: read it again, once (SPEC §2.3). */
  | { type: "gh-reread" }
  /** Reminders that just fired, to show as native notifications (D12). */
  | { type: "reminders"; items: ReminderItem[] }
  /** The Dock badge: open tasks overdue or due today (D12). */
  | { type: "badge"; count: number };

/** An API key for an AI endpoint: one printable token, no spaces, no quotes. */
export const AI_KEY = /^[\x21\x23-\x7e]{8,512}$/;

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
