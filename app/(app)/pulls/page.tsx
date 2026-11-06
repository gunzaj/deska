import { Suspense } from "react";
import { PullsPage } from "@/components/pages/pulls";

export const metadata = { title: "Pull requests" };

export default function Page() {
  return (
    <Suspense>
      <PullsPage />
    </Suspense>
  );
}
