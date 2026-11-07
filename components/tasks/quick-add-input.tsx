"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { tokenKey, type Token } from "@/lib/tasks/quick-add";

/**
 * Single-line quick-add input (SPEC §12.4). The text is drawn twice: a mirror
 * underneath shows highlighted tokens, and the real input on top has
 * transparent text so the caret, selection and IME still behave natively.
 *
 * Backspace right after a highlighted token turns it back into plain text
 * instead of deleting a character. Typing `@` (people), `#` (issues),
 * `+` (labels) or `=` (projects) opens suggestions.
 */
export type Suggestion = { id: string; label: string; insert: string; icon?: ReactNode; hint?: string };
export type Trigger = "#" | "+" | "=";
export type SuggestFn = (trigger: Trigger, query: string) => Suggestion[];

const TOKEN_STYLE: Record<Token["kind"], string> = {
  date: "var(--brand-soft)",
  time: "var(--brand-soft)",
  recurrence: "var(--brand-soft)",
  priority: "var(--warning-soft)",
  label: "var(--violet-soft)",
  project: "var(--info-soft)",
  link: "var(--info-soft)",
};

export function QuickAddInput({
  value,
  onChange,
  tokens,
  onRevert,
  onSubmit,
  suggest,
  placeholder,
  label = "Task",
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  tokens: Token[];
  onRevert: (key: string) => void;
  onSubmit: () => void;
  suggest?: SuggestFn;
  placeholder?: string;
  label?: string;
  autoFocus?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  // Unique per instance, so two inputs don't share option ids.
  const listboxId = useId();

  const syncScroll = () => {
    if (mirror.current && input.current) mirror.current.scrollLeft = input.current.scrollLeft;
  };
  useLayoutEffect(syncScroll);

  // The word being typed, if it starts with a trigger character.
  const before = value.slice(0, caret);
  const m = /(?:^|\s)([#+=])([^\s#+=]*)$/.exec(before);
  const trigger = m ? (m[1] as Trigger) : null;
  const query = m?.[2] ?? "";
  const wordStart = m ? caret - query.length - 1 : -1;
  // No suggestions for a word that is already a recognised token.
  const recognised = tokens.some((t) => t.start === wordStart && t.end === caret);
  const items = trigger && suggest && !recognised && dismissedAt !== wordStart ? suggest(trigger, query).slice(0, 8) : [];
  const open = items.length > 0;
  const current = Math.min(active, items.length - 1);

  useEffect(() => setActive(0), [trigger, query]);

  const pick = (s: Suggestion) => {
    const next = `${value.slice(0, wordStart)}${s.insert} ${value.slice(caret).replace(/^\S*/, "").trimStart()}`;
    onChange(next);
    const pos = wordStart + s.insert.length + 1;
    // Set now so the next render doesn't read the old caret against the new text.
    setCaret(pos);
    requestAnimationFrame(() => input.current?.setSelectionRange(pos, pos));
  };

  const parts: ReactNode[] = [];
  let at = 0;
  for (const t of tokens) {
    if (t.start > at) parts.push(value.slice(at, t.start));
    parts.push(
      <mark key={t.start} className="rounded-[4px] text-fg" style={{ background: TOKEN_STYLE[t.kind], boxShadow: `0 0 0 1.5px ${TOKEN_STYLE[t.kind]}` }}>
        {value.slice(t.start, t.end)}
      </mark>,
    );
    at = t.end;
  }
  parts.push(value.slice(at));

  const textClass = "px-0 text-[15px] font-semibold leading-7 tracking-normal";

  return (
    <div className="relative">
      <div
        ref={mirror}
        aria-hidden
        className={`pointer-events-none absolute inset-0 overflow-hidden whitespace-pre ${textClass}`}
      >
        {parts}
        {"​"}
      </div>
      <input
        ref={input}
        autoFocus={autoFocus}
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open}
        role="combobox"
        aria-controls={listboxId}
        aria-activedescendant={open ? `${listboxId}-${current}` : undefined}
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
          setDismissedAt(null);
        }}
        onSelect={(e) => setCaret((e.target as HTMLInputElement).selectionStart ?? 0)}
        onScroll={syncScroll}
        onKeyDown={(e) => {
          // Keys during IME composition (Enter commits the candidate) belong to the IME.
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (open) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => (a + 1) % items.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a - 1 + items.length) % items.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              const s = items[current];
              if (s) pick(s);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setDismissedAt(wordStart);
              return;
            }
          }
          if (e.key === "Backspace") {
            const el = e.currentTarget;
            if (el.selectionStart === el.selectionEnd) {
              const t = tokens.find((x) => x.end === el.selectionStart);
              if (t) {
                e.preventDefault();
                // Don't offer suggestions for the word the user just reverted.
                setDismissedAt(t.start);
                onRevert(tokenKey(t.kind, t.text));
                return;
              }
            }
          }
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit();
          }
        }}
        className={`relative w-full bg-transparent text-transparent caret-[var(--fg)] outline-none placeholder:font-normal placeholder:text-faint selection:bg-[var(--info-soft)] selection:text-transparent ${textClass}`}
      />
      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Suggestions"
          className="anim-pop absolute left-0 top-full z-10 mt-1 w-72 overflow-hidden rounded-xl border border-line bg-popover p-1 shadow-pop"
        >
          {items.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="option"
              id={`${listboxId}-${i}`}
              aria-selected={i === current}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
              className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] ${i === current ? "bg-hover" : ""}`}
            >
              {s.icon && <span className="grid w-4 shrink-0 place-items-center">{s.icon}</span>}
              <span className="min-w-0 flex-1 truncate">{s.label}</span>
              {s.hint && <span className="shrink-0 text-[11.5px] text-faint">{s.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
