import { writeMode } from "../config";

export type OutboxOp = "update" | "close" | "reopen" | "create";
export type OutboxStatus = "pending" | "done" | "failed" | "conflict";

export type OutboxEntry = {
  id: string;
  userId: string;
  issueNodeId: string;
  op: OutboxOp;
  field: string | null;
  idempotencyKey: string;
  base: unknown;
  next: unknown;
  status: OutboxStatus;
  attempts: number;
  error: string | null;
};

export function writeEnabled(): boolean {
  return writeMode();
}

/** Bulk edits over 50 issues need a confirmation dialog (SPEC §5). */
export function needsBulkConfirm(count: number): boolean {
  return count > 50;
}
