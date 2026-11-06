// S10: pool options from the environment.
import { describe, expect, it } from "vitest";
import { poolConfig } from "@/db";

describe("poolConfig", () => {
  it("defaults to 5 connections, 10 s idle timeout, 5 s connect timeout", () => {
    expect(poolConfig({})).toEqual({ max: 5, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000 });
  });
  it("reads DB_POOL_MAX and ignores nonsense", () => {
    expect(poolConfig({ DB_POOL_MAX: "12" }).max).toBe(12);
    for (const v of ["", " ", "0", "-3", "2.5", "lots"]) expect(poolConfig({ DB_POOL_MAX: v }).max).toBe(5);
  });
});
