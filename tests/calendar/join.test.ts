// CALENDAR-SPEC §6 (C-G): Join opens only https links on the meeting allowlist.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isMeetingUrl, MEETING_HOSTS, MEETING_HOST_SUFFIXES, meetingJoinUrl } from "@/lib/calendar/join";
import { MEETING_HOSTS as MAIN_HOSTS, MEETING_HOST_SUFFIXES as MAIN_SUFFIXES } from "@/desktop/navigation";

describe("isMeetingUrl", () => {
  it("allows the fixed meeting hosts over https", () => {
    for (const url of [
      "https://meet.google.com/abc-defg-hij",
      "https://teams.microsoft.com/l/meetup-join/19%3ameeting",
      "https://teams.live.com/meet/123",
      "https://zoom.us/j/123",
      "https://acme.zoom.us/j/123?pwd=x",
      "https://acme.webex.com/meet/alice",
      "https://meet.google.com:443/abc",
    ]) {
      expect(isMeetingUrl(url), url).toBe(true);
    }
  });

  it("refuses other hosts, other schemes, credentials and odd ports", () => {
    // Credentials in a meeting URL (built, not written out as user:pw@host).
    const withCredentials = Object.assign(new URL("https://meet.google.com/abc"), { username: "user", password: "pw" }).href;
    for (const url of [
      "http://meet.google.com/abc",
      "https://meet.google.com.evil.example/abc",
      "https://sub.meet.google.com/abc",
      "https://notzoom.us/j/1",
      "https://evil.example/?u=https://zoom.us/j/1",
      withCredentials,
      "https://meet.google.com:8443/abc",
      "javascript:alert(1)",
      "not a url",
    ]) {
      expect(isMeetingUrl(url), url).toBe(false);
    }
  });
});

describe("meetingJoinUrl", () => {
  it("prefers the event's own URL when it is a meeting link", () => {
    expect(meetingJoinUrl({ url: "https://acme.zoom.us/j/1", location: "https://meet.google.com/x" })).toBe("https://acme.zoom.us/j/1");
  });

  it("falls back to the first allowlisted link in the location and strips sentence punctuation", () => {
    expect(meetingJoinUrl({ url: null, location: "Room 2 · https://meet.google.com/abc-defg-hij." })).toBe("https://meet.google.com/abc-defg-hij");
    expect(meetingJoinUrl({ url: null, location: "https://evil.example/x, then https://acme.zoom.us/j/9" })).toBe("https://acme.zoom.us/j/9");
  });

  it("uses the link from the notes last, and only when it is on the allowlist", () => {
    expect(meetingJoinUrl({ url: null, location: "Room 3", meetingUrl: "https://meet.google.com/abc-defg-hij" })).toBe("https://meet.google.com/abc-defg-hij");
    expect(meetingJoinUrl({ url: null, location: "https://acme.zoom.us/j/9", meetingUrl: "https://meet.google.com/abc" })).toBe("https://acme.zoom.us/j/9");
    expect(meetingJoinUrl({ url: null, location: null, meetingUrl: "https://example.com/abc" })).toBeNull();
  });

  it("gives no link for an event without an allowlisted URL", () => {
    expect(meetingJoinUrl({ url: "https://example.com/meeting", location: "Room 2" })).toBeNull();
    expect(meetingJoinUrl({ url: null, location: null })).toBeNull();
  });
});

describe("allowlist parity", () => {
  it("main and the page use the same hosts (§6: main is what enforces it)", () => {
    expect([...MAIN_HOSTS]).toEqual([...MEETING_HOSTS]);
    expect([...MAIN_SUFFIXES]).toEqual([...MEETING_HOST_SUFFIXES]);
  });

  it("the helper picks links out of notes with the same hosts", () => {
    const swift = readFileSync(path.join(process.cwd(), "desktop/calendar/Sources/deska-calendar/main.swift"), "utf8");
    const list = (name: string) => JSON.parse(new RegExp(`let ${name} = (\\[[^\\]]*\\])`).exec(swift)![1]!) as string[];
    expect(list("meetingHosts")).toEqual([...MEETING_HOSTS]);
    expect(list("meetingHostSuffixes")).toEqual([...MEETING_HOST_SUFFIXES]);
  });
});
