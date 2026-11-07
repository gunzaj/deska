// About window and build stamp (SPEC D14). Pure helpers: main.ts shows the dialog.

/** Where the downloads live. Deska never checks for updates itself (§1.3). */
export const RELEASES_URL = "https://github.com/gunzaj/deska/releases";

/** What `scripts/desktop.mjs` stamps into the build (build-info.json). */
export type BuildInfo = { writes: "off" | "on" };

/** Anything other than an explicit `"on"` means off: an unstamped or damaged build never writes. */
export function parseBuildInfo(raw: unknown): BuildInfo {
  const writes = raw && typeof raw === "object" ? (raw as { writes?: unknown }).writes : undefined;
  return { writes: writes === "on" ? "on" : "off" };
}

export function aboutDetails(version: string, info: BuildInfo) {
  return {
    title: "About Deska",
    message: `Deska ${version}`,
    detail: [
      "GitHub issues, sprints and personal tasks on your Mac.",
      info.writes === "off" ? "This build is read-only: it never writes to GitHub." : "GitHub writes are available in this build (off until you turn them on in Settings).",
      "Deska doesn't update itself. New versions are on the Releases page.",
    ].join("\n"),
    releasesButton: "Open Releases",
  };
}
