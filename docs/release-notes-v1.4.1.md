# Deska 1.4.1

A macOS app for working with GitHub Issues and a GitHub Project: filtering, fast triage, parent issue progress, a sprint view, and personal tasks that stay on your Mac.

**Writes are possible, and off until you turn them on.** Deska stays read-only until your token has write permissions and you switch on Settings → GitHub writes.

## What's new in 1.4.1

Relationships in the issue panel, two new filter choices and a video fix. No database migration.

- **Relationships.** The issue panel has a Relationships section, like the sidebar of an issue on GitHub: the parent issue, Blocked by, Blocking and Relates to. Blocked by, Blocking and Relates to are read from GitHub when the panel opens. A click on a linked issue opens it; one from another repository opens on GitHub.
- **Change relationships from one menu.** With GitHub writes on, the button in that section adds or changes the parent, marks the issue as blocked by or blocking another, or adds a related issue. Search by title or `#number`; ✕ on a row removes the link. Shortcuts while an issue is open: ⌥⇧P for the parent, B B for blocked by, B X for blocking, B R for relates to. They are listed in the shortcuts help.
- **Add and remove sub-issues.** The sub-issues list has "Add sub-issue" and a ✕ on each row. Removing a sub-issue only unlinks it; the issue itself stays.
- **"No type" and "Has type".** The Type filter offers both above the list of types, as on GitHub. Picking one of them, or a type, replaces the other, so the list never ends up empty by mistake.
- **"is not empty" for every field.** Any filter that had "is empty" now also has "is not empty" ("is assigned" for assignees, "has a type" for Type).
- **Long videos play to the end.** In a private repository GitHub signs an attachment's address for about five minutes, and a video that ran longer, or was started late, stopped part-way. Deska now fetches a new address when that happens and carries on from the same place. The video may pause for a moment.

### Changed

- Relationship edits use six more GitHub write operations: add and remove a sub-issue, a "blocked by" link and a "relates to" link. Each one links or unlinks two issues; no issue is edited or deleted. They need the same token permissions as other edits, and stay off until GitHub writes is on.
- "Add sub-issue" does not offer an issue that already has a parent. To move one, open it and use "Change or remove parent".

Everything from 1.4.0 is still included.

## Install

1. Download `Deska-1.4.1-universal.dmg` (Apple silicon and Intel) and drag Deska to Applications (replace the old version; your data stays).
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
- No editing of issue titles or bodies, no GitHub comments.
- Relationships: only issues Deska has synced can be linked (none from other repositories), a new issue can't be created as a sub-issue, and sub-issues can't be reordered.
- At most 30 tabs. A tab that is not shown does not keep unsaved text.
- The quick-add window can't link issues (`#1234` stays text); the in-app quick add can.
- Ramble needs an OpenAI-compatible transcription endpoint or a local dictation app's server; that app must be running with its local API on, recordings stop after two minutes and uploads are capped at 25 MB.
- A saved task view holds one label and can be deleted but not edited.
