# Deska 1.3.0

A macOS app for working with GitHub Issues and a GitHub Project: filtering, fast triage, parent issue progress, a sprint view, and personal tasks that stay on your Mac.

**Writes are possible, and off until you turn them on.** Deska stays read-only until your token has write permissions and you switch on Settings → GitHub writes.

## What's new in 1.3.0

About 60 fixes from a full review of the code, on top of 1.2.2. Some change how things behave, so this is a minor version. No database migration.

**Behaviour changes worth knowing**
- **Changing your GitHub sign-in cancels waiting edits.** Replacing the token, disconnecting, switching the GitHub CLI to another account, changing project or turning writes off now fails every edit still waiting to be sent, with "GitHub sign-in changed before this was sent". Nothing queued is sent later under another account. A different GitHub CLI account also turns GitHub writes off.
- **Importing merges same-named projects and labels.** A project or label in the file whose name already exists joins the existing one, with its sections, tasks and links. Before, those tasks were silently dropped. The import message now says what was merged and what was skipped.
- **The theme is remembered across relaunches.** Light or dark was forgotten every time Deska restarted.
- **Between two sprints, Next and Previous release resolve by date** instead of showing nothing.
- **Offline with cached data, a filter that matches nothing shows "No issues" with Clear filters**, not "Can't reach GitHub" (the banner still reports the connection).

**GitHub writes**
- A quit or crash while creating an issue no longer creates it twice, and a close that already landed is no longer reported as a conflict.
- A close is refused before anything is sent when no Done Status is set.
- A create that fails after GitHub made the issue says so and shows the issue, instead of inviting a second one.
- Type and project-field edits check that the issue still lives in your repository.

**Sync**
- Parent progress (`2/4`) is refreshed nightly again; a deleted issue no longer breaks that refresh, and a failed refresh waits an hour instead of retrying every minute.
- New labels, milestones, Status options and sprints get their names in the same sync, not the next day.
- Remapping fields or changing project during a sync can no longer be overwritten by the sync's remaining pages.

**AI**
- Turning AI off or changing provider stops queued and running jobs; nothing more is sent.
- Closing "Suggest for this queue" cancels it; a double click sends it once; queues over 200 send the first 200 and say so.
- Dismissing a suggestion no longer brings back the previous one, and an accepted triage suggestion stops offering Accept.
- Ask answers never load images. Czech letters and emoji from Claude Code no longer turn into `�`.

**Issue list**
- The list no longer scrolls by itself when you hover rows or when data refreshes.
- A filter chip reading "is any" no longer hides every issue.
- ⌘K "Search all issues for …" works when you're already on All issues, and the sidebar link clears it.
- Board `j`/`k` reaches cards past 50 after "Show more"; smaller fixes in Insights, the triage walk, Risk and sub-issues.

**Tasks**
- Completing a recurring task always moves it on; only the newest completion can be undone.
- Undo after dragging a task onto a project puts it back in its section and place. Delete then Undo no longer fires old reminders.
- Picking two labels quickly keeps both. Older tasks on Completed open instead of saying "deleted". A task can be dragged to the end of its list.
- New label, project and section dialogs show errors inline. Sub-tasks no longer inflate project counts.
- Snooze never removes one of your own reminders; typing a date sends one save, not one per key.

**Local data and the app**
- "Restore from latest backup" puts the original database back if it can't open a fresh one.
- Imports up to 100 MB work; larger files get a clear message.
- Two Macs sharing a second backup folder stop deleting each other's backups. Backups are flushed to disk; an empty backup file doesn't count.
- A Dock click while Deska starts opens one window. Settings and key files are written safely, so a crash can't truncate them.

Everything from 1.2.2 is still included.

## Install

1. Download `Deska-1.3.0-universal.dmg` (Apple silicon and Intel) and drag Deska to Applications (replace the old version; your data stays).
2. Open it. See below: the app is not signed yet.
3. Connect GitHub with a fine-grained personal access token or your GitHub CLI login, pick your repository and project, and map the fields. [`docs/handoff.md`](https://github.com/gunzaj/deska/blob/main/docs/handoff.md) lists the exact permissions, for read-only use and for writes.

## How to open an unsigned app

Deska isn't signed or notarized, so macOS blocks the first launch.

1. In Applications, **right-click Deska → Open**, then click **Open** in the dialog.
2. If there is no Open button: try to open it once, then go to **System Settings → Privacy & Security**, scroll to Security, and click **Open Anyway** next to Deska.
3. If macOS says the app is damaged (it was downloaded in a browser), run once in Terminal:
   ```bash
   xattr -dr com.apple.quarantine /Applications/Deska.app
   ```

You only do this the first time.

## Known limitations

- No auto-update: new versions are on the Releases page.
- One repository and one project at a time. macOS only.
- No editing of issue titles or bodies, no GitHub comments, no parent/sub-issue changes.
- Ramble needs an OpenAI-compatible transcription endpoint or a local dictation app's server; that app must be running with its local API on, recordings stop after two minutes and uploads are capped at 25 MB.
- A saved task view holds one label and can be deleted but not edited.
