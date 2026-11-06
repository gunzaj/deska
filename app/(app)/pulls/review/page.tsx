import { Suspense } from "react";
import { ReviewQueuePage } from "@/components/pages/pulls";

export const metadata = { title: "Review requested" };

export default function Page() {
  return (
    <Suspense>
      <ReviewQueuePage />
    </Suspense>
  );
}
