// Quick-add parser (SPEC §12.4). Pure and framework-free: the quick-add input
// highlights the returned token ranges and the tests drive it table-first.
//
// Each property is recognised only as whole words. The first match of a kind
// wins and later ones stay title text, except links and labels, which repeat.
// Tokens the user reverted (`ignored`) stay text wherever that text appears.
import { addDays, addMonths, weekday, ymd } from "./dates";
import { nextOccurrence } from "./recurrence";
import type { Priority } from "./model";

export type TokenKind = "date" | "time" | "recurrence" | "priority" | "label" | "project" | "link" | "assignee";

type Base = { start: number; end: number; text: string };
export type Token =
  | (Base & { kind: "date"; date: string })
  | (Base & { kind: "time"; time: string })
  | (Base & { kind: "recurrence"; rule: string; label: string; fromCompletion: boolean; firstDate: string })
  | (Base & { kind: "priority"; priority: Priority })
  | (Base & { kind: "label"; name: string })
  | (Base & { kind: "project"; name: string })
  | (Base & { kind: "link"; number: number })
  | (Base & { kind: "assignee"; login: string });

export type ParseContext = {
  /** Today in the viewer's time zone, YYYY-MM-DD. */
  today: string;
  /** Current time, HH:mm, for a time without a date (today, or tomorrow if passed). */
  now?: string;
  /** Keys from `tokenKey` the user turned back into text. */
  ignored?: ReadonlySet<string>;
  /** The viewer's project names. */
  projects?: readonly string[];
  /** Assignable logins (lowercase). */
  users?: readonly string[];
  /** Whether `#n` is a known issue. */
  hasItem?: (n: number) => boolean;
  /** `owner/name`, for pasted URLs. */
  repo?: string;
  /** Only recognise these kinds (default: all). */
  enabled?: ReadonlySet<TokenKind>;
};

export type Parsed = {
  title: string;
  tokens: Token[];
  dueDate: string | null;
  dueTime: string | null;
  priority: Priority | null;
  labels: string[];
  project: string | null;
  links: number[];
  assignee: string | null;
  recurrence: { rule: string; label: string; fromCompletion: boolean } | null;
};

export function tokenKey(kind: TokenKind, text: string): string {
  return `${kind}:${text.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

// --- dates -----------------------------------------------------------------

const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};
const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};
const WD = Object.keys(WEEKDAYS).sort((a, b) => b.length - a.length).join("|");
const MO = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");

export { addMonths, weekday };

/** The next given weekday strictly after today (a weekday never means today). */
export function nextWeekday(today: string, wd: number): string {
  const diff = (wd - weekday(today) + 7) % 7 || 7;
  return addDays(today, diff);
}

/** The given weekday in the calendar week (Mon–Sun) after this one. */
function weekdayNextWeek(today: string, wd: number): string {
  const mondayNext = addDays(today, ((1 - weekday(today) + 7) % 7) || 7);
  return addDays(mondayNext, (wd + 6) % 7);
}

/** A date without a year means its next occurrence, today included. */
function upcoming(today: string, m: number, d: number, year?: number): string | null {
  if (year) return ymd(year, m, d);
  const y = Number(today.slice(0, 4));
  const thisYear = ymd(y, m, d);
  if (thisYear && thisYear >= today) return thisYear;
  return ymd(y + 1, m, d);
}

type Match = { start: number; end: number; text: string; value: unknown };

const END = String.raw`(?=$|[\s,;!?)\]])`;
const START = String.raw`(?<=^|[\s(\[])`;

/** Regex group accessor: "" for a group that did not participate. */
type Group = (i: number) => string;

function scan(input: string, re: RegExp, value: (m: Group) => unknown): Match[] {
  const out: Match[] = [];
  const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  for (let x = rx.exec(input); x; x = rx.exec(input)) {
    const hit = x;
    const v = value((i) => hit[i] ?? "");
    if (v != null) out.push({ start: hit.index, end: hit.index + hit[0].length, text: hit[0], value: v });
    if (hit[0].length === 0) rx.lastIndex++;
  }
  return out;
}

function dateMatches(input: string, today: string): Match[] {
  const n = (s: string) => Number(s);
  const unit = (count: number, u: string) =>
    u.startsWith("day") ? addDays(today, count) : u.startsWith("week") ? addDays(today, 7 * count) : addMonths(today, count);
  return [
    ...scan(input, new RegExp(`${START}next week${END}`, "i"), () => nextWeekday(today, 1)),
    ...scan(input, new RegExp(`${START}next (${WD})${END}`, "i"), (m) => weekdayNextWeek(today, WEEKDAYS[m(1).toLowerCase()] ?? 0)),
    ...scan(input, new RegExp(`${START}in (a|an|\\d{1,3}) (days?|weeks?|months?)${END}`, "i"), (m) =>
      unit(/^an?$/i.test(m(1)) ? 1 : n(m(1)), m(2).toLowerCase()),
    ),
    ...scan(input, new RegExp(`${START}(${MO}) (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?${END}`, "i"), (m) =>
      upcoming(today, MONTHS[m(1).toLowerCase()] ?? 1, n(m(2)), m(3) ? n(m(3)) : undefined),
    ),
    ...scan(input, new RegExp(`${START}(\\d{1,2})(?:st|nd|rd|th)? (${MO})(?: (\\d{4}))?${END}`, "i"), (m) =>
      upcoming(today, MONTHS[m(2).toLowerCase()] ?? 1, n(m(1)), m(3) ? n(m(3)) : undefined),
    ),
    // Czech style: 20.10. / 20. 10. / 20.10.2026 (a trailing dot is required without a year).
    ...scan(input, new RegExp(`${START}(\\d{1,2})\\. ?(\\d{1,2})\\.(?: ?(\\d{4}))?${END}`), (m) =>
      upcoming(today, n(m(2)), n(m(1)), m(3) ? n(m(3)) : undefined),
    ),
    ...scan(input, new RegExp(`${START}(\\d{4})-(\\d{2})-(\\d{2})${END}`), (m) => ymd(n(m(1)), n(m(2)), n(m(3)))),
    ...scan(input, new RegExp(`${START}(today|tod)${END}`, "i"), () => today),
    ...scan(input, new RegExp(`${START}(tomorrow|tmrw?)${END}`, "i"), () => addDays(today, 1)),
    ...scan(input, new RegExp(`${START}(?:on )?(${WD})${END}`, "i"), (m) => nextWeekday(today, WEEKDAYS[m(1).toLowerCase()] ?? 0)),
  ];
}

function timeMatches(input: string): Match[] {
  const hhmm = (h: number, min: number) => (h < 24 && min < 60 ? `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}` : null);
  return [
    ...scan(input, new RegExp(`${START}(?:at )?(\\d{1,2})(?::(\\d{2}))? ?(am|pm)${END}`, "i"), (m) => {
      let h = Number(m(1));
      if (h < 1 || h > 12) return null;
      const pm = m(3).toLowerCase() === "pm";
      if (h === 12) h = pm ? 12 : 0;
      else if (pm) h += 12;
      return hhmm(h, Number(m(2) ?? 0));
    }),
    ...scan(input, new RegExp(`${START}(?:at )?(\\d{1,2}):(\\d{2})${END}`, "i"), (m) => hhmm(Number(m(1)), Number(m(2)))),
    ...scan(input, new RegExp(`${START}at (\\d{1,2})${END}`, "i"), (m) => hhmm(Number(m(1)), 0)),
  ];
}

// --- recurrence --------------------------------------------------------------

type Rec = { rule: string; label: string; fromCompletion: boolean; firstDate: string };

function recurrenceMatches(input: string, today: string): Match[] {
  const RE = new RegExp(
    `${START}every(!)? (?:(other) )?(?:(\\d{1,3}) )?(day|days|weekday|weekdays|week|weeks|month|months|year|years|${WD})(?: on the (\\d{1,2})(?:st|nd|rd|th)?)?${END}|${START}(daily|weekly|monthly|yearly)${END}`,
    "i",
  );
  return scan(input, RE, (m): Rec | null => {
    const fromCompletion = Boolean(m(1));
    const other = Boolean(m(2));
    const count = m(3) ? Number(m(3)) : other ? 2 : 1;
    if (count < 1) return null;
    const unitRaw = (m(4) || m(6)).toLowerCase();
    const interval = count > 1 ? `;INTERVAL=${count}` : "";
    const label = m(0).trim().toLowerCase();
    const mk = (rule: string, firstDate: string): Rec => ({ rule, label, fromCompletion, firstDate });
    if (unitRaw === "daily" || unitRaw.startsWith("day")) return mk(`FREQ=DAILY${interval}`, today);
    if (unitRaw.startsWith("weekday")) {
      // "every other weekday" / "every 3 weekdays" has no RRULE here (INTERVAL
      // would mean every other *week*), and used to be read as plain "every
      // weekday". Leave it as text instead of saving the wrong schedule.
      if (count > 1) return null;
      const wd = weekday(today);
      const first = wd === 0 ? addDays(today, 1) : wd === 6 ? addDays(today, 2) : today;
      return mk(`FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR`, first);
    }
    if (unitRaw === "weekly" || unitRaw.startsWith("week")) return mk(`FREQ=WEEKLY${interval}`, today);
    if (unitRaw === "monthly" || unitRaw.startsWith("month")) {
      if (m(5)) {
        const day = Number(m(5));
        if (day < 1 || day > 31) return null;
        const [y = 0, mo = 1] = today.split("-").map(Number);
        const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
        let first = ymd(y, mo, Math.min(day, last))!;
        if (first < today) {
          const nm = addMonths(`${today.slice(0, 7)}-01`, 1);
          const [ny = 0, nmo = 1] = nm.split("-").map(Number);
          first = ymd(ny, nmo, Math.min(day, new Date(Date.UTC(ny, nmo, 0)).getUTCDate()))!;
        }
        return mk(`FREQ=MONTHLY${interval};BYMONTHDAY=${day}`, first);
      }
      return mk(`FREQ=MONTHLY${interval}`, today);
    }
    if (unitRaw === "yearly" || unitRaw.startsWith("year")) return mk(`FREQ=YEARLY${interval}`, today);
    const wd = WEEKDAYS[unitRaw];
    if (wd !== undefined) {
      // "every friday" starts this Friday when today is Friday.
      const first = weekday(today) === wd ? today : nextWeekday(today, wd);
      return mk(`FREQ=WEEKLY${interval};BYDAY=${BYDAY[wd]}`, first);
    }
    return null;
  });
}

// --- the parser ----------------------------------------------------------------

const PRIORITY_WORDS: Record<string, Priority> = { p1: 1, urgent: 1, p2: 2, high: 2, p3: 3, medium: 3, med: 3, p4: 4, low: 4 };

export function parseQuickAdd(input: string, ctx: ParseContext): Parsed {
  const ignored = ctx.ignored ?? new Set<string>();
  const claimed: Token[] = [];
  const free = (m: { start: number; end: number }) => claimed.every((t) => m.end <= t.start || m.start >= t.end);
  const take = (kind: TokenKind, matches: Match[], build: (m: Match) => Token | null, repeat = false) => {
    if (ctx.enabled && !ctx.enabled.has(kind)) return;
    const sorted = [...matches].sort((a, b) => a.start - b.start || b.end - a.end);
    for (const m of sorted) {
      if (!free(m) || ignored.has(tokenKey(kind, m.text))) continue;
      const tok = build(m);
      if (!tok) continue;
      claimed.push(tok);
      if (!repeat) return;
    }
  };

  const repo = (ctx.repo ?? "acme/widgets").replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  take(
    "link",
    [
      ...scan(input, new RegExp(`${START}https?://github\\.com/${repo}/issues/(\\d+)[^\\s]*`, "i"), (m) => Number(m(1))),
      ...scan(input, new RegExp(`${START}#(\\d+)${END}`), (m) => Number(m(1))),
    ],
    (m) => {
      const n = m.value as number;
      return ctx.hasItem?.(n) ? { kind: "link", start: m.start, end: m.end, text: m.text, number: n } : null;
    },
    true,
  );

  const users = new Set((ctx.users ?? []).map((u) => u.toLowerCase()));
  take("assignee", scan(input, new RegExp(`${START}@([A-Za-z\\d](?:[A-Za-z\\d-]{0,38}))${END}`), (m) => m(1).toLowerCase()), (m) =>
    users.has(m.value as string) ? { kind: "assignee", start: m.start, end: m.end, text: m.text, login: m.value as string } : null,
  );

  // A label starts with a letter, so "+1" and "+2 more" stay text.
  take(
    "label",
    scan(input, new RegExp(`${START}\\+(\\p{L}[\\p{L}\\p{N}_-]*)${END}`, "u"), (m) => m(1)),
    (m) => ({ kind: "label", start: m.start, end: m.end, text: m.text, name: m.value as string }),
    true,
  );

  // Projects match known names, longest first, so multi-word names work.
  const projects = [...(ctx.projects ?? [])].sort((a, b) => b.length - a.length);
  const projectMatches: Match[] = [];
  for (const p of projects) {
    const esc = p.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    projectMatches.push(...scan(input, new RegExp(`${START}=${esc}${END}`, "iu"), () => p));
  }
  take("project", projectMatches, (m) => ({ kind: "project", start: m.start, end: m.end, text: m.text, name: m.value as string }));

  take("recurrence", recurrenceMatches(input, ctx.today), (m) => {
    const r = m.value as Rec;
    return { kind: "recurrence", start: m.start, end: m.end, text: m.text, ...r };
  });
  take("date", dateMatches(input, ctx.today), (m) => ({ kind: "date", start: m.start, end: m.end, text: m.text, date: m.value as string }));
  take("time", timeMatches(input), (m) => ({ kind: "time", start: m.start, end: m.end, text: m.text, time: m.value as string }));
  take(
    "priority",
    scan(input, new RegExp(`${START}(p[1-4]|urgent|high|medium|med|low)${END}`, "i"), (m) => PRIORITY_WORDS[m(1).toLowerCase()]),
    (m) => ({ kind: "priority", start: m.start, end: m.end, text: m.text, priority: m.value as Priority }),
  );

  const tokens = claimed.sort((a, b) => a.start - b.start);
  let title = "";
  let at = 0;
  for (const t of tokens) {
    title += input.slice(at, t.start);
    at = t.end;
  }
  title = (title + input.slice(at)).replace(/\s+/g, " ").trim();

  const find = <K extends TokenKind>(k: K) => tokens.find((t) => t.kind === k) as Extract<Token, { kind: K }> | undefined;
  const date = find("date");
  const time = find("time");
  const rec = find("recurrence");
  const dueTime = time?.time ?? null;
  let dueDate = date?.date ?? rec?.firstDate ?? null;
  // "Standup every day at 9", typed after 9: the first occurrence is the next
  // one, like a time with no date (§12.4 row 2). Otherwise the task is overdue
  // the moment it is created and its due-time reminder never fires.
  if (!date && rec && dueTime && ctx.now && dueDate === ctx.today && dueTime <= ctx.now) {
    dueDate = nextOccurrence(rec.rule, ctx.today) ?? addDays(ctx.today, 1);
  }
  if (dueTime && !dueDate) dueDate = ctx.now && dueTime <= ctx.now ? addDays(ctx.today, 1) : ctx.today;

  return {
    title,
    tokens,
    dueDate,
    dueTime,
    priority: find("priority")?.priority ?? null,
    labels: [...new Set(tokens.filter((t) => t.kind === "label").map((t) => (t as Extract<Token, { kind: "label" }>).name))],
    project: find("project")?.name ?? null,
    links: [...new Set(tokens.filter((t) => t.kind === "link").map((t) => (t as Extract<Token, { kind: "link" }>).number))],
    assignee: find("assignee")?.login ?? null,
    recurrence: rec ? { rule: rec.rule, label: rec.label, fromCompletion: rec.fromCompletion } : null,
  };
}
