import { Suspense } from "react";
import { InsightsPage } from "@/components/pages/insights";

export const metadata = { title: "Insights" };

export default function Page() {
  return (
    <Suspense>
      <InsightsPage />
    </Suspense>
  );
}
