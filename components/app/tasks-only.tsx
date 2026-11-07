"use client";

import { createContext, useContext, type ReactNode } from "react";

const Ctx = createContext(false);

/** True when the user skipped the GitHub setup: the app shows tasks only. */
export function TasksOnlyProvider({ value, children }: { value: boolean; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTasksOnly(): boolean {
  return useContext(Ctx);
}
