// The renderer's only door into the main process (SPEC §2.2). Runs sandboxed:
// it may require nothing but "electron", so the channel names are literals
// checked against bridge.ts at compile time.
import { contextBridge, ipcRenderer } from "electron";
import type { CHANNELS, DeskaBridge } from "./bridge";

type Channel = (typeof CHANNELS)[keyof typeof CHANNELS];
const invoke = <T>(channel: Channel, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<T>;

const bridge: DeskaBridge = {
  appInfo: () => invoke("deska:app-info"),
  openExternal: (url) => invoke("deska:open-external", String(url)),
  notify: (n) => invoke("deska:notify", { title: String(n?.title ?? ""), body: n?.body === undefined ? undefined : String(n.body) }),
  desktop: {
    get: () => invoke("deska:desktop-get"),
    set: (patch) => invoke("deska:desktop-set", patch && typeof patch === "object" ? { ...patch } : {}),
    chooseBackupFolder: () => invoke("deska:backup-folder-choose"),
    clearBackupFolder: () => invoke("deska:backup-folder-clear"),
  },
  quickAdd: { close: () => invoke("deska:quick-add-close") },
  onOpenTask: (listener) => {
    const handler = (_e: unknown, id: unknown) => typeof id === "string" && listener(id);
    ipcRenderer.on("deska:open-task", handler);
    return () => void ipcRenderer.removeListener("deska:open-task", handler);
  },
  token: {
    set: (token) => invoke("deska:token-set", String(token)),
    clear: () => invoke("deska:token-clear"),
    status: () => invoke("deska:token-status"),
  },
  github: {
    status: () => invoke("deska:github-status"),
    useCli: () => invoke("deska:github-use-cli"),
    recheck: () => invoke("deska:github-recheck"),
  },
};

contextBridge.exposeInMainWorld(
  "deska",
  Object.freeze({ ...bridge, token: Object.freeze(bridge.token), desktop: Object.freeze(bridge.desktop), quickAdd: Object.freeze(bridge.quickAdd), github: Object.freeze(bridge.github) }),
);
