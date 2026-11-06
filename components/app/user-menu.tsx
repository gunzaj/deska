"use client";

// The user menu at the bottom of the sidebar: theme, the default Team that
// every list and Insights filter by, and sign out.
import { useRef, useState } from "react";
import { plainName } from "@/lib/client/format";
import { Icon, type IconName } from "../icons";
import { Avatar } from "../props";
import { usePrefs } from "../tasks/notifications";
import { Popover } from "../ui/popover";
import { type Theme, useAppData, useAppTheme } from "./provider";
import { useTeamScope } from "./team-scope";

const THEMES: { id: Theme; icon: IconName; label: string }[] = [
  { id: "system", icon: "monitor", label: "System" },
  { id: "light", icon: "sun", label: "Light" },
  { id: "dark", icon: "moon", label: "Dark" },
];

export function UserMenu({ signOutAction }: { signOutAction: () => Promise<void> }) {
  const { data, viewer, avatarOf } = useAppData();
  const { theme, setTheme } = useAppTheme();
  const { setPrefs } = usePrefs();
  const { defaultTeamId, teamName } = useTeamScope();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const teams = data.meta.fields.team;

  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-user-menu
        className="flex h-9 w-full items-center gap-2 rounded-md px-1.5 text-left hover:bg-hover"
      >
        <Avatar login={viewer} url={avatarOf(viewer)} size={22} />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[12.5px] font-medium">{viewer}</span>
          {teamName && <span className="block truncate text-[11px] text-faint">{plainName(teamName) || teamName}</span>}
        </span>
        <Icon name="chevronDown" size={13} className="rotate-180 text-faint" />
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} align="start" width={272}>
        <div className="space-y-4 p-3 text-[12.5px]" role="group" aria-label="User menu">
          <div>
            <p className="mb-1.5 font-medium text-muted">Theme</p>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-hover p-1" role="radiogroup" aria-label="Theme">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={theme === t.id}
                  onClick={() => setTheme(t.id)}
                  className={`flex h-7 items-center justify-center gap-1.5 rounded-md text-[12px] font-medium ${theme === t.id ? "bg-surface text-fg shadow-raised" : "text-muted hover:text-fg"}`}
                >
                  <Icon name={t.icon} size={12} />
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="default-team" className="mb-1.5 block font-medium text-muted">
              My team
            </label>
            <select
              id="default-team"
              value={defaultTeamId ?? ""}
              onChange={(e) => void setPrefs({ defaultTeam: e.target.value || null })}
              className="h-8 w-full rounded-md border border-line bg-field px-2 text-[12.5px] text-fg outline-none hover:border-line-field"
            >
              <option value="">No default (all teams)</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {plainName(t.name) || t.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11.5px] text-faint">Lists, triage, the backlog and Insights start filtered to this team. Switch it off on a page with the team chip in its filter bar.</p>
          </div>

          <form action={signOutAction} className="border-t border-line pt-2.5">
            <button type="submit" className="flex h-7 w-full items-center gap-2 rounded-md px-1.5 text-muted hover:bg-hover hover:text-fg">
              <Icon name="logout" size={14} />
              Sign out
            </button>
          </form>
        </div>
      </Popover>
    </>
  );
}
