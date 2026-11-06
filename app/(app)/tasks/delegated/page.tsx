import { Suspense } from "react";
import { TaskDelegatedPage } from "@/components/pages/tasks";

export const metadata = { title: "Delegated tasks" };

export default function Page() {
  return (
    <Suspense>
      <TaskDelegatedPage />
    </Suspense>
  );
}
