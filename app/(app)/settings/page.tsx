import type { Metadata } from "next";
import { Page } from "@/components/app/shell";
import { GithubSettings } from "@/components/github/settings";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <Page title="Settings">
      <div className="mx-auto max-w-2xl space-y-8 px-6 py-6">
        <GithubSettings />
      </div>
    </Page>
  );
}
