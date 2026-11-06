import { Suspense } from "react";
import { MyIssuesPage } from "@/components/pages/lists";

export const metadata = { title: "My issues" };

export default function Page() {
  return (
    <Suspense>
      <MyIssuesPage />
    </Suspense>
  );
}
