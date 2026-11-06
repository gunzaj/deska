import { Suspense } from "react";
import { TeamPage } from "@/components/pages/lists";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <TeamPage id={id} />
    </Suspense>
  );
}
