# Deska 1.2.0

A macOS app for working with GitHub Issues and a GitHub Project: filtering, fast triage, parent issue progress, a sprint view, and personal tasks that stay on your Mac.

**Writes are possible, and off until you turn them on.** Deska stays read-only until your token has write permissions and you switch on Settings → GitHub writes.

## What's new in 1.2.0

14 product improvements on top of 1.1.2:

**Issues**
- **Titles and side view:** a title always looks clickable, only another issue's title swaps the side panel, and the open issue is highlighted in the list, table, board and epics.
- **Issue detail:** the description sits on its own surface, images open in a larger view, GitHub-hosted videos play, GitHub links open, and you can drag the panel's left edge to resize it.
- **Epics:** now use the same Explorer as other lists, with your default team, search, filters, saved views and a Size sort.
- **New issue:** labels come from a searchable picker with checkmarks and removable chips.

**Release page**
- The overview (header, Risk, notes, counts) follows the same team filter as the board.

**Tasks**
- **Ramble:** create tasks from a voice note. Record, review the transcript and one editable row per task, then create them in one step. Retries never duplicate. Needs a transcription source in Settings → AI (an OpenAI-compatible endpoint, or a local dictation app's server; Claude Code has no audio input) and microphone access.
- **Saved task views:** save a combination of project, label, priority and due window; they appear in the Tasks section of the sidebar.
- Fixes: Tidy Inbox Undo restores a moved day of the month, a saved Inbox view hides sub-tasks, clearing a recurrence while moving the date keeps it cleared, and one-off reminders that already fired don't fire again.

**AI**
- **Model and effort:** pick the model from a list (Claude Code aliases and Custom…, or the endpoint's own model list). Claude Code shows an effort picker when the installed CLI supports `--effort`.
- **Faster, visible actions:** running AI actions show elapsed time, and triage prepares its inputs in parallel (a three-issue batch started its model call in 0.29 s instead of 1.6 s in our test).
- Settings now says when Claude Code is not installed.

**App**
- **Command+K:** Escape closes the switcher.
- **Sidebar:** shows the project title, with the repository beneath it.
- **Triage:** the walk-through buttons read Back and Next.
- **Settings:** the time zone moved from the notification bell to Settings → General.
- **Quick add window:** suggests projects and labels.
- **Watching a view:** a view watch is a daily digest in the bell, not a notification per change.

Includes a database migration (saved task views); it runs on first launch and your data stays. Everything from 1.1.2 is still included.

## Install

1. Download `Deska-1.2.0-universal.dmg` (Apple silicon and Intel) and drag Deska to Applications (replace the old version; your data stays).
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
