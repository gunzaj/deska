# Deska security overview

For security reviewers and org admins deciding whether to approve a Deska token. Deska is a macOS desktop app that reads one GitHub repository and one organization Project (v2) with the user's own fine-grained personal access token (PAT). It has no backend, no hosting and no OAuth app.

This page describes the design in [`SPEC.md`](SPEC.md). The desktop shell and the local server hardening below landed in D2, token entry, onboarding and the token checks in D3. In-process sync lands in D5; until then the app shows a fictional demo dataset. Check [`PROGRESS.md`](PROGRESS.md) for what is built.

## Architecture

```
Electron main process
  ├─ window, menus, dock badge, global shortcut, native notifications
  ├─ token store (safeStorage → Keychain-backed key)
  └─ spawns ─► utilityProcess: Next.js standalone server
                 ├─ binds 127.0.0.1:<random free port>
                 ├─ API routes, view engine, task service
                 ├─ sync loop (in-process)
                 ├─ outbox (writes)
                 └─ embedded Postgres (PGlite) in ~/Library/Application Support/Deska/db
Renderer (BrowserWindow) loads http://127.0.0.1:<port>/ — the React UI
```

- Everything runs on the user's Mac, as the user. There is no Deska server, account or telemetry.
- The only network traffic is to the GitHub API (`api.github.com`), with the user's token.
- GitHub stays the source of truth. People without Deska see every issue on GitHub as usual.

## GitHub token

### Type

A **fine-grained PAT** only:
- Resource owner: the organization.
- Repository access: **only the one repository** Deska reads.
- Classic PATs and OAuth tokens are not supported.

### Permissions

| Permission | Read-only use | With writes (later, opt-in) | Used for |
|---|---|---|---|
| Repository → Metadata | Read (mandatory) | Read | Repo info, assignable users, labels, milestones |
| Repository → Issues | **Read** | **Read and write** | Issues, sub-issues, issue types on issues, comments, rendered bodies. With writes: fields, labels, assignees, close/reopen, create |
| Organization → Projects | **Read** | **Read and write** | Project fields, options, iterations, item values. With writes: set values, add new issues to the project |
| Organization → Issue types | Read, optional | Read, optional | The org's issue types. If refused, Type shows as unavailable instead of failing |
| Anything else | Not requested | Not requested | — |

Facts worth knowing:
- GitHub has **no separate "delete issue" permission**; deleting an issue needs the repository **admin role**. Deska never calls a delete operation. The write client has an **operation allowlist**, and a test fails if any other operation is added.
- The Projects permission is **org-wide**: GitHub can't scope a PAT to one project. Deska pins the project's node ID when the user picks it and refuses to write to any other project.
- A **read-only PAT makes writes impossible on GitHub's side**, whatever the app's code does.
- Orgs can require admin approval of fine-grained PATs and cap their lifetime. Deska tells the user when a token looks like it's awaiting approval and warns 14 days before it expires.

### Storage

- The user pastes the token in onboarding or Settings. It goes through a minimal preload bridge to the Electron **main** process, never over HTTP. The input field is emptied as soon as the token is handed over, and the page never gets it back.
- Main accepts only fine-grained tokens (`github_pat_…`), encrypts the token with Electron `safeStorage` (the key is held in the macOS Keychain) and stores only the ciphertext (`github-token.bin`) in the app data folder.
- Main hands the plaintext to the local server over IPC. The server keeps it **in memory only**.
- The token is never in the renderer, environment variables, logs, error messages, API answers, the database, exports or backups. Every console line of the server process goes through redaction, which replaces `github_pat_…` strings (and the classic `gh?_…` shapes) and any value equal to the token; API errors are generic and their detail goes to the log only.
- "Disconnect GitHub" in Settings deletes the stored token. The local GitHub cache and personal tasks stay.

### Checking a token in the app

When a token is entered, and again every few minutes while the app runs, the server asks GitHub who the token belongs to (`GET /user`) and makes one read per permission above against the chosen repository and project. These calls use the same read-only client as the probe below: REST `GET`s and GraphQL queries only. From the answers Deska tells apart: no token, invalid or expired (401), expiring within 14 days (from GitHub's `github-authentication-token-expiration` header), awaiting the org's approval, a missing permission (named, for example "Organization → Projects: Read"), GitHub unreachable, and rate limited. The token's owner becomes the app's one local user; their login, name and avatar URL are kept in the local database so the app works offline. The token is not.

### Choosing the project

After the token, onboarding asks for the repository and the organization project. Deska lists the organization's projects the token can read and reads the chosen project's fields (names, options, iterations), with the same read-only client. It stores the repository, organization, project number and the project's node ID (pinned), and the user's field mapping (which field is Status, Priority, Sprint and which are dimensions), by field ID, in the local database. Before a project is chosen, the token check reads only `GET /user`. "Reload fields" in Settings reads the fields again; if the project number now names a different project than the pinned node ID, Deska refuses and asks for the project again. Choosing or remapping a project never writes to GitHub.

A fine-grained token's write permissions can't be read without attempting a write, and Deska never attempts one to find out. Until writes exist (Phase C), every token counts as read-only and edit controls say "Read-only token".

Automated tests of the desktop app point it at a mock GitHub API with `DESKA_GITHUB_API_URL`. Only `http://127.0.0.1:<port>` is accepted; any other value is ignored, so the token can't be sent anywhere but GitHub or the same Mac.

## Local server hardening

The UI is a Next.js app served by a local process. Other software on the Mac must not be able to use it:

- Binds to **`127.0.0.1` only**, on a random free port each launch.
- **Per-launch secret:** main generates 256 random bits, passes them to the server over IPC and sets them as an `HttpOnly`, `SameSite=Strict` cookie on the window's session before the first page load. Every request (pages and API) without it gets **403**.
- Any `Host` header other than `127.0.0.1:<port>` gets **403** (blocks DNS rebinding).
- Mutating requests must carry a matching `Origin`. Pages have a strict Content Security Policy.
- The renderer runs with `contextIsolation: true`, `sandbox: true` and `nodeIntegration: false`. The preload bridge exposes only token entry, notifications, open-external and app info.
- Navigation is locked to the app's own origin. `https://github.com/*` links open in the default browser; every other external URL is blocked.
- Nothing is loaded from the network at runtime except the GitHub API. The window itself may only fetch images from GitHub's hosts (`github.com`, `*.githubusercontent.com`) for avatars and issue attachments; every other request it makes outside the app is cancelled.
- One app instance per user profile, so two servers never open the same database.

## What is stored on disk

All under `~/Library/Application Support/Deska/`, readable only by the user's macOS account:

| What | Where | Contains |
|---|---|---|
| Encrypted token | app data folder (`github-token.bin`) | `safeStorage` ciphertext only |
| Local database | `db/` | A cache of the repository's issues and project values, the token owner's login, name and avatar URL, plus personal tasks, saved views, snoozes, watches and settings. **No token** |
| Backups | `backups/` | JSON of local-only data (tasks, projects, labels, sections, views, snoozes, watches, settings). Daily and before each migration; the last 14 are kept. **No token** |
| Settings | in the database (`app_settings`) | Repo, org, project number and pinned node ID, project title, field mapping by field ID (with the Priority order and the Status options that count as done), toggles. **No token** |

Exports from Settings contain the same data as a backup, and never the token.

## What Deska never does

- Never deletes issues, comments, project items or anything else on GitHub.
- Never creates, renames or deletes project fields, options or iterations.
- Never removes items from a project.
- Never edits issue titles or bodies, posts GitHub comments or changes parent/sub-issue links.
- Never writes to a project other than the pinned one.
- Never touches pull requests.
- Never sends data anywhere except the GitHub API.
- Never shares data between users: personal tasks stay on the Mac and never go to GitHub.
- Never updates itself.

## Write gate

Deska v1.0 is **read-only**. Writes (planning edits, close/reopen, create issue) come later, and a GitHub write happens only when **all three** hold:

1. **The token has write permissions** (Issues: Read and write, Projects: Read and write). With a read-only token GitHub refuses every write.
2. **Settings → "GitHub writes" is on.** It's off by default, and turns off again after every token change.
3. **The build allows writes.** A binary built with `DESKA_WRITES=off` refuses writes whatever 1 and 2 say. v1.0 is built this way.

When writes are on, each one follows an intentional user action, checks that the value hasn't changed on GitHub since it was read, shows success or failure, and re-reads the issue afterwards. Bulk edits over 50 issues ask for confirmation first. Allowed operations:

| Write | GitHub API |
|---|---|
| Sprint, Status, Priority and other single-select fields | `updateProjectV2ItemFieldValue`, `clearProjectV2ItemFieldValue`; `addProjectV2ItemById` first if needed |
| Assignees, labels | REST add / remove |
| Type, milestone | `updateIssueIssueType`; REST `PATCH` milestone |
| Close / reopen | REST `PATCH` state and state reason, plus the Status field |
| Create issue | REST `POST /issues`, then add to the project and set fields |

## Probing a token from the command line

`pnpm probe:pat` checks what a token can read, without changing anything. It is a command-line tool for the maintainer, separate from the app, and reads the token from the `GITHUB_TOKEN` variable of the shell that runs it; the app itself never reads a token from the environment. Its client can only send REST `GET`s and GraphQL queries; a test fails if it would send any other REST method or a GraphQL `mutation`. The report is written to `private/findings/`, which git ignores.

```bash
read -rs GITHUB_TOKEN && export GITHUB_TOKEN
GITHUB_REPO=<owner>/<repo> GITHUB_ORG=<org> GITHUB_PROJECT_NUMBER=<n> pnpm probe:pat
```

`PROBE_ISSUE_NUMBER=<n>` picks the issue for the per-issue checks; by default it uses the first issue the `issues-since` check returns (an issue updated in the last 30 days), or #1.
