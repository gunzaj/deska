// This repo is public (SPEC §0.2): no real GitHub node IDs anywhere. Project,
// field and issue type IDs must come from the fictional acme/widgets set below.
// A new fictional ID goes in FICTIONAL; a real one gets replaced, not listed.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FICTIONAL = new Set([
  // lib/demo/fixtures.ts and lib/demo/generate.ts
  "PVT_acme_widgets_roadmap",
  "PVTSSF_acme_status",
  "PVTSSF_acme_priority",
  "PVTSSF_acme_team",
  "PVTSSF_acme_platform",
  "PVTIF_acme_release",
  "IT_acme_task",
  "IT_acme_bug",
  "IT_acme_feature",
  // lib/demo/fixtures-alt.ts: the differently named project (D4)
  "PVT_acme_ops_board",
  "PVTSSF_acme_stage",
  "PVTSSF_acme_urgency",
  "PVTSSF_acme_squad",
  "PVTSSF_acme_surface",
  "PVTF_acme_estimate",
  "PVTIF_acme_cycle",
  // tests
  "PVT_other_project",
  "PVT_some_other_project",
  "IT_bug",
  "IT_feature",
]);

const NODE_ID = /\b(?:PVT|PVTF|PVTSSF|PVTIF|IT)_[A-Za-z0-9_-]+/g;

/** Node-ID-shaped tokens in `text` that are not in the fictional set. */
export function unknownNodeIds(text: string): string[] {
  return [...new Set(text.match(NODE_ID) ?? [])].filter((id) => !FICTIONAL.has(id));
}

function repoFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
    .split("\0")
    .filter((f) => f && !f.startsWith("private/"));
}

describe("GitHub node IDs (SPEC §0.2)", () => {
  it("flags a real-looking ID and accepts the fictional ones", () => {
    // Built at runtime so this file holds no real-looking ID itself.
    const real = ["PVTSSF", "lADOABCDEF12345zgAYi50"].join("_");
    expect(unknownNodeIds(`field ${real} and PVTSSF_acme_status`)).toEqual([real]);
    expect(unknownNodeIds("IT_acme_bug, PVT_acme_widgets_roadmap")).toEqual([]);
  });

  it("no file in the repo holds a node ID outside the fictional set", () => {
    const found: string[] = [];
    for (const file of repoFiles()) {
      let buf: Buffer;
      try {
        buf = readFileSync(file);
      } catch {
        continue; // deleted in the working tree
      }
      if (buf.subarray(0, 8000).includes(0)) continue; // binary
      for (const id of unknownNodeIds(buf.toString("utf8"))) found.push(`${file}: ${id}`);
    }
    expect(found).toEqual([]);
  });
});
