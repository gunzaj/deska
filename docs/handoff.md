# Handoff

Everything someone needs to install, run and look after Deska v1.0.

## Install and run

- Download `Deska-<version>-universal.dmg` from [Releases](https://github.com/gunzaj/deska/releases) and drag Deska to Applications. It runs on Apple silicon and Intel Macs.
- The app is unsigned. The first time: right-click Deska → Open, or System Settings → Privacy & Security → Open Anyway. If macOS says it is damaged: `xattr -dr com.apple.quarantine /Applications/Deska.app`.
- From source (Node 24, pnpm): `pnpm install`, then `pnpm desktop:dev` (hot reload) or `pnpm desktop:build` (the `.dmg` in `release/`).
- Closing the window keeps Deska running, so sync and reminders continue. ⌘Q quits.

## Permissions

Create a **fine-grained personal access token** with resource owner = your org and repository access = **only the one repository** Deska reads. A classic token with read-only scopes also works (see [`security.md`](security.md)). If you use the GitHub CLI, onboarding also offers "Use my GitHub CLI login": nothing to paste and no token stored, but that login can write, so Deska's own "GitHub writes" switch (off by default) is what keeps it read-only.

| Permission | Read-only | With GitHub writes on |
|---|---|---|
| Repository → Metadata | Read (mandatory) | Read |
| Repository → Issues | Read | Read and write |
| Organization → Projects | Read | Read and write |
| Organization → Issue types | Read (optional; Type shows as unavailable without it) | Read (optional) |

Nothing else is requested. Your org may need to approve the token, and may cap its lifetime. Deska warns 14 days before it expires. The token is encrypted with the macOS Keychain-backed `safeStorage`, kept in memory by the local server, and never written to logs, exports or backups. [`security.md`](security.md) has the details.

## Writes

From v1.1.0 the build allows GitHub writes (`DESKA_WRITES=on`, SPEC §3.4), but Deska writes only when all three hold: the token has the write permissions above, Settings → GitHub writes is on (off by default, and off again after every token change), and the build allows it. Writes are planning edits (Status, Priority, Sprint, dimensions, assignees, labels, Type, milestone), close/reopen and creating an issue, each only after your action, with a check that nothing changed on GitHub first. Deska never deletes anything and never changes project fields, options or iterations. Personal tasks, views, snoozes and watches are local and not part of GitHub, so they are always editable.

v1.0.x builds have the write switch off and refuse every GitHub write.

## Where data lives

All under `~/Library/Application Support/Deska/`:

| What | Where |
|---|---|
| Database (GitHub cache and local data) | `db/` |
| Automatic backups (daily, before migrations and resets; newest 14) | `backups/` |
| Encrypted token | the profile folder (ciphertext only) |
| Desktop settings (shortcut, notifications, Dock badge, launch at login) | `desktop-prefs.json` |

Settings → Local data exports and imports your tasks, projects, labels, sections, views, snoozes, watches and settings (never the token). Reset GitHub cache re-imports and keeps tasks. A database that won't open offers Restore from latest backup; the damaged folder is kept as `db.damaged-<time>`.

## Known limitations

- macOS only; unsigned and not notarized; no auto-update.
- One repository and one org project at a time (no user-owned projects).
- Read-only: no planning edits, close/reopen or create issue until the write milestones ship.
- No pull requests, no sharing or assigning of tasks.
- Theme choice doesn't survive a relaunch (the window's origin changes per launch).
