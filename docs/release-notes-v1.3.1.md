# Deska 1.3.1

A macOS app for working with GitHub Issues and a GitHub Project: filtering, fast triage, parent issue progress, a sprint view, and personal tasks that stay on your Mac.

**Writes are possible, and off until you turn them on.** Deska stays read-only until your token has write permissions and you switch on Settings → GitHub writes.

## What's new in 1.3.1

Fixes and smaller improvements on top of 1.3.0. No database migration.

- **The quick-add window has the full form.** The window from the global shortcut now looks and works like the sidebar's +: set the due date, time, repeat, priority, project and labels with the mouse, add a description, and use Add another. Typing still works as before; a value you pick wins over the word you typed.
- **The microphone permission sticks.** The app is now signed ad hoc with the microphone entitlement, so macOS remembers your answer instead of asking on every Ramble. An ad hoc signature belongs to one build, so macOS asks once more after each update.
- **New issue: search for assignees.** Assignees are picked from a searchable list, like labels, instead of a checkbox per person in the organization. That long list pushed Cancel and Create off the window.
- **Dialogs scroll instead of overflowing.** A dialog never grows past the window, and the New issue buttons stay at the bottom.
- **Task lists say when loading failed.** If the tasks can't load, the list shows the reason and Retry, instead of "Loading tasks…" forever. Loading, empty and error look different.
- **Narrow windows:** the complete checkbox is a larger touch target and the issue title column keeps its width.

Everything from 1.3.0 is still included.

## Install

1. Download `Deska-1.3.1-universal.dmg` (Apple silicon and Intel) and drag Deska to Applications (replace the old version; your data stays).
2. Open it. See below: the app is not signed with a Developer ID yet.
3. Connect GitHub with a fine-grained personal access token or your GitHub CLI login, pick your repository and project, and map the fields. [`docs/handoff.md`](https://github.com/gunzaj/deska/blob/main/docs/handoff.md) lists the exact permissions, for read-only use and for writes.

## How to open an app without a Developer ID

Deska is signed ad hoc, not with a Developer ID, and isn't notarized, so macOS blocks the first launch.

1. In Applications, **right-click Deska → Open**, then click **Open** in the dialog.
2. If there is no Open button: try to open it once, then go to **System Settings → Privacy & Security**, scroll to Security, and click **Open Anyway** next to Deska.
3. If macOS says the app is damaged (it was downloaded in a browser), run once in Terminal:
   ```bash
   xattr -dr com.apple.quarantine /Applications/Deska.app
   ```

You only do this the first time after each update.

## Known limitations

- No auto-update: new versions are on the Releases page.
- One repository and one project at a time. macOS only.
- No editing of issue titles or bodies, no GitHub comments, no parent/sub-issue changes.
- The quick-add window can't link issues (`#1234` stays text); the in-app quick add can.
- Ramble needs an OpenAI-compatible transcription endpoint or a local dictation app's server; that app must be running with its local API on, recordings stop after two minutes and uploads are capped at 25 MB.
- A saved task view holds one label and can be deleted but not edited.
