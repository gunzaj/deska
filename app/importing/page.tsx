import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ImportProgress } from "@/components/github/import-progress";
import { desktopGuard } from "@/lib/desktop/guard";
import { needsFirstImport, needsProjectSetup } from "@/lib/server/project-setup";
import { getViewerLogin } from "@/lib/session";

export const metadata: Metadata = { title: "Importing from GitHub" };
export const dynamic = "force-dynamic";

/** The first import's progress screen (SPEC D5), until the cache is complete. */
export default async function ImportingPage() {
  if (!(await getViewerLogin())) redirect("/onboarding");
  if (!desktopGuard()) redirect("/issues");
  if (await needsProjectSetup()) redirect("/onboarding?step=2");
  if (!(await needsFirstImport())) redirect("/issues");
  return <ImportProgress />;
}
