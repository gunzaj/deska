# Deska 1.4.3

A macOS app for working with GitHub Issues and a GitHub Project: filtering, fast triage, parent issue progress, a sprint view, and personal tasks that stay on your Mac.

**Writes are possible, and off until you turn them on.** Deska stays read-only until your token has write permissions and you switch on Settings → GitHub writes.

## What's new in 1.4.3

Favorites in the sidebar, and a sidebar you can put in your own order. No database migration.

- **Favorites.** The top of the sidebar is now a Favorites section. Home, Triage, My issues and Watching are in it to start with. Hover any sidebar item and click the star to add it: a task list, a project, a label, a saved view, an issue list or one of your first mapped field's values. Click the star again to take it out, and the item goes back to its own section.
- **Drag to reorder.** Drag the items of any list into the order you want: Favorites, your task lists, Projects, Labels, the GitHub lists, Views and your first mapped field. Dropping an item on Favorites adds it there, at that place. Dragging a favorite back onto its own section takes it out of Favorites.
- **Sections in any order.** Customize sidebar is one list again. Any section moves above or below any other, and any section can be hidden.

### Changed

- The Tasks and GitHub groups of 1.4.2 are gone. Tasks, Projects, Labels, GitHub, Views and your first mapped field are six sections, each with its own heading. They start in the same order as before, and your hidden sections are kept.
- Triage, My issues, Watching and Home belong to the GitHub section: that is where they go when you take them out of Favorites. Without GitHub connected, Home goes to Tasks.
- Reset in Customize sidebar puts the sections back in the default order. It keeps your favorites and the order of your items.
- Dragging a task onto Inbox, Today, Upcoming, a project or a label works as before, also when that item is a favorite.

Everything from 1.4.2 is still included.

## Install

1. Download `Deska-1.4.3-universal.dmg` (Apple silicon and Intel) and drag Deska to Applications (replace the old version; your data stays).
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
- Favorites are added with the mouse: the star shows on hover, so there is none on a touch screen. Archived projects can't be starred or reordered.
- At most 30 tabs. A tab that is not shown does not keep unsaved text.
- The quick-add window can't link issues (`#1234` stays text); the in-app quick add can.
- Ramble needs an OpenAI-compatible transcription endpoint or a local dictation app's server; that app must be running with its local API on, recordings stop after two minutes and uploads are capped at 25 MB.
- A saved task view holds one label and can be deleted but not edited.
