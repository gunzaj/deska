"use client";

import { IssueDetailView } from "../issue/detail";

export function IssuePage({ number }: { number: number }) {
  return <IssueDetailView number={number} mode="page" />;
}
