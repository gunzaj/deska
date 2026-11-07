"use client";

import Link from "next/link";
import { PRESETS } from "@/lib/client/presets";
import { SYSTEM_OWNER } from "@/lib/views/ids";
import { useAppData, useAppViews } from "../app/provider";
import { Page } from "../app/shell";
import { Explorer } from "../explorer/explorer";
import { Icon } from "../icons";
import { EmptyHint } from "../props";

export function ViewPage({ id }: { id: string }) {
  const { views } = useAppViews();
  const view = views.find((v) => v.id === id);
  if (!view) {
    return (
      <Page title="View not found">
        <EmptyHint icon="eye" title="This view does not exist or is personal to someone else" action={<Link href="/views" className="text-brand-text underline">All views</Link>} />
      </Page>
    );
  }
  const icon = view.layout === "board" ? "board" : view.layout === "table" ? "table" : "list";
  return <Explorer key={view.id} title={view.name} icon={<Icon name={icon} size={15} />} view={view} defaults={PRESETS.blank} />;
}

export function NewViewPage() {
  return <Explorer title="New view" icon={<Icon name="plus" size={15} />} defaults={PRESETS.blank} emptyHint="Add filters, then save the view." />;
}

export function ViewsIndexPage() {
  const { views } = useAppViews();
  const { viewer } = useAppData();
  return (
    <Page
      title="Views"
      icon={<Icon name="eye" size={15} />}
      actions={
        <Link href="/views/new" className="inline-flex h-7 items-center gap-1.5 rounded-md bg-brand px-2.5 text-[12.5px] font-semibold text-brand-on hover:bg-brand-hover">
          <Icon name="plus" size={14} /> New view
        </Link>
      }
    >
      <ul className="divide-y divide-line-soft">
        {views.map((v) => (
          <li key={v.id}>
            <Link href={`/views/${v.id}`} className="flex h-11 items-center gap-3 px-4 hover:bg-hover">
              <Icon name={v.layout === "board" ? "board" : v.layout === "table" ? "table" : "list"} size={15} className="text-faint" />
              <span className="flex-1 truncate font-medium">{v.name}</span>
              <span className="flex items-center gap-1 text-[12px] text-faint">
                <Icon name={v.visibility === "shared" ? "users" : "lock"} size={12} />
                {v.visibility === "shared" ? "Shared" : "Personal"}
              </span>
              <span className="w-28 truncate text-right text-[12px] text-faint">{v.ownerId.toLowerCase() === viewer.toLowerCase() ? "You" : v.ownerId === SYSTEM_OWNER ? "Deska" : v.ownerId}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Page>
  );
}
