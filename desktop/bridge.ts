// The preload bridge (SPEC §2.2): the only thing the renderer can reach in the
// main process. Token entry, notifications, open-external and app info,
// nothing else. Types only; preload.ts and main.ts implement it.

export type AppInfo = { name: string; version: string; platform: string };

export type TokenStatus = { stored: boolean; encryptionAvailable: boolean };

export interface DeskaBridge {
  appInfo(): Promise<AppInfo>;
  /** Opens a https://github.com/ URL in the default browser; anything else is refused (false). */
  openExternal(url: string): Promise<boolean>;
  /** A native notification. */
  notify(notification: { title: string; body?: string }): Promise<void>;
  token: {
    /** Encrypts the GitHub token with the OS keychain and hands it to the local server. Never over HTTP. */
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
  | { type: "token"; token: string | null }
  | { type: "stop" };

declare global {
  interface Window {
    /** Present only inside the desktop app. */
    deska?: DeskaBridge;
  }
}
