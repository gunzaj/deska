import { afterEach, describe, expect, it } from "vitest";
import { demoEnabled, getStore } from "@/lib/store";

function setNodeEnv(value: string) {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

describe("demo fixtures must never be the production default", () => {
  afterEach(() => {
    delete process.env.DESKA_DB_DIR;
    delete process.env.DEMO;
    delete process.env.WRITE_MODE;
    setNodeEnv("test");
  });

  it("is off in production with no DESKA_DB_DIR", () => {
    // Regression: getStore() fell back to fixtures whenever the sync store was
    // empty, so a cold production start served fabricated issues to real users.
    setNodeEnv("production");
    delete process.env.DEMO;
    expect(demoEnabled()).toBe(false);
  });

  it("needs an explicit DEMO=1 even in production", () => {
    setNodeEnv("production");
    delete process.env.DEMO;
    expect(demoEnabled()).toBe(false);
    process.env.DEMO = "1";
    expect(demoEnabled()).toBe(true);
  });

  it("refuses to serve fixtures when writes are enabled", async () => {
    // Fixture node IDs are not real issues; writing them through the outbox
    // would push mutations against arbitrary GitHub IDs.
    setNodeEnv("production");
    process.env.DEMO = "1";
    process.env.WRITE_MODE = "on";
    await expect(getStore()).rejects.toThrow(/not writable/);
  });

  it("fails loudly rather than inventing data when nothing is configured", async () => {
    setNodeEnv("production");
    delete process.env.DEMO;
    await expect(getStore()).rejects.toThrow(/No data source configured/);
  });

  it("is on locally when nothing else is configured", () => {
    setNodeEnv("development");
    delete process.env.DEMO;
    delete process.env.DESKA_DB_DIR;
    expect(demoEnabled()).toBe(true);
  });

  it("is off when a database is configured", () => {
    setNodeEnv("development");
    process.env.DESKA_DB_DIR = "memory://";
    expect(demoEnabled()).toBe(false);
  });
});
