import { redirect } from "next/navigation";
import { getViewerLogin } from "@/lib/session";
import { AppProvider } from "@/components/app/provider";
import { AppShell } from "@/components/app/shell";

export const dynamic = "force-dynamic";

/**
 * Everything that needs the local user: the owner of the connected GitHub
 * token (SPEC §2.3). Without one, onboarding. The layout only checks that;
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

  return (
    <AppProvider viewer={viewer}>
      <AppShell>{children}</AppShell>
    </AppProvider>
  );
}
