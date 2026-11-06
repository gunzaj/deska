import { ReleasesPage } from "@/components/pages/releases";
import { SprintGate } from "@/components/pages/no-sprint";

export const metadata = { title: "Releases" };

export default function Page() {
  return (
    <SprintGate title="Releases">
      <ReleasesPage />
    </SprintGate>
  );
}
