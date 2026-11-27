// The calendar helper (CALENDAR-SPEC §2.2): spawns `deska-calendar`, talks one
// JSON object per line over stdin/stdout, and answers the server's requests.
// Event data stays in this process and the server's memory; it is never
// written to a file, a log or a backup (C-F).
//
// Tests and dev never run the helper: `DESKA_CALENDAR_FIXTURE=<file>` (never in
// a packaged build) answers from fictional JSON instead.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync } from "node:fs";
import type { CalendarEvent, CalendarFixture, CalendarInfo, CalendarReadStatus } from "./bridge";
import { meetingUrl } from "./navigation";

const REQUEST_TIMEOUT_MS = 10_000;
/** The macOS prompt waits for a person: the answer may take minutes, not seconds. */
const PROMPT_TIMEOUT_MS = 10 * 60_000;
/** The helper refuses a longer window too. */
const MAX_WINDOW_MS = 42 * 86_400_000;

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

function isCalendar(v: unknown): v is CalendarInfo {
  const c = v as Partial<CalendarInfo>;
  return !!c && typeof c.id === "string" && typeof c.title === "string";
}

function isEvent(v: unknown): v is CalendarEvent {
  const e = v as Partial<CalendarEvent>;
  return !!e && typeof e.id === "string" && typeof e.calendarId === "string" && typeof e.start === "string" && typeof e.end === "string" && typeof e.allDay === "boolean";
}

/**
 * Only the fields of CALENDAR-SPEC §2.2 leave this module. A helper that ever
 * sent more (notes' text, attendee emails, an alarm) cannot leak it through here.
 */
function pickEvent(e: CalendarEvent): CalendarEvent {
  const status = e.myStatus;
  return {
    id: e.id,
    calendarId: e.calendarId,
    title: typeof e.title === "string" ? e.title : "",
    start: e.start,
    end: e.end,
    allDay: e.allDay === true,
    timeZone: typeof e.timeZone === "string" ? e.timeZone : null,
    location: typeof e.location === "string" ? e.location : null,
    url: typeof e.url === "string" ? e.url : null,
    // Checked again here: only a link on the allowlist may come out of the notes.
    meetingUrl: typeof e.meetingUrl === "string" && meetingUrl(e.meetingUrl) ? e.meetingUrl : null,
    myStatus: status === "accepted" || status === "declined" || status === "tentative" || status === "pending" || status === "delegated" || status === "unknown" ? status : null,
    organizerIsMe: e.organizerIsMe === true,
    attendeeCount: typeof e.attendeeCount === "number" && e.attendeeCount >= 0 ? e.attendeeCount : 0,
    isRecurring: e.isRecurring === true,
    occurrenceDate: typeof e.occurrenceDate === "string" ? e.occurrenceDate : null,
  };
}

function pickCalendar(c: CalendarInfo): CalendarInfo {
  return {
    id: c.id,
    title: c.title,
    color: typeof c.color === "string" ? c.color : "#7a7a7a",
    source: typeof c.source === "string" ? c.source : "",
    allowsWrite: c.allowsWrite === true,
    subscribed: c.subscribed === true,
    birthday: c.birthday === true,
  };
}

function readFixture(file: string): CalendarFixture | null {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<CalendarFixture>;
    return {
      status: typeof raw.status === "string" ? (raw.status as CalendarReadStatus) : "fullAccess",
      calendars: Array.isArray(raw.calendars) ? raw.calendars.filter(isCalendar).map(pickCalendar) : [],
      events: Array.isArray(raw.events) ? raw.events.filter(isEvent).map(pickEvent) : [],
    };
  } catch {
    return null;
  }
}

export class CalendarHelper {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private readonly listeners = new Set<() => void>();
  private readonly fixture: CalendarFixture | null;

  constructor(
    private readonly bin: string | null,
    fixtureFile: string | null,
  ) {
    this.fixture = fixtureFile ? readFixture(fixtureFile) : null;
  }

  /** Whether a fixture is answering (tests and dev). */
  get fixtureMode(): boolean {
    return this.fixture != null;
  }

  onChanged(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** macOS's permission state. Never prompts. */
  async status(): Promise<CalendarReadStatus> {
    if (this.fixture) return this.fixture.status;
    if (!this.bin) return "unavailable";
    try {
      return mapStatus(await this.request("status"));
    } catch {
      return "unavailable";
    }
  }

  /** Asks for full access. Called only after the user clicked "Connect calendars". */
  async requestAccess(): Promise<CalendarReadStatus> {
    if (this.fixture) return this.fixture.status;
    if (!this.bin) return "unavailable";
    try {
      return mapStatus(await this.request("requestAccess", {}, PROMPT_TIMEOUT_MS));
    } catch {
      return "unavailable";
    }
  }

  async calendars(): Promise<CalendarInfo[]> {
    if (this.fixture) return this.fixture.status === "fullAccess" ? this.fixture.calendars : [];
    const list = await this.request("calendars");
    return Array.isArray(list) ? list.filter(isCalendar).map(pickCalendar) : [];
  }

  async events(from: string, to: string, calendarIds: string[]): Promise<CalendarEvent[]> {
    const start = Date.parse(from);
    const end = Date.parse(to);
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start || end - start > MAX_WINDOW_MS) throw new Error("invalid calendar window");
    if (this.fixture) {
      if (this.fixture.status !== "fullAccess") return [];
      const ids = new Set(calendarIds);
      return this.fixture.events.filter((e) => ids.has(e.calendarId) && Date.parse(e.start) < end && Date.parse(e.end) > start).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    }
    const list = await this.request("events", { from, to, calendarIds });
    return Array.isArray(list) ? list.filter(isEvent).map(pickEvent) : [];
  }

  stop(): void {
    this.failAll(new Error("calendar helper stopped"));
    this.child?.kill();
    this.child = null;
  }

  private request(cmd: "status" | "calendars" | "events" | "requestAccess", args: Record<string, unknown> = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
    const child = this.ensureChild();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`calendar helper did not answer ${cmd}`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, cmd, ...args })}\n`, (error) => {
        if (!error) return;
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  private ensureChild(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;
    if (!this.bin) throw new Error("calendar helper is not available");
    const child = spawn(this.bin, [], { stdio: ["pipe", "pipe", "pipe"] });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.receive(chunk));
    child.stderr.setEncoding("utf8");
    // The helper only writes error text to stderr; event data never goes there.
    child.stderr.on("data", (chunk: string) => {
      const line = String(chunk).trim();
      if (line) console.error(`deska-calendar: ${line.slice(0, 500)}`);
    });
    child.on("error", () => {
      if (this.child === child) this.child = null;
      this.failAll(new Error("calendar helper failed"));
    });
    child.on("exit", (code) => {
      if (this.child === child) this.child = null;
      this.failAll(new Error(`calendar helper exited (${code ?? "signal"})`));
    });
    child.stdin.on("error", () => {
      // A dead helper's stdin: the exit handler rejects whatever is pending.
    });
    this.child = child;
    return child;
  }

  private receive(chunk: string) {
    this.buffer += chunk;
    for (;;) {
      const at = this.buffer.indexOf("\n");
      if (at < 0) break;
      const line = this.buffer.slice(0, at).trim();
      this.buffer = this.buffer.slice(at + 1);
      if (!line) continue;
      let msg: unknown;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof msg !== "object" || msg === null) continue;
      const m = msg as { event?: unknown; id?: unknown; ok?: unknown; result?: unknown; error?: unknown };
      if (m.event === "changed") {
        for (const listener of this.listeners) listener();
        continue;
      }
      if (typeof m.id !== "number") continue;
      const pending = this.pending.get(m.id);
      if (!pending) continue;
      this.pending.delete(m.id);
      clearTimeout(pending.timer);
      if (m.ok === false) pending.reject(new Error(typeof m.error === "string" ? m.error.slice(0, 300) : "calendar helper error"));
      else pending.resolve(m.result);
    }
  }

  private failAll(error: Error) {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }
}

function mapStatus(value: unknown): CalendarReadStatus {
  return value === "notDetermined" || value === "denied" || value === "restricted" || value === "fullAccess" || value === "writeOnly" ? value : "unavailable";
}
