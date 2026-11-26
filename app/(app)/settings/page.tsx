import type { Metadata } from "next";
import { Page } from "@/components/app/shell";
import { AiSettingsSection } from "@/components/github/ai-settings";
import { CloseSettings } from "@/components/github/close-settings";
import { DesktopSettings } from "@/components/github/desktop-settings";
import { GithubSettings } from "@/components/github/settings";
import { LocalDataSettings } from "@/components/github/local-data-settings";
import { ProjectSettings } from "@/components/github/project-settings";
import { WritesSettings } from "@/components/github/writes-settings";
import { GeneralSettings } from "@/components/tasks/general-settings";
// Read at build time on the server; the page ships only the version string.
import pkg from "@/package.json";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <Page
      title="Settings"
      actions={<span className="text-[12px] tabular-nums text-faint">Deska {pkg.version}</span>}
    >
      <div className="mx-auto max-w-2xl space-y-8 px-6 py-6">
        <GeneralSettings />
        <GithubSettings />
        <ProjectSettings />
        <CloseSettings />
        <WritesSettings />
        <DesktopSettings />
        <AiSettingsSection />
        <LocalDataSettings />
      </div>
    </Page>
  );
}
