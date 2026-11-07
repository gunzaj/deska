import type { Metadata } from "next";
import { QuickAddWindow } from "@/components/tasks/quick-add-window";

export const metadata: Metadata = { title: "Quick add" };
export const dynamic = "force-dynamic";

/**
 * The floating quick-add window (SPEC §4.6, D12), opened by the global
 * shortcut from any app. No sidebar or app data: just the input.
 */
export default function Page() {
  return <QuickAddWindow />;
}
