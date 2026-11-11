# Deska 1.1.1

A macOS app for working with GitHub Issues and a GitHub Project: filtering, fast triage, parent issue progress, a sprint view, and personal tasks that stay on your Mac.

**Writes are now possible, and off until you turn them on.** Deska stays read-only until your token has write permissions and you switch on Settings → GitHub writes.

## What's new in 1.1.1

A small update to 1.1.0 with fixes:

- **Release page:** the summary at the top (progress, counts, Risk) can be hidden with "Hide summary", so the board gets more room. It shrinks to one line and Deska remembers your choice.
- **Quick add:** a token followed by a sentence-ending period (for example a date or project at the end of a sentence) is now recognised.

Everything from 1.1.0 is still included; see its notes for the full list.

## Install

1. Download `Deska-1.1.1-universal.dmg` (Apple silicon and Intel) and drag Deska to Applications (replace the old version; your data stays).
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
