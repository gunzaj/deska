import { Suspense } from "react";
import { AllIssuesPage } from "@/components/pages/lists";

export const metadata = { title: "All issues" };

export default function Page() {
  return (
    <Suspense>
      <AllIssuesPage />
    </Suspense>
  );
}
