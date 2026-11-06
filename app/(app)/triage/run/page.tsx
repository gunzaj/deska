import { Suspense } from "react";
import { TriageRunPage } from "@/components/pages/triage-run";

export const metadata = { title: "Triage" };

export default function Page() {
  return (
    <Suspense>
      <TriageRunPage />
    </Suspense>
  );
}
