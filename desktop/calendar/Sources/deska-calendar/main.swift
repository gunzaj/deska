// deska-calendar (CALENDAR-SPEC §2.2): one JSON object per line in, one out.
//
// In:  {"id":1,"cmd":"status"}
//      {"id":2,"cmd":"requestAccess"}
//      {"id":3,"cmd":"calendars"}
//      {"id":4,"cmd":"events","from":"…","to":"…","calendarIds":["…"]}
// Out: {"id":1,"ok":true,"result":"fullAccess"}
//      {"event":"changed"}                    (Calendar.app or a sync changed)
//
// Only the fields of §2.2 are read: never notes, never attendee names or
// emails (a count only). Anything that is not one of the four commands is
// refused, so this tool cannot write to a calendar (C3 adds the only writes).
//
// The app keeps this process running for as long as Deska runs and kills it on
// quit; there is no state on disk.
import AppKit
import EventKit
import Foundation

let store = EKEventStore()
let maxWindow: TimeInterval = 42 * 24 * 60 * 60
let output = DispatchQueue(label: "deska-calendar.output")

let iso: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime]
    f.timeZone = TimeZone(secondsFromGMT: 0)
    return f
}()

func writeLine(_ object: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(object),
          let data = try? JSONSerialization.data(withJSONObject: object, options: []),
          var text = String(data: data, encoding: .utf8)
    else { return }
    text += "\n"
    output.async {
        FileHandle.standardOutput.write(Data(text.utf8))
    }
}

func reply(_ id: Any?, _ result: Any) {
    writeLine(["id": id ?? NSNull(), "ok": true, "result": result])
}

func fail(_ id: Any?, _ message: String) {
    writeLine(["id": id ?? NSNull(), "ok": false, "error": message])
}

func statusString(_ status: EKAuthorizationStatus) -> String {
    switch status {
    case .notDetermined: return "notDetermined"
    case .restricted: return "restricted"
    case .denied: return "denied"
    case .authorized: return "fullAccess"
    default:
        if #available(macOS 14.0, *) {
            if status == .fullAccess { return "fullAccess" }
            if status == .writeOnly { return "writeOnly" }
        }
        return "unknown"
    }
}

func hexColor(_ color: NSColor?) -> String {
    guard let rgb = color?.usingColorSpace(.sRGB) else { return "#7a7a7a" }
    let r = Int((rgb.redComponent * 255).rounded())
    let g = Int((rgb.greenComponent * 255).rounded())
    let b = Int((rgb.blueComponent * 255).rounded())
    return String(format: "#%02x%02x%02x", r, g, b)
}

func calendarObject(_ calendar: EKCalendar) -> [String: Any] {
    var subscribed = calendar.isSubscribed
    var birthday = calendar.type == .birthday
    if #available(macOS 14.0, *) {
        // Newer EventKit moved these onto the calendar type; the old flags stay valid.
        subscribed = subscribed || calendar.type == .subscription
        birthday = birthday || calendar.type == .birthday
    }
    return [
        "id": calendar.calendarIdentifier,
        "title": calendar.title,
        "color": hexColor(calendar.color),
        "source": calendar.source?.title ?? "",
        "allowsWrite": calendar.allowsContentModifications,
        "subscribed": subscribed,
        "birthday": birthday,
    ]
}

func participantStatus(_ status: EKParticipantStatus) -> String {
    switch status {
    case .accepted: return "accepted"
    case .declined: return "declined"
    case .tentative: return "tentative"
    case .pending: return "pending"
    case .delegated: return "delegated"
    default: return "unknown"
    }
}

func eventObject(_ event: EKEvent) -> [String: Any] {
    // The user's own invitation status: the participant marked as the current
    // user. Names and emails are never read, only the status.
    let me = event.attendees?.first { $0.isCurrentUser }
    var object: [String: Any] = [
        "id": event.eventIdentifier ?? "\(event.calendar.calendarIdentifier):\(event.startDate.timeIntervalSince1970)",
        "calendarId": event.calendar.calendarIdentifier,
        "title": event.title ?? "",
        "start": iso.string(from: event.startDate),
        "end": iso.string(from: event.endDate),
        "allDay": event.isAllDay,
        "organizerIsMe": event.organizer?.isCurrentUser ?? false,
        "attendeeCount": event.attendees?.count ?? 0,
        "isRecurring": event.hasRecurrenceRules,
    ]
    if let me { object["myStatus"] = participantStatus(me.participantStatus) }
    if let zone = event.timeZone { object["timeZone"] = zone.identifier }
    if let location = event.location, !location.isEmpty { object["location"] = location }
    if let url = event.url?.absoluteString { object["url"] = url }
    if let occurrence = event.occurrenceDate { object["occurrenceDate"] = iso.string(from: occurrence) }
    return object
}

func calendars(ids: [String]?) -> [EKCalendar] {
    let all = store.calendars(for: .event)
    guard let ids, !ids.isEmpty else { return all }
    let wanted = Set(ids)
    return all.filter { wanted.contains($0.calendarIdentifier) }
}

func handle(_ line: String) {
    guard let data = line.data(using: .utf8),
          let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return }
    let id = raw["id"]
    guard let cmd = raw["cmd"] as? String else {
        fail(id, "missing cmd")
        return
    }

    switch cmd {
    case "status":
        reply(id, statusString(EKEventStore.authorizationStatus(for: .event)))

    case "requestAccess":
        if #available(macOS 14.0, *) {
            store.requestFullAccessToEvents { _, _ in
                reply(id, statusString(EKEventStore.authorizationStatus(for: .event)))
            }
        } else {
            store.requestAccess(to: .event) { _, _ in
                reply(id, statusString(EKEventStore.authorizationStatus(for: .event)))
            }
        }

    case "calendars":
        reply(id, calendars(ids: nil).map(calendarObject))

    case "events":
        guard let fromText = raw["from"] as? String,
              let toText = raw["to"] as? String,
              let from = iso.date(from: fromText),
              let to = iso.date(from: toText),
              to > from,
              to.timeIntervalSince(from) <= maxWindow
        else {
            fail(id, "invalid window")
            return
        }
        let ids = raw["calendarIds"] as? [String]
        let chosen = calendars(ids: ids)
        let predicate = store.predicateForEvents(withStart: from, end: to, calendars: chosen)
        reply(id, store.events(matching: predicate).map(eventObject))

    default:
        // The whole interface: anything else is refused (§2.2).
        fail(id, "unknown command")
    }
}

// Calendar.app (or a sync) changed something: the app re-reads. No data.
NotificationCenter.default.addObserver(
    forName: .EKEventStoreChanged,
    object: store,
    queue: .main
) { _ in
    writeLine(["event": "changed"])
}

DispatchQueue.global(qos: .userInitiated).async {
    while let line = readLine(strippingNewline: true) {
        if !line.isEmpty { handle(line) }
    }
    exit(0)
}

RunLoop.main.run()
