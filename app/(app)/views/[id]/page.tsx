import { Suspense } from "react";
import { ViewPage } from "@/components/pages/views";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <ViewPage id={id} />
    </Suspense>
  );
}
