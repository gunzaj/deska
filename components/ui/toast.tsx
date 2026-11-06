"use client";

// Toasts (IMPROVEMENTS U1): short confirmations with an optional action, such
// as Undo after completing or deleting a task. At most three are shown; the
// newest is at the bottom. Info toasts are announced politely, errors
// assertively. Esc dismisses the newest one, unless a dialog or side panel is
// open (then Esc is theirs) and focus isn't inside the toasts.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type ToastInput = {
  message: string;
  action?: { label: string; run: () => void | Promise<void> };
  kind?: "info" | "error";
  /** Milliseconds before it goes by itself (default 6 s, errors 10 s). */
  duration?: number;
};

type Shown = ToastInput & { id: number };

type ToastCtx = { toast: (t: ToastInput) => number; dismiss: (id: number) => void };

const Ctx = createContext<ToastCtx | null>(null);

/** Outside a ToastProvider (tests rendering a piece of the app) toasts are dropped. */
const noop: ToastCtx = { toast: () => 0, dismiss: () => {} };

export function useToast(): ToastCtx {
  return useContext(Ctx) ?? noop;
}

export const MAX_TOASTS = 3;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Shown[]>([]);
  const listRef = useRef(list);
  listRef.current = list;
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const region = useRef<HTMLDivElement>(null);

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setList((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      const id = ++seq.current;
      setList((prev) => {
        const next = [...prev, { ...input, id }];
        // Oldest go first when more than three pile up.
        for (const old of next.slice(0, Math.max(0, next.length - MAX_TOASTS))) {
          const t = timers.current.get(old.id);
          if (t) clearTimeout(t);
          timers.current.delete(old.id);
        }
        return next.slice(-MAX_TOASTS);
      });
      const ms = input.duration ?? (input.kind === "error" ? 10_000 : 6_000);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), ms),
      );
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const current = listRef.current;
      if (e.key !== "Escape" || e.defaultPrevented || !current.length) return;
      const inside = region.current?.contains(document.activeElement) ?? false;
      const busy = document.querySelector('[data-side-panel], [aria-modal="true"], [role="dialog"]');
      if (!inside && busy) return;
      dismiss(current[current.length - 1]!.id);
      if (inside) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss]);

  useEffect(() => {
    const t = timers.current;
    return () => {
      for (const id of t.values()) clearTimeout(id);
    };
  }, []);

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);
  const info = list.filter((t) => t.kind !== "error");
  const errors = list.filter((t) => t.kind === "error");

  return (
    <Ctx.Provider value={value}>
      {children}
      <div ref={region} className="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex flex-col items-center gap-2 px-4 sm:left-auto sm:right-4 sm:items-end">
        {/* Two live regions: errors interrupt, confirmations wait their turn. */}
        <div role="status" aria-live="polite" className="flex flex-col items-center gap-2 sm:items-end">
          {info.map((t) => (
            <ToastItem key={t.id} t={t} dismiss={dismiss} />
          ))}
        </div>
        <div role="alert" aria-live="assertive" className="flex flex-col items-center gap-2 sm:items-end">
          {errors.map((t) => (
            <ToastItem key={t.id} t={t} dismiss={dismiss} />
          ))}
        </div>
      </div>
    </Ctx.Provider>
  );
}

function ToastItem({ t, dismiss }: { t: Shown; dismiss: (id: number) => void }) {
  return (
    <div
      data-toast
      className={`anim-fade pointer-events-auto flex max-w-[min(28rem,calc(100vw-2rem))] items-center gap-3 rounded-lg border px-3 py-2 text-[13px] shadow-modal ${
        t.kind === "error" ? "border-critical bg-critical-soft text-critical" : "border-line bg-surface text-fg"
      }`}
    >
      <span className="min-w-0 flex-1">{t.message}</span>
      {t.action && (
        <button
          type="button"
          onClick={() => {
            dismiss(t.id);
            void t.action!.run();
          }}
          className="shrink-0 rounded-md px-2 py-0.5 font-semibold text-brand-text hover:bg-hover"
        >
          {t.action.label}
        </button>
      )}
      <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="shrink-0 rounded-md px-1.5 text-faint hover:bg-hover hover:text-fg">
        ×
      </button>
    </div>
  );
}
