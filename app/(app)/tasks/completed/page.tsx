import { Suspense } from "react";
import { TaskCompletedPage } from "@/components/pages/completed";

export const metadata = { title: "Completed" };

export default function Page() {
  return (
    <Suspense>
      <TaskCompletedPage />
    </Suspense>
  );
}
