import { ReleasePlanPage } from "@/components/pages/plan";
import { SprintGate } from "@/components/pages/no-sprint";

export const metadata = { title: "Release planning" };

export default function Page() {
  return (
    <SprintGate title="Release planning">
      <ReleasePlanPage />
    </SprintGate>
  );
}
