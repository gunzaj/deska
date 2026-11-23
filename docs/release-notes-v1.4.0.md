# Deska 1.4.0

A macOS app for working with GitHub Issues and a GitHub Project: filtering, fast triage, parent issue progress, a sprint view, and personal tasks that stay on your Mac.

**Writes are possible, and off until you turn them on.** Deska stays read-only until your token has write permissions and you switch on Settings → GitHub writes.

## What's new in 1.4.0

Tabs, and faster pickers. No database migration.

- **Tabs.** ⌘-click or middle-click an issue to open it in a background tab; ⌘⇧-click opens it and switches to it. This works wherever an issue can be clicked: lists, boards, sub-issues, the parent trail, ⌘K, task links, AI answers, duplicates, Release risk, Plan and Watching. A plain click still opens the side panel. In a list, ⌘-click the number or title for a tab; ⌘-click elsewhere on the row still selects it for bulk edit.
- **Any page can be a tab.** ⌘-click a sidebar link or "Open full page", or use the + button. Each tab has its own Back and Forward (⌘[ and ⌘]) and remembers where you scrolled. The tab strip appears once a second tab is open.
- **Tab shortcuts.** ⌘W closes the tab (the window, when it is the last one), ⌘⇧T reopens the last closed tab, ⌘1–⌘8 go to a tab by place and ⌘9 to the last, ⌘⇧[ and ⌘⇧] or Ctrl+Tab move between tabs. All of them are listed under Tabs in the shortcuts help.
- **Tabs come back after a relaunch.** The app reopens the tabs you had, with their history.
- **An issue opens once.** Opening an issue that already has a tab highlights that tab instead of opening a second one.
- **Parent trail and Back in the side panel.** The panel shows the issue's parents above the title, each one a click away. After you move from one issue to another inside the panel, a ← Back button returns to the previous one.
- **Labels and assignees you use most come first.** The label and assignee pickers list the issue's current values, then up to three you add most often, then the rest. A choice moves up after three adds in the last 90 days. The count comes from the edit history on your Mac; nothing is sent anywhere.
- **Pickers are ready to type in.** A picker opens with the caret in its search field and keeps it there between picks, and a ticked row no longer moves while the picker is open.
- **Avatars stay square.** A comment's avatar no longer stretches to the height of a long comment.

### Changed

- On an issue's full page, a plain click on a sub-issue, parent or reference opens it in the side panel over that page. Before, it went to the other issue's page. ⌘-click opens it in a tab.
- In ⌘K, ⌘↵ now opens the issue in a background tab. "Open in GitHub" moved to ⌥↵.
- Only the tab you are looking at is loaded. A background tab keeps its page, history and scroll position, but not text you typed and had not saved.

Everything from 1.3.1 is still included.

## Install

1. Download `Deska-1.4.0-universal.dmg` (Apple silicon and Intel) and drag Deska to Applications (replace the old version; your data stays).
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
- At most 30 tabs. A tab that is not shown does not keep unsaved text.
- The quick-add window can't link issues (`#1234` stays text); the in-app quick add can.
- Ramble needs an OpenAI-compatible transcription endpoint or a local dictation app's server; that app must be running with its local API on, recordings stop after two minutes and uploads are capped at 25 MB.
- A saved task view holds one label and can be deleted but not edited.
