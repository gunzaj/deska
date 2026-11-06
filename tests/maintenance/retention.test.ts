import { describe, expect, it } from "vitest";
import { retentionConfig } from "@/lib/maintenance/retention";

describe("retention config", () => {
  it("defaults, and env overrides", () => {
    expect(retentionConfig({})).toEqual({ notificationsReadDays: 90, notificationsUnreadDays: 180, deletedDays: 30, auditDays: 365, fieldChangesDays: 395, outboxDays: 30 });
    expect(retentionConfig({ RETENTION_DELETED_DAYS: "7", RETENTION_AUDIT_DAYS: "nope", RETENTION_NOTIFICATIONS_READ_DAYS: "0" })).toMatchObject({
      deletedDays: 7,
      auditDays: 365,
      notificationsReadDays: 90,
    });
  });
});
