"use client";

import { useSyncExternalStore } from "react";
import { getFrequent, NO_FREQUENT, subscribeFrequent, type FrequentChoices } from "@/lib/client/frequent";

/** The user's most used labels and assignees (loaded by EditsProvider). */
export function useFrequentChoices(): FrequentChoices {
  return useSyncExternalStore(subscribeFrequent, getFrequent, () => NO_FREQUENT);
}
