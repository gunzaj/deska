"use client";

// Sprint features need a mapped Sprint (iteration) field (§4.1). Without one,
// or once it was deleted on GitHub, their pages say so instead of showing
// empty lists.
import Link from "next/link";
import { sprintOn } from "@/lib/client/explorer";
import { MISSING_FIELD } from "@/lib/sync/field-map";
import { useAppData } from "../app/provider";
import { Page } from "../app/shell";
import { Icon } from "../icons";

/** The page body, or the "no Sprint field" message when sprint features are off. */
export function SprintGate({ title, children }: { title: string; children: React.ReactNode }) {
  const { data } = useAppData();
  if (sprintOn(data.meta)) return <>{children}</>;
  const missing = data.meta.mapping.sprint?.missing;
  return (
    <Page title={title}>
      <div role="status" data-no-sprint className="mx-auto mt-16 max-w-md px-6 text-center">
        <Icon name="calendar" size={22} className="mx-auto text-faint" />
        <h2 className="mt-3 text-[15px] font-semibold">{missing ? MISSING_FIELD : "No Sprint field mapped"}</h2>
        <p className="mt-1.5 text-[13px] text-muted">
          {missing
            ? `The iteration field mapped as Sprint ("${data.meta.mapping.sprint!.name}") is no longer in the project.`
            : "Sprints, the backlog and planning need an iteration field. Map one in Settings if the project has it."}
        </p>
        <Link href="/settings#mapping" className="mt-4 inline-flex h-8 items-center rounded-md border border-line px-3 text-[12.5px] font-medium hover:bg-hover">
          Field mapping
        </Link>
      </div>
    </Page>
  );
}
