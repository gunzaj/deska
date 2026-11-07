import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ImportProgress } from "@/components/github/import-progress";
import { desktopGuard } from "@/lib/desktop/guard";
import { resolveImportDestination } from "@/lib/import-destination";
import { needsFirstImport, needsProjectSetup } from "@/lib/server/project-setup";
import { getViewerLogin } from "@/lib/session";

export const metadata: Metadata = { title: "Importing from GitHub" };
export const dynamic = "force-dynamic";

/** Where a destination other than this screen sends the app. */
const REDIRECTS = {
  onboarding: "/onboarding",
  "onboarding-step-2": "/onboarding?step=2",
  issues: "/issues",
} as const;

/** The first import's progress screen (SPEC D5), until the cache is complete. */
export default async function ImportingPage() {
  const destination = await resolveImportDestination({
    signedIn: async () => !!(await getViewerLogin()),
    desktop: () => desktopGuard() !== null,
    needsProjectSetup,
    needsFirstImport,
  });
  if (destination !== "importing") redirect(REDIRECTS[destination]);
  return <ImportProgress />;
}
