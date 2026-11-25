# Deska 1.4.2

A macOS app for working with GitHub Issues and a GitHub Project: filtering, fast triage, parent issue progress, a sprint view, and personal tasks that stay on your Mac.

**Writes are possible, and off until you turn them on.** Deska stays read-only until your token has write permissions and you switch on Settings → GitHub writes.

## What's new in 1.4.2

A Home page, a sidebar in two groups, and comments from the issue panel. One database migration (two new settings columns); it runs on first launch, after the automatic backup.

- **Home.** Deska opens on a new page that shows what needs you now: tasks due today, your open issues, what needs triage, unseen changes on what you watch, and how the current sprint is going. Each tile opens its page and shows the same number as that page.
- **My work.** Three tabs on Home: Today (tasks due today or overdue), This sprint (your open issues in the current sprint) and Upcoming (tasks due in the next 7 days). You can complete a task there, with Undo. A task linked to an issue shows the issue's number and Status.
- **Current sprint on Home.** Done X / Y, days left, a bar split by Status, how many issues were added since the start, and up to five issues at risk with the reason. It follows your default team, with the chip to turn that off.
- **Needs attention, What changed, Epics in this sprint.** The newest issues waiting for triage and your issues with no update for 14 days; the latest changes on watched issues, with "Mark all seen"; and the sprint's epics with GitHub's progress, lowest first.
- **Make Home yours.** Customize Home hides and reorders the panels. Settings → General → Start page chooses where Deska opens: Home, My issues or Today.
- **Sidebar in two groups.** Home, Triage, My issues and Watching stay on top. Below them, a Tasks group (your lists, saved task views, projects and labels) and a GitHub group (issue lists, saved views with their own "+", and your first mapped field). Nothing was removed. Your hidden sections and their order are kept.
- **Comment from Deska.** With GitHub writes on, the issue panel has a comment box under the thread. Markdown works; ⌘↵ posts.
- **A small animation when you complete a task.** The checkbox fills and pops before the task leaves the list, from a click or from `E` on a row. It is off when macOS is set to reduce motion.

### Fixed

- Creating an issue no longer fails when the project's own auto-add workflow adds the issue before Deska does. Deska now uses that project item and goes on to set the fields and Type.

### Changed

- `/` now opens Home instead of My issues (or Inbox in tasks-only mode). A new tab opens your start page. `G H` goes to Home.
- In Customize sidebar, a section moves up and down inside its group only. Tasks always comes before GitHub.
- Home needs no new GitHub permission and makes no GitHub call of its own: it reads what Deska has already synced.
- Posting a comment uses one more GitHub write operation, `issues.createComment`. It stays off until GitHub writes is on.

Everything from 1.4.1 is still included.

## Install

1. Download `Deska-1.4.2-universal.dmg` (Apple silicon and Intel) and drag Deska to Applications (replace the old version; your data stays).
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
- No editing of issue titles or bodies. Comments can be posted, not edited or deleted.
- Home shows the current sprint only, and "Blocked by" is not part of Needs attention.
- Relationships: only issues Deska has synced can be linked (none from other repositories), a new issue can't be created as a sub-issue, and sub-issues can't be reordered.
- At most 30 tabs. A tab that is not shown does not keep unsaved text.
- The quick-add window can't link issues (`#1234` stays text); the in-app quick add can.
- Ramble needs an OpenAI-compatible transcription endpoint or a local dictation app's server; that app must be running with its local API on, recordings stop after two minutes and uploads are capped at 25 MB.
- A saved task view holds one label and can be deleted but not edited.
