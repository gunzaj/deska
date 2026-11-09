# Deska 1.0.2

A macOS app for working with GitHub Issues and an org GitHub Project: filtering, fast triage, parent issue progress, a sprint view, and personal tasks that stay on your Mac.

**This release is read-only.** It reads your repository and project with your own fine-grained token and never writes to GitHub.

## What's new in 1.0.2

- **Second backup folder.** In Settings → Local data → Backups, pick a folder (iCloud Drive, a sync client's folder, an external drive) and every backup is also copied there.
- **Longer backup history.** Every backup of the last 14 days is kept, then one a week for 8 weeks (was: the newest 14).
- **Backup warnings.** Settings shows a failed backup, a missing second folder, and a notice when the newest backup is over 3 days old.

## Install

1. Download `Deska-1.0.2-universal.dmg` (Apple silicon and Intel) and drag Deska to Applications.
2. Open it. See below: the app is not signed yet.
3. Paste a read-only fine-grained personal access token, pick your repository and project, and map the fields. [`docs/handoff.md`](https://github.com/gunzaj/deska/blob/main/docs/handoff.md) lists the exact permissions.

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

- Read-only: planning edits, close/reopen and create issue are not in this version.
- No auto-update: new versions are on the Releases page.
- One repository and one org project at a time. macOS only.
