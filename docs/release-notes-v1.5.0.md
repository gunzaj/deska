# Deska 1.5.0

A macOS app for working with GitHub Issues and a GitHub Project: filtering, fast triage, parent issue progress, a sprint view, and personal tasks that stay on your Mac.

**Writes are possible, and off until you turn them on.** Deska stays read-only until your token has write permissions and you switch on Settings → GitHub writes.

## What's new in 1.5.0

Your meetings, next to your tasks. Deska reads the calendars already in macOS Calendar, so there is no new account or sign-in. Off by default; no database migration.

- **Meetings on Home.** A Calendar panel on Home shows today as a small day grid: timed meetings where they fall, all-day events in a band above it, a now-line and hour lines. The line under the header says "Next: <meeting> in N min" when one starts within two hours, "Now: <meeting> · until HH:mm" while one runs, or "Free until HH:mm". The arrows step to tomorrow and back. The header's context line adds "N meetings today".
- **Meeting details.** Click a meeting for a read-only popover: time (with the event's own zone when it differs), calendar, location, how many people are invited, **Join** when it has a meeting link, and **Open in Calendar**. Nothing is editable.
- **Join opens the meeting, not a browser tab full of anything.** Join is offered only for `https` links on a short list of meeting hosts (Google Meet, Microsoft Teams, Zoom, Webex). The link is taken from the event's URL, its location or its notes. Any other link stays plain text, so a calendar event cannot open an arbitrary page.
- **Settings → Calendar.** Your calendars grouped by account with their colours; first connect turns on every calendar except subscribed holiday and birthday ones. Choose to hide declined events (on), which day the week starts on (Monday) and your working hours (08:00–18:00), which set the grid's range. "Disconnect" stops reading and forgets the chosen calendars; it doesn't change macOS permissions.
- **Permission, honestly.** Reading starts only when you click "Connect calendars" and macOS allows it. If access is denied, the panel says so and offers System Settings → Privacy & Security → Calendars. Deska needs **Full Access** to Calendars: with write-only access it can't read events and asks you to switch. macOS may ask again after an update, because the app is signed ad hoc; Settings → Calendar then offers "Connect calendars" again and keeps your calendar choices.
- **Customize Home** can hide and move the Calendar panel like any other, and tasks-only mode shows it too.
- **Settings** shows the app version in its header.

### Privacy

Calendars come from EventKit on this Mac: macOS syncs the accounts, Deska makes no calendar network call. Event titles, times and locations stay in memory and are never written to the database, a backup, an export, a log or an AI input. Deska reads **no attendee names or emails**, only a count. An event's notes are searched on your Mac for one thing, a meeting link (Google Meet and Teams put theirs only there); the notes' text is never kept, shown or sent anywhere. [`docs/security.md`](https://github.com/gunzaj/deska/blob/main/docs/security.md) has the details.

### Changed

- Home's narrow column now starts with the Calendar panel. If you already customized Home, your layout is unchanged; the panel appears at its default spot until you move or hide it.

### Not in this release

The Planner (a week view you drag tasks and meetings around), writing to your calendar, and anything AI that reads meetings. They follow as 1.5.x; writing will be opt-in and limited to generic blocks Deska itself created.

Everything from 1.4.3 is still included.

## Install

1. Download `Deska-1.5.0-universal.dmg` (Apple silicon and Intel) and drag Deska to Applications (replace the old version; your data stays).
2. Open it. See below: the app is not signed with a Developer ID yet.
3. Connect GitHub with a fine-grained personal access token or your GitHub CLI login, pick your repository and project, and map the fields. [`docs/handoff.md`](https://github.com/gunzaj/deska/blob/main/docs/handoff.md) lists the exact permissions, for read-only use and for writes.
4. For meetings, open Settings → Calendar and click "Connect calendars" when you want them.

## How to open an app without a Developer ID

Deska is signed ad hoc, not with a Developer ID, and isn't notarized, so macOS blocks the first launch.

1. In Applications, **right-click Deska → Open**, then click **Open** in the dialog.
2. If there is no Open button: try to open it once, then go to **System Settings → Privacy & Security**, scroll to Security, and click **Open Anyway** next to Deska.
3. If macOS says the app is damaged (it was downloaded in a browser), run once in Terminal:
   ```bash
   xattr -dr com.apple.quarantine /Applications/Deska.app
   ```

You only do this the first time after each update. Because the signature is ad hoc, macOS can ask for Calendars access again after an update.

## Known limitations

- No auto-update: new versions are on the Releases page.
- One repository and one project at a time. macOS only.
- No editing of issue titles or bodies. Comments can be posted, not edited or deleted.
- Deska reads only calendars Calendar.app already has, so a calendar account it can't see there doesn't appear here either.
- The Calendar panel shows one day. There is no week view, no task drag and drop, and no link to a Planner page yet.
- Relationships: only issues Deska has synced can be linked (none from other repositories), a new issue can't be created as a sub-issue, and sub-issues can't be reordered.
- At most 30 tabs. A tab that is not shown does not keep unsaved text.
- The quick-add window can't link issues (`#1234` stays text); the in-app quick add can.
- Ramble needs an OpenAI-compatible transcription endpoint or a local dictation app's server; that app must be running with its local API on, recordings stop after two minutes and uploads are capped at 25 MB.
- A saved task view holds one label and can be deleted but not edited.
