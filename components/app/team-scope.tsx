"use client";

// The viewer's "My default" value of a mapped dimension (set in the user
// menu, §4.1): lists and Insights filter by it until the viewer turns it off
// for the session.
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { validDefault, type DefaultScope } from "@/lib/client/team-scope";
import { usePrefs } from "../tasks/notifications";
import { useAppData } from "./provider";

type Ctx = {
  /** The value to filter by now, or null (no default, or switched off for this session). */
  scope: DefaultScope | null;
  /** The saved default, even while switched off. */
  defaultScope: DefaultScope | null;
  off: boolean;
  setOff: (v: boolean) => void;
};

const Context = createContext<Ctx>({ scope: null, defaultScope: null, off: false, setOff: () => {} });

export const useDefaultScope = () => useContext(Context);

export function DefaultScopeProvider({ children }: { children: ReactNode }) {
  const { data } = useAppData();
  const { prefs } = usePrefs();
  const [off, setOff] = useState(false);
  const value = useMemo<Ctx>(() => {
    const d = validDefault(prefs.defaultTeam, data.meta);
    return { scope: off ? null : d, defaultScope: d, off, setOff };
  }, [prefs.defaultTeam, data.meta, off]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
