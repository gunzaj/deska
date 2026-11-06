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
    <Explorer
      title="Backlog"
      icon={<Icon name="list" size={15} />}
      base={NO_RELEASE}
      defaults={PRESETS.backlog}
      emptyTitle="Backlog is empty"
      emptyHint="Every open issue is planned into a Release."
    />
  );
}

export function TeamPage({ id }: { id: string }) {
  const { data } = useAppData();
  const team = data.meta.fields.team.find((t) => t.id === id);
  const base = useMemo<Filter[]>(() => [{ field: "team", op: "in", values: [id] }], [id]);
  if (!team) notFound();
  return <Explorer key={id} title={plainName(team.name) || team.name} icon={<OptionDot color={team.color} size={10} />} base={base} defaults={PRESETS.team} />;
}
