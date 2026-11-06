import { Suspense } from "react";
import { TaskLabelPage } from "@/components/pages/tasks";

export const metadata = { title: "Label" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <TaskLabelPage id={id} />
    </Suspense>
  );
}
