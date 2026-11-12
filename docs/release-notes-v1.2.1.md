# Deska 1.2.1

A macOS app for working with GitHub Issues and a GitHub Project: filtering, fast triage, parent issue progress, a sprint view, and personal tasks that stay on your Mac.

**Writes are possible, and off until you turn them on.** Deska stays read-only until your token has write permissions and you switch on Settings → GitHub writes.

## What's new in 1.2.1

Speed fixes on top of 1.2.0:

- **Faster property edits:** changing Status, Priority, Release and other project fields no longer waits for GitHub to be re-read. The change is confirmed as soon as GitHub accepts it, and Deska refreshes the issue in the background. Project details are reused between edits, and the check that nobody else changed the field takes one request instead of three.
- **No endless spinner:** if GitHub is slow, the edit is shown as queued after 20 seconds and updates when it finishes.
- **Quick add:** a task added from the quick-add window shows up in the main window right away instead of up to a minute later.

No database migration. Everything from 1.2.0 is still included.

## Install

1. Download `Deska-1.2.1-universal.dmg` (Apple silicon and Intel) and drag Deska to Applications (replace the old version; your data stays).
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
