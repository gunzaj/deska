import { Suspense } from "react";
import { NewViewPage } from "@/components/pages/views";

export const metadata = { title: "New view" };

export default function Page() {
  return (
    <Suspense>
      <NewViewPage />
    </Suspense>
  );
}
