// Retention (IMPROVEMENTS S8), run by the nightly job after the reconcile.
// Nothing was ever cleaned up: notifications were only removed with their
// task, and soft-deleted tasks and comments stayed forever.
//
// task_completions are kept: they are history users may want. issue_field_changes (F0) are kept 13 months.
import { and, isNotNull, isNull, lt, ne } from "drizzle-orm";
import { databaseUrl, getDb } from "@/db";
import { auditLog, issueFieldChanges, notifications, outbox, taskComments, tasks, triageSnoozes, views } from "@/db/schema";

export type RetentionConfig = {
  /** Read notifications older than this go (default 90). */
  notificationsReadDays: number;
  /** Unread notifications older than this go (default 180). */
  notificationsUnreadDays: number;
  /** Soft-deleted tasks, comments and views are hard-deleted after this (default 30). */
  deletedDays: number;
  /** audit_log rows older than this go (default 365). */
  auditDays: number;
  /** issue_field_changes rows older than this go (default 395, about 13 months; F0). */
  fieldChangesDays: number;
  /** Finished (done/failed/conflict) outbox rows older than this go (default 30). */
  outboxDays: number;
};

function days(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return raw?.trim() && Number.isFinite(n) && n > 0 ? n : fallback;
}

export function retentionConfig(env: Record<string, string | undefined> = process.env): RetentionConfig {
  return {
    notificationsReadDays: days(env.RETENTION_NOTIFICATIONS_READ_DAYS, 90),
    notificationsUnreadDays: days(env.RETENTION_NOTIFICATIONS_UNREAD_DAYS, 180),
    deletedDays: days(env.RETENTION_DELETED_DAYS, 30),
    auditDays: days(env.RETENTION_AUDIT_DAYS, 365),
    fieldChangesDays: days(env.RETENTION_FIELD_CHANGES_DAYS, 395),
    outboxDays: days(env.RETENTION_OUTBOX_DAYS, 30),
  };
}

export type RetentionResult = {
  notificationsRead: number;
  notificationsUnread: number;
  tasks: number;
  comments: number;
  views: number;
  audit: number;
  fieldChanges: number;
  snoozes: number;
  outbox: number;
};

/**
 * Delete what is past its retention, in one transaction so a failure part-way
 * leaves nothing half-cleaned. A hard-deleted task takes its placements, links,
 * reminders, comments and notifications with it (S7 cascades). No-op without a
 * database.
 */
export async function runRetention(now = new Date(), cfg: RetentionConfig = retentionConfig()): Promise<RetentionResult> {
  const result: RetentionResult = { notificationsRead: 0, notificationsUnread: 0, tasks: 0, comments: 0, views: 0, audit: 0, fieldChanges: 0, snoozes: 0, outbox: 0 };
  if (!databaseUrl()) return result;
  const ago = (d: number) => new Date(now.getTime() - d * 86_400_000);
  const today = now.toISOString().slice(0, 10);

  await getDb().transaction(async (tx) => {
    result.notificationsRead = (
      await tx
        .delete(notifications)
        .where(and(isNotNull(notifications.readAt), lt(notifications.createdAt, ago(cfg.notificationsReadDays))))
        .returning({ id: notifications.id })
    ).length;
    result.notificationsUnread = (
      await tx
        .delete(notifications)
        .where(and(isNull(notifications.readAt), lt(notifications.createdAt, ago(cfg.notificationsUnreadDays))))
        .returning({ id: notifications.id })
    ).length;
    result.comments = (
      await tx
        .delete(taskComments)
        .where(lt(taskComments.deletedAt, ago(cfg.deletedDays)))
        .returning({ id: taskComments.id })
    ).length;
    result.tasks = (
      await tx
        .delete(tasks)
        .where(lt(tasks.deletedAt, ago(cfg.deletedDays)))
        .returning({ id: tasks.id })
    ).length;
    result.views = (
      await tx
        .delete(views)
        .where(lt(views.deletedAt, ago(cfg.deletedDays)))
        .returning({ id: views.id })
    ).length;
    result.audit = (
      await tx
        .delete(auditLog)
        .where(lt(auditLog.at, ago(cfg.auditDays)))
        .returning({ id: auditLog.id })
    ).length;
    result.fieldChanges = (
      await tx
        .delete(issueFieldChanges)
        .where(lt(issueFieldChanges.observedAt, ago(cfg.fieldChangesDays)))
        .returning({ id: issueFieldChanges.id })
    ).length;
    // Finished outbox rows are a record, not a queue: pending ones are still
    // being retried and must stay.
    result.outbox = (
      await tx
        .delete(outbox)
        .where(and(ne(outbox.status, "pending"), lt(outbox.createdAt, ago(cfg.outboxDays))))
        .returning({ id: outbox.id })
    ).length;
    // Triage snoozes whose day has passed are back in the queues already (F3).
    result.snoozes = (
      await tx
        .delete(triageSnoozes)
        .where(lt(triageSnoozes.until, today))
        .returning({ login: triageSnoozes.login })
    ).length;
  });
  return result;
}
