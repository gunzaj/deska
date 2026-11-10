import type { Metadata } from "next";
import { Page } from "@/components/app/shell";
import { AiSettingsSection } from "@/components/github/ai-settings";
import { CloseSettings } from "@/components/github/close-settings";
import { DesktopSettings } from "@/components/github/desktop-settings";
import { GithubSettings } from "@/components/github/settings";
import { LocalDataSettings } from "@/components/github/local-data-settings";
import { ProjectSettings } from "@/components/github/project-settings";
import { WritesSettings } from "@/components/github/writes-settings";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <Page title="Settings">
      <div className="mx-auto max-w-2xl space-y-8 px-6 py-6">
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
