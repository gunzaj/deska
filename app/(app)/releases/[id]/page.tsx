import { Suspense } from "react";
import { ReleasePage } from "@/components/pages/release";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <ReleasePage id={id} />
    </Suspense>
  );
}
