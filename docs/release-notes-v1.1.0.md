# Deska 1.1.0

A macOS app for working with GitHub Issues and a GitHub Project: filtering, fast triage, parent issue progress, a sprint view, and personal tasks that stay on your Mac.

**Writes are now possible, and off until you turn them on.** Deska stays read-only until your token has write permissions and you switch on Settings → GitHub writes.

## What's new in 1.1.0

- **GitHub writes.** With a token that can write and Settings → GitHub writes on, you can set Status, Priority, Sprint, your other single-select fields, assignees, labels, Type and milestone, close and reopen issues (close also moves Status to the Done option you choose in Settings), and create issues. Every write happens only after your action, checks first that nothing changed on GitHub ("Keep theirs / Overwrite"), and shows the result. Deska never deletes anything and never changes project fields or options.
- **Use your GitHub CLI login.** If `gh` is installed and logged in, onboarding offers "Use my GitHub CLI login": nothing to paste, no token stored.
- **AI assist (optional, off by default).** Pick Claude Code or any OpenAI-compatible endpoint (including a model server on your own network) in Settings → AI and run Test connection. Then:
  - **Issue triage:** a summary and suggested Status, Priority, Sprint, labels and possible duplicates, from the issue panel or for a whole queue.
  - **Task assist:** ✨ in quick add and "Tidy Inbox" suggest dates, projects and labels.
  - **Plan my day:** an ordered plan for Today.
  - **Ask:** questions about an issue or any issue list.

  AI only suggests: nothing changes until you accept it.
- **Fixes.** Among others:
  - The issue panel now loads from GitHub in the app.
  - Project fields beyond the 40th are no longer reported as missing.
  - Switching to another repository or project starts a fresh import.
  - Snoozed reminders no longer repeat on later days.
  - "every!" tasks completed early can be completed again.
  - j/k works in lists where an issue shows in several groups.
  - Triage and the sprint view use your local date.

## Install

1. Download `Deska-1.1.0-universal.dmg` (Apple silicon and Intel) and drag Deska to Applications (replace the old version; your data stays).
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
