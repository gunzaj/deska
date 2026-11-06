// A second fictional project for the field mapping (SPEC §4.1, D4): the same
// `acme/widgets` issues on an "Ops Board" project whose fields are named
// differently from the predecessor's (Stage, Urgency, Squad, Surface, Cycle),
// whose Priority-like field lists its options highest first, and, with
// `{ sprint: false }`, has no iteration field at all. Every ID is made up and
// listed in tests/repo/node-ids.test.ts.
import type { FullSnapshot, SnapshotField } from "@/lib/sync/types";
import { fixtureIterations, fixtureSnapshot, projectItem } from "./fixtures";

export const ALT = {
  projectId: "PVT_acme_ops_board",
  stage: "PVTSSF_acme_stage",
  urgency: "PVTSSF_acme_urgency",
  squad: "PVTSSF_acme_squad",
  surface: "PVTSSF_acme_surface",
  cycle: "PVTIF_acme_cycle",
} as const;

export function altFields(opts: { sprint?: boolean; now?: Date } = {}): SnapshotField[] {
  return [
    {
      id: ALT.stage,
      name: "Stage",
      dataType: "SINGLE_SELECT",
      options: [
        { id: "f0000001", name: "Queued", color: "GRAY" },
        { id: "f0000002", name: "Doing", color: "BLUE" },
        { id: "f0000003", name: "Shipped", color: "GREEN" },
      ],
    },
    {
      id: ALT.urgency,
      name: "Urgency",
      dataType: "SINGLE_SELECT",
      // Highest first, unlike the main fixtures' Low/Medium/High.
      options: [
        { id: "g0000001", name: "P0", color: "RED" },
        { id: "g0000002", name: "P1", color: "ORANGE" },
        { id: "g0000003", name: "P2", color: "BLUE" },
      ],
    },
    {
      id: ALT.squad,
      name: "Squad",
      dataType: "SINGLE_SELECT",
      options: [
        { id: "h0000001", name: "Falcons", color: "PURPLE" },
        { id: "h0000002", name: "Otters", color: "GREEN" },
      ],
    },
    {
      id: ALT.surface,
      name: "Surface",
      dataType: "SINGLE_SELECT",
      options: [
        { id: "k0000001", name: "Web", color: "GRAY" },
        { id: "k0000002", name: "API", color: "GRAY" },
      ],
    },
    { id: "PVTF_acme_estimate", name: "Estimate", dataType: "NUMBER" },
    ...(opts.sprint === false ? [] : [{ id: ALT.cycle, name: "Cycle", dataType: "ITERATION", iterations: fixtureIterations(opts.now) }]),
  ];
}

/** The fixture issues on the Ops Board project. */
export function altFixtureSnapshot(opts: { sprint?: boolean; now?: Date } = {}): FullSnapshot {
  const base = fixtureSnapshot(opts.now);
  const fields = { status: ALT.stage, priority: ALT.urgency };
  const sprint = opts.sprint !== false;
  return {
    ...base,
    projectId: ALT.projectId,
    fields: altFields(opts),
    projectItems: [
      projectItem({ itemId: "PVTI_1", issueNodeId: "I_epic", statusOpt: "f0000002", priorityOpt: "g0000001", releaseIter: sprint ? "e0000023" : null }, fields, { [ALT.squad]: "h0000001", [ALT.surface]: "k0000001" }),
      projectItem({ itemId: "PVTI_2", issueNodeId: "I_sub", statusOpt: "f0000001", priorityOpt: "g0000003", releaseIter: null }, fields, { [ALT.squad]: "h0000002" }),
      projectItem({ itemId: "PVTI_3", issueNodeId: "I_bug", statusOpt: null, priorityOpt: "g0000002", releaseIter: null }, fields, { [ALT.squad]: "h0000001", [ALT.surface]: "k0000002" }),
    ],
  };
}
