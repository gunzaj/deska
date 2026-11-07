// SPEC D5: /importing's four gates, and the order they are checked in. The page
// itself only renders the progress screen, so the wrong-redirect bugs live here.
import { describe, expect, it, vi } from "vitest";
import { resolveImportDestination, type ImportGates } from "@/lib/import-destination";

function gates(overrides: Partial<Record<keyof ImportGates, unknown>> = {}): ImportGates & Record<"setup" | "first", ReturnType<typeof vi.fn>> {
  const setup = vi.fn(async () => false);
  const first = vi.fn(async () => true);
  return {
    signedIn: () => true,
    desktop: () => true,
    needsProjectSetup: setup,
    needsFirstImport: first,
    setup,
    first,
    ...overrides,
  } as ImportGates & Record<"setup" | "first", ReturnType<typeof vi.fn>>;
}

describe("resolveImportDestination", () => {
  it("shows the progress screen when every gate passes", async () => {
    expect(await resolveImportDestination(gates())).toBe("importing");
  });

  it("sends a signed-out visitor to onboarding first, before the desktop gate", async () => {
    const g = gates({ signedIn: () => false, desktop: () => false });
    expect(await resolveImportDestination(g)).toBe("onboarding");
    expect(g.setup).not.toHaveBeenCalled();
  });

  it("sends a signed-in browser request to /issues: the page is desktop-only", async () => {
    const g = gates({ desktop: () => false });
    expect(await resolveImportDestination(g)).toBe("issues");
    // The two database gates never run outside the desktop app.
    expect(g.setup).not.toHaveBeenCalled();
    expect(g.first).not.toHaveBeenCalled();
  });

  it("sends a missing project or mapping to onboarding step 2, before the import gate", async () => {
    const g = gates({ needsProjectSetup: vi.fn(async () => true) });
    expect(await resolveImportDestination(g)).toBe("onboarding-step-2");
    expect(g.first).not.toHaveBeenCalled();
  });

  it("sends a finished import to /issues", async () => {
    expect(await resolveImportDestination(gates({ needsFirstImport: vi.fn(async () => false) }))).toBe("issues");
  });

  it("settles the two cheap gates before touching the database", async () => {
    const order: string[] = [];
    await resolveImportDestination({
      signedIn: () => { order.push("signedIn"); return true; },
      desktop: () => { order.push("desktop"); return true; },
      needsProjectSetup: async () => { order.push("needsProjectSetup"); return false; },
      needsFirstImport: async () => { order.push("needsFirstImport"); return true; },
    });
    expect(order).toEqual(["signedIn", "desktop", "needsProjectSetup", "needsFirstImport"]);
  });
});
