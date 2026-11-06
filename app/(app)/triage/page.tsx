import { Suspense } from "react";
import { TriagePage } from "@/components/pages/triage";

export const metadata = { title: "Triage" };

export default function Page() {
  return (
    <Suspense>
      <TriagePage />
    </Suspense>
  );
}
