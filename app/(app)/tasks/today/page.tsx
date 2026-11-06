import { Suspense } from "react";
import { TaskTodayPage } from "@/components/pages/tasks";

export const metadata = { title: "Today" };

export default function Page() {
  return (
    <Suspense>
      <TaskTodayPage />
    </Suspense>
  );
}
