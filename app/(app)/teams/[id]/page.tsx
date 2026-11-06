import { Suspense } from "react";
import { DimensionValuePage } from "@/components/pages/lists";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <DimensionValuePage id={id} />
    </Suspense>
  );
}
