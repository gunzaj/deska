import { Suspense } from "react";
import { BacklogPage } from "@/components/pages/lists";

export const metadata = { title: "Backlog" };

export default function Page() {
  return (
    <Suspense>
      <BacklogPage />
    </Suspense>
  );
}
