// Deterministic, realistic demo dataset for local development and UI review.
// It describes the fictional `acme/widgets` repo and its "Widgets Roadmap"
// project (SPEC §0.2): every ID, name, login and issue here is made up.
// Links point at a sample repo, so a demo row never opens a live issue.
// Never used when DESKA_DB_DIR is set (see lib/store.ts).
import { withSubSummaries } from "./summaries";
import type { FullSnapshot, SnapshotIssue, SnapshotProjectItem } from "@/lib/sync/types";
import { fixtureSnapshot, projectItem } from "./fixtures";

const ITEM_FIELDS = { status: "PVTSSF_acme_status", priority: "PVTSSF_acme_priority", sprint: "PVTIF_acme_release" };
const TEAM_FIELD = "PVTSSF_acme_team";
const PLATFORM_FIELD = "PVTSSF_acme_platform";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STATUS = [
  { id: "a0000001", name: "📋 To do", color: "BLUE" },
  { id: "a0000002", name: "🚧 In progress", color: "PURPLE" },
  { id: "a0000003", name: "👀 In review", color: "ORANGE" },
  { id: "a0000004", name: "🧪 Ready for QA", color: "YELLOW" },
  { id: "a0000005", name: "🔬 In QA", color: "PURPLE" },
  { id: "a0000006", name: "✅ Done", color: "GREEN" },
  { id: "a0000007", name: "⛔ Blocked", color: "GRAY" },
];
const PLATFORM = [
  { id: "d0000001", name: "🖥️ Desktop", color: "GRAY" },
  { id: "d0000002", name: "📱 Mobile", color: "GRAY" },
  { id: "d0000003", name: "🌐 Web", color: "GRAY" },
  { id: "d0000004", name: "🔌 API", color: "GRAY" },
  { id: "d0000005", name: "⚙️ Backend", color: "GRAY" },
  { id: "d0000006", name: "🔧 Dependencies", color: "GRAY" },
];
const TEAM = [
  { id: "c0000001", name: "Core 🧱", color: "YELLOW" },
  { id: "c0000002", name: "Checkout 🛒", color: "PINK" },
  { id: "c0000003", name: "Foundations 🏗️", color: "PURPLE" },
  { id: "c0000004", name: "Design 🎨", color: "BLUE" },
  { id: "c0000005", name: "Integrations 🔌", color: "GRAY" },
  { id: "c0000006", name: "Billing 💳", color: "ORANGE" },
  { id: "c0000007", name: "Localization 🌐", color: "GREEN" },
  { id: "c0000008", name: "Performance WG ⚡️", color: "YELLOW" },
  { id: "c0000009", name: "DevOps ⛓", color: "GRAY" },
  { id: "c0000010", name: "QA 🧪", color: "GRAY" },
];
const PRIORITY = [
  { id: "b0000001", name: "Low", color: "BLUE" },
  { id: "b0000002", name: "Medium", color: "YELLOW" },
  { id: "b0000003", name: "High", color: "RED" },
];
const DAY = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Release iterations relative to `now`, newest first: "Sprint 24" is always
 * the current one (it started 2 days ago), so the demo never goes stale.
 */
function releases(now: Date) {
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const plan = [
    { id: "e0000020", title: "Sprint 20", duration: 28 },
    { id: "e0000021", title: "Sprint 21", duration: 28 },
    { id: "e0000022", title: "Sprint 22", duration: 35 },
    { id: "e0000023", title: "Sprint 23", duration: 28 },
    { id: "e0000024", title: "Sprint 24", duration: 28 },
    { id: "e0000025", title: "Sprint 25", duration: 35 },
    { id: "e0000026", title: "Sprint 26", duration: 28 },
    { id: "e0000027", title: "Sprint 27", duration: 28 },
  ];
  const currentIdx = 4;
  let start = today - 2 * DAY;
  for (let i = currentIdx - 1; i >= 0; i--) start -= plan[i]!.duration * DAY;
  const out = plan.map((r) => {
    const it = { ...r, startDate: isoDay(start) };
    start += r.duration * DAY;
    return it;
  });
  return out.reverse();
}
const LABELS = [
  ["bug", "d73a4a"], ["UI", "1d76db"], ["design needed", "e99695"], ["accounts", "c5def5"],
  ["dashboard", "0e8a16"], ["checkout", "fbca04"], ["billing", "5319e7"], ["regression", "b60205"],
  ["tech-debt", "bfd4f2"], ["a11y", "006b75"], ["i18n", "c2e0c6"], ["integrations", "0052cc"],
  ["api", "fef2c0"], ["security", "ee0701"], ["performance", "f9d0c4"], ["needs-info", "d4c5f9"],
  ["good first issue", "7057ff"], ["analytics", "bfdadc"], ["onboarding", "a2eeef"], ["export", "ededed"],
].map(([name, color], i) => ({ id: `LA_d${i}`, name: name!, color: color!, description: "" }));
/** Sample issues live here, never on the repository Deska syncs. */
export const DEMO_REPO = "deska-demo/sample";

const USERS = [
  "ada-demo", "kai-demo", "nora-demo", "leo-demo", "ivy-demo", "sam-demo", "rui-demo",
  "noa-demo", "eli-demo", "max-demo", "tao-demo", "nia-demo", "omi-demo", "zeke-demo",
].map((login, i) => ({ githubId: `U_d${i}`, login, avatarUrl: null }));

const AREAS: { area: string; team: number; platform: number; labels: string[]; titles: string[] }[] = [
  {
    area: "Dashboard", team: 0, platform: 2, labels: ["dashboard", "UI"],
    titles: [
      "Sales chart flickers when switching time range",
      "Show the order count next to each store in the sidebar",
      "Dashboard widget table: sort by weekly change",
      "Empty state for the dashboard when all widgets are hidden",
      "Stats card overflows on narrow windows",
      "Add 'hide inactive widgets' toggle to the dashboard",
    ],
  },
  {
    area: "Editor", team: 0, platform: 2, labels: ["UI"],
    titles: [
      "Undo resets the selection after editing a widget title",
      "Pasting text with trailing whitespace fails validation",
      "Autosave ignores changes made while offline",
      "Preview truncates long widget names",
      "Warn before publishing a widget that another editor has open",
      "Allow inserting an image from the clipboard",
    ],
  },
  {
    area: "Checkout", team: 1, platform: 4, labels: ["checkout"],
    titles: [
      "Cart totals refresh too aggressively",
      "Show the shipping estimate in the order summary",
      "Address form loses state on back",
      "Coupon validation times out for large carts",
      "Cache tax rates per region",
      "Show payment method status in checkout settings",
    ],
  },
  {
    area: "Billing", team: 5, platform: 2, labels: ["billing"],
    titles: [
      "Invoice preview shows the wrong period after a plan change",
      "Usage chart is empty for new workspaces",
      "Explain proration in the billing page",
      "Download button stays disabled after the invoice is ready",
    ],
  },
  {
    area: "Accounts", team: 2, platform: 2, labels: ["accounts"],
    titles: [
      "Group member accounts under their workspace",
      "Rename a workspace inline from the header",
      "Sign-in gets stuck on 'Checking session' with two tabs open",
      "Admin badge overlaps the avatar",
      "Member search should match by name and email",
    ],
  },
  {
    area: "Integrations", team: 6, platform: 3, labels: ["integrations"],
    titles: [
      "Add a webhook for widget updates",
      "Calendar sync drops events with long titles",
      "Show the integration icon next to imported widgets",
      "Support a custom endpoint for exports",
      "Spreadsheet import: keep column order",
    ],
  },
  {
    area: "Onboarding", team: 3, platform: 2, labels: ["onboarding", "design needed"],
    titles: [
      "Redesign the 'Create your first widget' success screen",
      "Reminder to invite a teammate after the first widget",
      "Setup checklist blocks when the sample data is missing",
      "Onboarding analytics: track drop-off per step",
      "Translate onboarding tips into Czech and Spanish",
    ],
  },
  {
    area: "Mobile", team: 3, platform: 1, labels: ["UI"],
    titles: [
      "Mobile: biometric prompt shows twice on cold start",
      "Mobile: pull to refresh does not refresh widget stats",
      "Mobile: haptic feedback on save",
      "Mobile: widget list jumps when stats load",
      "Mobile: keyboard covers the title field on small phones",
    ],
  },
  {
    area: "API", team: 4, platform: 3, labels: ["api"],
    titles: [
      "API: pagination cursor breaks after a deleted widget",
      "API: deprecate legacy list params",
      "API explorer: add example for bulk update",
      "Rate limit headers missing on error responses",
    ],
  },
  {
    area: "Performance", team: 7, platform: 0, labels: ["performance"],
    titles: [
      "Startup takes >6s with 40 workspaces",
      "Reduce re-renders in the widget list",
      "Lazy-load stats for hidden widgets",
      "Memory grows when the app stays open overnight",
    ],
  },
  {
    area: "Infra", team: 8, platform: 5, labels: ["tech-debt"],
    titles: [
      "Bump Electron to the next LTS",
      "Flaky e2e: editor-autosave times out on CI",
      "Migrate the desktop build to the new signing certificate",
      "Remove unused polyfills from the web bundle",
    ],
  },
  {
    area: "QA", team: 9, platform: 2, labels: ["regression"],
    titles: [
      "Regression: settings page blank after reset",
      "Regression: search field loses focus on Linux",
      "Test plan for the workspaces release",
    ],
  },
];

const EPICS = [
  { title: "Epic: Workspaces v2", area: 4 },
  { title: "Epic: Checkout 2.0", area: 2 },
  { title: "Epic: Dashboard redesign", area: 0 },
  { title: "Epic: Usage-based billing", area: 3 },
  { title: "Epic: New onboarding flow", area: 6 },
  { title: "Epic: Startup performance", area: 9 },
  { title: "Epic: Mobile editor parity", area: 7 },
  { title: "Epic: Integrations marketplace", area: 5 },
];

const SUFFIXES = ["", "", "", " (follow-up)", " on Windows", " on macOS", " for large workspaces", " in dark mode", " with two accounts", " after an update"];

function body(rand: () => number, title: string, area: string): string {
  const steps = 2 + Math.floor(rand() * 3);
  const lines = [
    `## Description`,
    ``,
    `${title}. Reported by the ${area} squad during the last release cycle.`,
    ``,
    `## Steps to reproduce`,
    ...Array.from({ length: steps }, (_, i) => `${i + 1}. ${["Open Widgets", "Sign in as an admin", "Go to the workspace", "Open the editor", "Switch to dark mode", "Enable two-factor sign-in"][Math.floor(rand() * 6)]}`),
    ``,
    `## Expected`,
    `It works without a glitch.`,
    ``,
    `- [ ] Design reviewed`,
    `- [ ] QA checked on desktop and web`,
  ];
  if (rand() < 0.3) lines.push(``, "```", "TypeError: Cannot read properties of undefined (reading 'title')", "```");
  return lines.join("\n");
}

let cache: { key: string; snapshot: FullSnapshot } | null = null;

/** ~650 issues. Dates are relative to today so "new this week" stays alive. */
export function demoSnapshot(now = new Date()): FullSnapshot {
  const key = now.toISOString().slice(0, 10);
  if (cache?.key === key) return cache.snapshot;
  const rand = rng(20261012);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const today = Date.parse(`${key}T12:00:00Z`);
  const base = fixtureSnapshot(now);
  const issues: SnapshotIssue[] = [];
  const items: SnapshotProjectItem[] = [];
  const labelId = (name: string) => LABELS.find((l) => l.name === name)!.id;
  const RELEASES = releases(now);
  const releasesAsc = [...RELEASES].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const currentIdx = releasesAsc.findIndex((r) => {
    const s = Date.parse(`${r.startDate}T00:00:00Z`);
    return s <= today && today < s + r.duration * DAY;
  });

  let number = 15020;
  const epicIds: { nodeId: string; area: number }[] = [];
  for (const e of EPICS) {
    const nodeId = `I_demo_${number}`;
    epicIds.push({ nodeId, area: e.area });
    issues.push({
      nodeId, number, title: e.title, body: body(rand, e.title, AREAS[e.area]!.area), state: "open", stateReason: null,
      typeId: "IT_acme_feature", milestoneId: null, parentNodeId: null, authorLogin: pick(USERS).login,
      url: `https://github.com/${DEMO_REPO}/issues/${number}`,
      createdAt: new Date(today - (60 + rand() * 200) * DAY).toISOString(),
      updatedAt: new Date(today - rand() * 10 * DAY).toISOString(), closedAt: null,
      labelIds: AREAS[e.area]!.labels.map(labelId), assigneeIds: [pick(USERS).githubId],
    });
    items.push(
      projectItem(
        { itemId: `PVTI_demo_${number}`, issueNodeId: nodeId, statusOpt: STATUS[1]!.id, priorityOpt: PRIORITY[2]!.id, releaseIter: releasesAsc[Math.max(0, currentIdx) + Math.floor(rand() * 3)]?.id ?? null },
        ITEM_FIELDS,
        { [TEAM_FIELD]: TEAM[AREAS[e.area]!.team]!.id, [PLATFORM_FIELD]: PLATFORM[AREAS[e.area]!.platform]!.id },
      ),
    );
    number += 1 + Math.floor(rand() * 4);
  }

  for (let n = 0; n < 640; n++) {
    const areaIdx = Math.floor(rand() * AREAS.length);
    const area = AREAS[areaIdx]!;
    const title = pick(area.titles) + pick(SUFFIXES);
    const ageDays = Math.pow(rand(), 1.6) * 330;
    const created = today - ageDays * DAY;
    const closed = rand() < (ageDays > 60 ? 0.35 : 0.12);
    const updated = Math.min(today, created + rand() * Math.min(ageDays, 120) * DAY);
    const nodeId = `I_demo_${number}`;
    const isBug = /regression|fails|flicker|wrong|stuck|blank|bug|overflow|resets|loses|does not|twice|flaky|times out/i.test(title);
    const typeRoll = rand();
    const typeId = isBug ? "IT_acme_bug" : typeRoll < 0.15 ? null : typeRoll < 0.55 ? "IT_acme_task" : "IT_acme_feature";
    const epic = rand() < 0.22 ? epicIds.find((e) => e.area === areaIdx) ?? null : null;
    const labelIds = [...new Set([...area.labels.filter(() => rand() < 0.7), ...(isBug ? ["bug"] : []), ...(rand() < 0.15 ? [pick(LABELS).name] : [])])].map(labelId);
    const assigneeCount = rand() < 0.28 ? 0 : rand() < 0.85 ? 1 : 2;
    const assignees = [...new Set(Array.from({ length: assigneeCount }, () => pick(USERS).githubId))];
    issues.push({
      nodeId, number, title, body: body(rand, title, area.area), state: closed ? "closed" : "open",
      stateReason: closed ? (rand() < 0.85 ? "completed" : "not_planned") : null,
      typeId, milestoneId: null, parentNodeId: epic?.nodeId ?? null, authorLogin: pick(USERS).login,
      url: `https://github.com/${DEMO_REPO}/issues/${number}`,
      createdAt: new Date(created).toISOString(), updatedAt: new Date(updated).toISOString(),
      closedAt: closed ? new Date(updated).toISOString() : null, labelIds, assigneeIds: assignees,
    });

    // ~12% never made it into the project; others are partly triaged.
    if (rand() < 0.88) {
      const triaged = rand() < 0.72;
      let releaseIter: string | null = null;
      const closedRecently = closed && today - updated < 6 * DAY;
      if (closedRecently) releaseIter = releasesAsc[currentIdx]?.id ?? null;
      else if (closed) releaseIter = releasesAsc[Math.max(0, currentIdx - 1 - Math.floor(rand() * 3))]?.id ?? null;
      else if (triaged && rand() < 0.75) releaseIter = releasesAsc[Math.max(0, currentIdx) + Math.floor(Math.pow(rand(), 2) * 4)]?.id ?? null;
      const inCurrent = releaseIter === releasesAsc[currentIdx]?.id;
      const statusIdx = closed ? 5 : inCurrent ? Math.floor(rand() * 7) : releaseIter ? (rand() < 0.8 ? 0 : 6) : rand() < 0.5 ? 0 : -1;
      const statusOpt = statusIdx >= 0 ? STATUS[statusIdx]!.id : null;
      const priorityOpt = triaged || rand() < 0.3 ? PRIORITY[rand() < 0.2 ? 2 : rand() < 0.6 ? 1 : 0]!.id : null;
      const team = triaged || rand() < 0.5 ? TEAM[area.team]!.id : null;
      const platform = rand() < 0.7 ? PLATFORM[area.platform]!.id : null;
      items.push(projectItem({ itemId: `PVTI_demo_${number}`, issueNodeId: nodeId, statusOpt, priorityOpt, releaseIter }, ITEM_FIELDS, { [TEAM_FIELD]: team, [PLATFORM_FIELD]: platform }));
    }
    number += 1 + Math.floor(rand() * 3);
  }

  const snapshot: FullSnapshot = {
    projectId: base.projectId,
    fields: [
      { id: "PVTSSF_acme_status", name: "Status", dataType: "SINGLE_SELECT", options: STATUS },
      { id: "PVTSSF_acme_platform", name: "Platform", dataType: "SINGLE_SELECT", options: PLATFORM },
      { id: "PVTSSF_acme_team", name: "Team", dataType: "SINGLE_SELECT", options: TEAM },
      { id: "PVTSSF_acme_priority", name: "Priority", dataType: "SINGLE_SELECT", options: PRIORITY },
      { id: "PVTIF_acme_release", name: "Release", dataType: "ITERATION", iterations: RELEASES },
    ],
    issueTypes: base.issueTypes,
    labels: LABELS,
    milestones: [],
    ghUsers: USERS,
    issues: withSubSummaries(issues),
    projectItems: items,
  };
  cache = { key, snapshot };
  return snapshot;
}
