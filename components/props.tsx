// Visual atoms for issue properties. Everything is derived from discovered
// option order/colour, so renaming or reordering options in GitHub just works.
import type { ReactNode } from "react";
import { hashColor, optionColor } from "@/lib/client/colors";
import type { ClientOption } from "@/lib/client/types";
import { Icon } from "./icons";

/**
 * Status: a ring filled in proportion to the option's position in the Status
 * field (first option = empty ring, last = full). Closed issues show a check
 * (completed) or slash (not planned) regardless of Status.
 */
export function StatusIcon({
  option,
  total,
  state,
  stateReason,
  size = 14,
}: {
  option: ClientOption | null | undefined;
  total: number;
  state?: string;
  stateReason?: string | null;
  size?: number;
}) {
  if (state === "closed") {
    const notPlanned = stateReason === "not_planned" || stateReason === "duplicate";
    return (
      <svg viewBox="0 0 16 16" width={size} height={size} aria-label={notPlanned ? "Closed, not planned" : "Closed"} className="shrink-0">
        <circle cx="8" cy="8" r="7" fill={notPlanned ? "var(--fg-faint)" : "#8c6fe6"} />
        {notPlanned ? (
          <path d="M5.2 10.8 10.8 5.2" stroke="var(--surface)" strokeWidth="1.6" strokeLinecap="round" />
        ) : (
          <path d="m5 8.2 2 2 4-4.2" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
    );
  }
  if (!option) {
    return (
      <svg viewBox="0 0 16 16" width={size} height={size} aria-label="No status" className="shrink-0">
        <circle cx="8" cy="8" r="6.2" fill="none" stroke="var(--fg-faint)" strokeWidth="1.4" strokeDasharray="2 2.2" />
      </svg>
    );
  }
  const c = optionColor(option.color);
  const frac = total > 1 ? option.position / (total - 1) : 0;
  const r = 3.2;
  const circ = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-label={option.name} className="shrink-0">
      <circle cx="8" cy="8" r="6.2" fill="none" stroke={c} strokeWidth="1.6" />
      {frac > 0 && (
        <circle
          cx="8"
          cy="8"
          r={r}
          fill="none"
          stroke={c}
          strokeWidth={r * 2}
          strokeDasharray={`${circ * Math.max(frac, 0.12)} ${circ}`}
          transform="rotate(-90 8 8)"
        />
      )}
    </svg>
  );
}

/** Priority as signal bars; bars light up by the option's rank in the field. */
export function PriorityIcon({ option, total, size = 14 }: { option: ClientOption | null | undefined; total: number; size?: number }) {
  if (!option) {
    return (
      <svg viewBox="0 0 16 16" width={size} height={size} aria-label="No priority" className="shrink-0">
        {[3, 7, 11].map((x) => (
          <rect key={x} x={x} y="7.3" width="2.4" height="1.4" rx="0.7" fill="var(--fg-faint)" />
        ))}
      </svg>
    );
  }
  const bars = 3;
  const lit = total > 1 ? Math.round(((option.position + 1) / total) * bars) : bars;
  const c = optionColor(option.color);
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-label={option.name} className="shrink-0">
      {[0, 1, 2].map((i) => (
        <rect key={i} x={2.5 + i * 4} y={10 - i * 3.5} width="3" height={3.5 + i * 3.5} rx="1" fill={i < lit ? c : "var(--border-field)"} />
      ))}
    </svg>
  );
}

export function OptionDot({ color, size = 8 }: { color: string | null | undefined; size?: number }) {
  return <span aria-hidden className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: optionColor(color) }} />;
}

export function Avatar({ login, url, size = 20 }: { login: string; url?: string | null; size?: number }) {
  if (url) {
    return <img src={url} alt={login} title={login} width={size} height={size} className="shrink-0 rounded-full bg-sunken" />;
  }
  return (
    <span
      title={login}
      className="grid shrink-0 place-items-center rounded-full font-semibold uppercase text-white"
      style={{ width: size, height: size, background: hashColor(login), fontSize: Math.max(8, size * 0.42) }}
    >
      {login.replace(/[^a-z0-9]/gi, "").slice(0, 2)}
    </span>
  );
}

export function AvatarStack({ logins, urlOf, size = 20 }: { logins: string[]; urlOf: (l: string) => string | null; size?: number }) {
  if (!logins.length) return null;
  return (
    <span className="flex -space-x-1.5">
      {logins.slice(0, 3).map((l) => (
        <span key={l} className="rounded-full ring-2 ring-surface">
          <Avatar login={l} url={urlOf(l)} size={size} />
        </span>
      ))}
      {logins.length > 3 && (
        <span className="grid place-items-center rounded-full bg-active text-[9px] font-semibold text-muted ring-2 ring-surface" style={{ width: size, height: size }}>
          +{logins.length - 3}
        </span>
      )}
    </span>
  );
}

export function Chip({ children, color, title }: { children: ReactNode; color?: string | null; title?: string }) {
  return (
    <span title={title} className="inline-flex h-5 max-w-[14rem] items-center gap-1.5 truncate rounded-full border border-line px-2 text-[11.5px] font-medium text-muted">
      {color !== undefined && <OptionDot color={color} size={7} />}
      <span className="truncate">{children}</span>
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-grid h-[18px] min-w-[18px] place-items-center rounded border border-line bg-surface px-1 font-sans text-[10.5px] font-medium text-muted shadow-raised">
      {children}
    </kbd>
  );
}

export function ProgressRing({ done, total, size = 14 }: { done: number; total: number; size?: number }) {
  const r = 6;
  const c = 2 * Math.PI * r;
  const f = total ? done / total : 0;
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} className="shrink-0" aria-label={`${done} of ${total} done`}>
      <circle cx="8" cy="8" r={r} fill="none" stroke="var(--border-field)" strokeWidth="2" />
      <circle cx="8" cy="8" r={r} fill="none" stroke="var(--brand-border)" strokeWidth="2" strokeDasharray={`${c * f} ${c}`} transform="rotate(-90 8 8)" strokeLinecap="round" />
    </svg>
  );
}

export function TypeBadge({ name, color }: { name: string; color?: string | null }) {
  return (
    <span className="inline-flex h-5 items-center gap-1 rounded px-1.5 text-[11px] font-semibold" style={{ color: optionColor(color), background: `color-mix(in srgb, ${optionColor(color)} 14%, transparent)` }}>
      {name}
    </span>
  );
}

export function EmptyHint({ icon = "search", title, hint, action }: { icon?: Parameters<typeof Icon>[0]["name"]; title: string; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid place-items-center px-6 py-20 text-center">
      <span className="grid size-10 place-items-center rounded-xl bg-hover text-faint">
        <Icon name={icon} size={18} />
      </span>
      <p className="mt-3 text-[14px] font-semibold">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
