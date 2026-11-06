import { Suspense } from "react";
import { MyPullsPage } from "@/components/pages/pulls";

export const metadata = { title: "My open PRs" };

export default function Page() {
  return (
    <Suspense>
      <MyPullsPage />
    </Suspense>
  );
}
