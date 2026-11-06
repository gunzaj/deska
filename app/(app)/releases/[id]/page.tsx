import { Suspense } from "react";
import { ReleasePage } from "@/components/pages/release";
import { SprintGate } from "@/components/pages/no-sprint";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <SprintGate title="Release">
        <ReleasePage id={id} />
      </SprintGate>
    </Suspense>
  );
}
