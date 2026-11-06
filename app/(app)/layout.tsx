import { redirect } from "next/navigation";
import { signOut } from "@/lib/auth";
import { getViewerLogin } from "@/lib/session";
import { AppProvider } from "@/components/app/provider";
import { AppShell } from "@/components/app/shell";

export const dynamic = "force-dynamic";

/**
 * Everything behind sign-in. The layout only checks the session; the browser
 * loads issue rows and views from /api/data and /api/views once, then filters
 * locally across client-side navigation.
 *
 * Awaiting the data here instead overflowed the call stack in development:
 * React's dev-only async debug tracking records values a server component
 * awaits, and the full issue cache (thousands of rows) is too large for it.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewerLogin();
  if (!viewer) redirect("/signin");

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/signin" });
  }

  return (
    <AppProvider viewer={viewer}>
      <AppShell signOutAction={signOutAction}>{children}</AppShell>
    </AppProvider>
  );
}
