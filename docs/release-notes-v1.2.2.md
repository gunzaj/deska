# Deska 1.2.2

A macOS app for working with GitHub Issues and a GitHub Project: filtering, fast triage, parent issue progress, a sprint view, and personal tasks that stay on your Mac.

**Writes are possible, and off until you turn them on.** Deska stays read-only until your token has write permissions and you switch on Settings → GitHub writes.

## What's new in 1.2.2

Fixes on top of 1.2.1:

- **Project field edits work again:** changing Status, Priority, Release or another project field failed every time, after about a minute of spinning. GitHub refused the request because Deska sent the value with the wrong type. These edits now save in a second or two. Type, milestone, labels, assignees and close/reopen were not affected.
- **Failed edits fail fast:** an error that trying again cannot fix is reported at once instead of being retried for a minute. Rate limits and network drops are still retried.
- **No more silent reverts:** if an edit that showed "Still saving" ends up failing, Deska now says why, or opens the conflict dialog when someone else changed the field. Before, the old value simply came back without a word.
- **Labels in the sidebar:** create a task label with the + on the Labels section. Each label shows how many open tasks it has.

Edits that failed in 1.2.0 or 1.2.1 are not retried; make them again. No database migration. Everything from 1.2.1 is still included.

## Install

1. Download `Deska-1.2.2-universal.dmg` (Apple silicon and Intel) and drag Deska to Applications (replace the old version; your data stays).
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
