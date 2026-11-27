// swift-tools-version:5.9
// The calendar helper (CALENDAR-SPEC §2.2): a small command-line tool that
// reads Calendar.app through EventKit and answers JSON lines on stdin/stdout.
// `scripts/desktop.mjs` builds it universal and puts it in
// Deska.app/Contents/Resources/deska-calendar.
import PackageDescription
import Foundation

// The Info.plist must be inside the binary, or macOS has no usage description
// to show and refuses the Calendars prompt.
let infoPlist = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .appendingPathComponent("Resources/Info.plist")
    .path

let package = Package(
    name: "deska-calendar",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "deska-calendar",
            path: "Sources/deska-calendar",
            linkerSettings: [
                .unsafeFlags([
                    "-Xlinker", "-sectcreate",
                    "-Xlinker", "__TEXT",
                    "-Xlinker", "__info_plist",
                    "-Xlinker", infoPlist,
                ]),
            ]
        ),
    ]
)
