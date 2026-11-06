"use client";

// The viewer's default Team (set in the user menu): lists and Insights filter
// by it until the viewer turns it off for the session.
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { validDefaultTeam } from "@/lib/client/team-scope";
import { usePrefs } from "../tasks/notifications";
import { useAppData } from "./provider";

type Ctx = {
  /** The Team to filter by now, or null (no default, or switched off for this session). */
  teamId: string | null;
  /** The saved default, even while switched off. */
  defaultTeamId: string | null;
  teamName: string | null;
  off: boolean;
  setOff: (v: boolean) => void;
};

const Context = createContext<Ctx>({ teamId: null, defaultTeamId: null, teamName: null, off: false, setOff: () => {} });

export const useTeamScope = () => useContext(Context);

export function TeamScopeProvider({ children }: { children: ReactNode }) {
  const { data } = useAppData();
  const { prefs } = usePrefs();
  const [off, setOff] = useState(false);
  const value = useMemo<Ctx>(() => {
    const id = validDefaultTeam(prefs.defaultTeam, data.meta);
    return { teamId: off ? null : id, defaultTeamId: id, teamName: id ? (data.meta.fields.team.find((t) => t.id === id)?.name ?? null) : null, off, setOff };
  }, [prefs.defaultTeam, data.meta, off]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
