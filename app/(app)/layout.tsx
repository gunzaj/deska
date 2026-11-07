import { redirect } from "next/navigation";
import { getViewerLogin } from "@/lib/session";
import { desktopGuard } from "@/lib/desktop/guard";
import { needsFirstImport, needsProjectSetup } from "@/lib/server/project-setup";
import { AppProvider } from "@/components/app/provider";
import { AppShell } from "@/components/app/shell";

export const dynamic = "force-dynamic";

/**
 * Everything that needs the local user: the owner of the connected GitHub
 * token (SPEC §2.3). Without one, onboarding; in the desktop app without a
 * chosen project and field mapping, onboarding step 2; until the first import
 * from GitHub finished, its progress screen. The layout only checks that;
 * the browser loads issue rows and views from /api/data and /api/views once,
 * then filters locally across client-side navigation.
 *
 * Awaiting the data here instead overflowed the call stack in development:
 * React's dev-only async debug tracking records values a server component
 * awaits, and the full issue cache (thousands of rows) is too large for it.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewerLogin();
  if (!viewer) redirect("/onboarding");
  // Onboarding step 2 (D4): the desktop app needs a project and a field mapping first.
  if (desktopGuard() && (await needsProjectSetup())) redirect("/onboarding?step=2");
  // The first import (D5): its progress, never a half-filled list.
  if (desktopGuard() && (await needsFirstImport())) redirect("/importing");

  return (
    <AppProvider viewer={viewer}>
      <AppShell>{children}</AppShell>
    </AppProvider>
  );
}
