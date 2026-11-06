import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// SPEC D1: docs/security.md exists and contains nothing org-specific.
const doc = readFileSync(new URL("../../docs/security.md", import.meta.url), "utf8");

describe("docs/security.md", () => {
  it("covers what the spec asks for", () => {
    for (const heading of [
      "## Architecture",
      "### Permissions",
      "### Storage",
      "## Local server hardening",
      "## What is stored on disk",
      "## What Deska never does",
      "## Write gate",
    ]) {
      expect(doc).toContain(heading);
    }
  });

  it("names no org, repo, project or person", () => {
    // Only placeholders may stand where an org or repo would go.
    expect(doc).not.toMatch(/github\.com\/(?!\*)[A-Za-z0-9-]+/);
    expect(doc).not.toMatch(/GITHUB_(?:REPO|ORG|PROJECT_NUMBER)=(?!<)/);
    expect(doc).not.toMatch(/\b(?:PVT|PVTF|PVTSSF|PVTIF|IT|I)_[A-Za-z0-9]{4,}/);
    expect(doc).not.toMatch(/@[A-Za-z0-9-]+\b(?!\.)/);
    // Not even the fictional dataset: the doc is generic.
    expect(doc.toLowerCase()).not.toMatch(/\bacme\b|\bwidgets\b|\balice\b|\bbob\b|\bcarol\b|\bdave\b/);
  });
});
