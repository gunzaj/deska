import { Suspense } from "react";
import { TaskInboxPage } from "@/components/pages/tasks";

export const metadata = { title: "Inbox" };

export default function Page() {
  return (
    <Suspense>
      <TaskInboxPage />
    </Suspense>
  );
}
