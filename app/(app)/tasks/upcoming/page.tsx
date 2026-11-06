import { Suspense } from "react";
import { TaskUpcomingPage } from "@/components/pages/tasks";

export const metadata = { title: "Upcoming" };

export default function Page() {
  return (
    <Suspense>
      <TaskUpcomingPage />
    </Suspense>
  );
}
