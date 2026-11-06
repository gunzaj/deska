import { Suspense } from "react";
import { TaskProjectPage } from "@/components/pages/tasks";

export const metadata = { title: "Project" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <TaskProjectPage id={id} />
    </Suspense>
  );
}
