"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PRESETS } from "@/lib/client/presets";
import { decodeView } from "@/lib/views/share";
import { useAppViews } from "../app/provider";
import { Page } from "../app/shell";
import { Explorer } from "../explorer/explorer";
import { Icon } from "../icons";
import { EmptyHint } from "../props";
import { Dialog } from "../ui/dialog";
import { btn } from "../ui/popover";

export function ViewPage({ id }: { id: string }) {
  const { views } = useAppViews();
  const view = views.find((v) => v.id === id);
  if (!view) {
    return (
      <Page title="View not found">
        <EmptyHint icon="eye" title="This view does not exist" action={<Link href="/views" className="text-brand-text underline">All views</Link>} />
      </Page>
    );
  }
  const icon = view.layout === "board" ? "board" : view.layout === "table" ? "table" : "list";
  return <Explorer key={view.id} title={view.name} icon={<Icon name={icon} size={15} />} view={view} defaults={PRESETS.blank} />;
}

export function NewViewPage() {
  return <Explorer title="New view" icon={<Icon name="plus" size={15} />} defaults={PRESETS.blank} emptyHint="Add filters, then save the view." />;
}

/** Paste a string made by “Copy view” (§4.2). It becomes a new local view; nothing is taken from the string but the view itself. */
function ImportViewDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { upsertView } = useAppViews();
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => {
    setText("");
    setError(null);
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} label="Import view">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const r = decodeView(text);
          if (!r.ok) return setError(r.error);
          setBusy(true);
          // The server makes the ID of a view it hasn't seen.
          void upsertView({ ...r.view, id: "" }).then((saved) => {
            setBusy(false);
            if (!saved) return setError("Could not save the view.");
            close();
            router.push(`/views/${saved.id}`);
          });
        }}
      >
        <div className="p-4">
          <p className="text-[14px] font-semibold">Import view</p>
          <p className="mt-1 text-[12.5px] text-muted">Paste the text from “Copy view”. It only works with a project that has the same fields.</p>
          <textarea
            autoFocus
            aria-label="View text"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            rows={5}
            className="mt-3 w-full rounded-lg border border-line-field bg-field p-2 font-mono text-[12px] outline-none focus:border-focus"
          />
          {error && (
            <p role="alert" className="mt-2 text-[12.5px] text-critical">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-line bg-bg/50 px-4 py-3">
          <button type="button" onClick={close} className={btn.ghost}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !text.trim()} className={btn.primary}>
            {busy ? "Importing…" : "Import"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function ViewsIndexPage() {
  const { views } = useAppViews();
  const [importing, setImporting] = useState(false);
  return (
    <Page
      title="Views"
      icon={<Icon name="eye" size={15} />}
      actions={
        <>
          <button type="button" onClick={() => setImporting(true)} className={btn.ghost}>
            Import view
          </button>
          <Link href="/views/new" className="inline-flex h-7 items-center gap-1.5 rounded-md bg-brand px-2.5 text-[12.5px] font-semibold text-brand-on hover:bg-brand-hover">
            <Icon name="plus" size={14} /> New view
          </Link>
        </>
      }
    >
      <ImportViewDialog open={importing} onClose={() => setImporting(false)} />
      <ul className="divide-y divide-line-soft">
        {views.map((v) => (
          <li key={v.id}>
            <Link href={`/views/${v.id}`} className="flex h-11 items-center gap-3 px-4 hover:bg-hover">
              <Icon name={v.layout === "board" ? "board" : v.layout === "table" ? "table" : "list"} size={15} className="text-faint" />
              <span className="flex-1 truncate font-medium">{v.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Page>
  );
}
