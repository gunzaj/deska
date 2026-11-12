"use client";

// "Release notes" on a Release page (IMPROVEMENTS F5): a markdown draft of what
// shipped, to copy. Read-only.
import { useMemo, useState } from "react";
import { labelsInUse, releaseNotes, shippedIssues } from "@/lib/client/notes";
import type { ClientIssue, ClientRelease } from "@/lib/client/types";
import { useAppData } from "../app/provider";
import { Icon } from "../icons";
import { Dialog } from "../ui/dialog";
import { btn } from "../ui/popover";
import { useToast } from "../ui/toast";

export function ReleaseNotesButton({ release, issues }: { release: ClientRelease; issues: ClientIssue[] }) {
  const { data } = useAppData();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [labelSet, setLabelSet] = useState<string[]>([]);
  const shipped = useMemo(() => shippedIssues(issues, release.id), [issues, release.id]);
  const labels = useMemo(() => labelsInUse(shipped, data.meta), [shipped, data.meta]);
  const text = useMemo(() => releaseNotes({ release, issues, meta: data.meta, labelSet }), [release, issues, data.meta, labelSet]);

  const toggle = (id: string) => setLabelSet((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ message: "Release notes copied" });
    } catch {
      toast({ kind: "error", message: "Couldn't copy: select the text and copy it" });
    }
  };

  return (
    <>
      <button type="button" className={btn.outline} onClick={() => setOpen(true)} data-release-notes-button>
        <Icon name="copy" size={13} />
        Release notes
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} label="Release notes" width={720}>
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <p className="text-[14px] font-semibold">Release notes · {release.title}</p>
            <p className="text-[12px] text-faint">
              {shipped.length} issue{shipped.length === 1 ? "" : "s"} closed. Issues closed as not planned are left out.
            </p>
          </div>
          <button type="button" className={btn.primary} onClick={() => void copy()} data-copy-notes>
            <Icon name="copy" size={13} />
            Copy markdown
          </button>
        </div>
        {labels.length > 0 && (
          <fieldset className="border-b border-line px-4 py-2">
            <legend className="sr-only">Group by label</legend>
            <p className="mb-1 text-[12px] text-faint">Sub-group by label (an issue goes under the first one it has):</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {labels.slice(0, 12).map((l) => (
                <label key={l.id} className="flex items-center gap-1.5 text-[12.5px]">
                  <input type="checkbox" checked={labelSet.includes(l.id)} onChange={() => toggle(l.id)} className="size-3.5 accent-brand" />
                  {l.name} <span className="text-faint">{l.n}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap px-4 py-3 font-mono text-[12.5px] leading-relaxed" data-notes-text tabIndex={0} aria-label="Markdown">
          {text}
        </pre>
      </Dialog>
    </>
  );
}
