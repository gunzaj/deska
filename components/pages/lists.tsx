"use client";

import { notFound } from "next/navigation";
import { useMemo } from "react";
import { plainName } from "@/lib/client/format";
import { PRESETS } from "@/lib/client/presets";
import type { Filter } from "@/lib/views/view";
import { useAppData } from "../app/provider";
import { Explorer } from "../explorer/explorer";
import { Icon } from "../icons";
import { OptionDot } from "../props";
import { SprintGate } from "./no-sprint";

const ME: Filter[] = [{ field: "assignee", op: "in", values: ["me"] }];
const NO_RELEASE: Filter[] = [{ field: "release", op: "empty" }];

export function MyIssuesPage() {
  const { data } = useAppData();
  return (
    <Explorer
      title="My issues"
      icon={<Icon name="user" size={15} />}
      base={ME}
      defaults={PRESETS.my}
      emptyTitle="Nothing assigned to you"
      emptyHint={data.meta.demo ? "Sample preview. Your GitHub assignments show up after the cache is synced." : "Issues assigned to you on GitHub show up here."}
    />
  );
}

export function AllIssuesPage() {
  return <Explorer title="All issues" icon={<Icon name="layers" size={15} />} defaults={PRESETS.all} />;
}

export function BacklogPage() {
  return (
    <SprintGate title="Backlog">
      <Explorer
        title="Backlog"
        icon={<Icon name="list" size={15} />}
        base={NO_RELEASE}
        defaults={PRESETS.backlog}
        emptyTitle="Backlog is empty"
        emptyHint="Every open issue is planned into a Release."
      />
    </SprintGate>
  );
}

/** Issues with one value of a mapped dimension (the sidebar's first-dimension links). */
export function DimensionValuePage({ id }: { id: string }) {
  const { data } = useAppData();
  const dim = data.meta.dimensions.find((d) => !d.missing && d.options.some((o) => o.id === id));
  const option = dim?.options.find((o) => o.id === id);
  const base = useMemo<Filter[]>(() => (dim ? [{ field: dim.key, op: "in", values: [id] }] : []), [dim, id]);
  if (!dim || !option) notFound();
  return <Explorer key={id} title={plainName(option.name) || option.name} icon={<OptionDot color={option.color} size={10} />} base={base} defaults={PRESETS.team} />;
}
