# Deska security overview

For security reviewers and org admins deciding whether to approve a Deska token. Deska is a macOS desktop app that reads one GitHub repository and one organization Project (v2) with the user's own fine-grained personal access token (PAT) or, if the user chooses, the login of the GitHub CLI they already use. It has no backend, no hosting and no OAuth app of its own.

This page describes the design in [`SPEC.md`](SPEC.md). The desktop shell and the local server hardening below landed in D2, token entry, onboarding and the token checks in D3. In-process sync lands in D5; until then the app shows a fictional demo dataset. Check [`PROGRESS.md`](PROGRESS.md) for what is built.

## Architecture

```
Electron main process
  ├─ window, menus, dock badge, global shortcut, native notifications
  ├─ token store (safeStorage → Keychain-backed key)
  ├─ login-shell PATH, resolved once per launch (finds `gh`)
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

A **fine-grained PAT** (recommended):
- Resource owner: the organization.
- Repository access: **only the one repository** Deska reads.

A **classic PAT** is also accepted, for when an org has not approved a fine-grained one. It cannot be limited to one repository, so use it only with read-only scopes: `read:project` (add `read:org` if the project isn't found) for a public repository, which needs no other scope. A private repository would need the `repo` scope, which can write; avoid that. Deska reads the token's scopes (`x-oauth-scopes`) and warns in Settings when one of them can write. Pasting an OAuth token is not supported; the GitHub CLI's login, below, is the one way an OAuth token is used.

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

### GitHub CLI login (optional)

Instead of pasting a token, the user can pick "Use my GitHub CLI login" when the GitHub CLI (`gh`) is installed and logged in. It is offered, never chosen for them.

- **What Deska runs.** Two read-only commands: `gh auth token --hostname github.com` (the token, on standard output) and `gh auth status --hostname github.com` (the account name, to show "signed in as …"). It finds `gh` on the PATH of the user's login shell, which the main process asks for once per launch (`$SHELL -l -c`, 5 s limit, then a fallback of the usual Homebrew folders). Deska never runs `gh auth login` or `gh auth refresh`; it shows the command for the user to run. It never uses the GitHub CLI's client ID and has no OAuth flow of its own.
- **What the token is.** An OAuth token issued to the GitHub CLI's own OAuth app, with classic scopes. An org that restricts OAuth apps approves the GitHub CLI once for all its members; until then Deska says "Your org may need to approve the GitHub CLI app".
- **Scopes.** The CLI's defaults include `repo` and `read:org`. Deska also needs `read:project` (`project` once writes are on), which the user adds with `gh auth refresh -h github.com -s read:project`. Deska reads the scopes from `x-oauth-scopes`, lists them in Settings, and names a missing one together with that command.
- **Why the write gate matters more here.** `repo` can write to every repository the user can, and it cannot be narrowed to one repository or to read-only. So a GitHub CLI token always counts as able to write, GitHub will not refuse a write on Deska's behalf, and the first line of the write gate below gives no protection. What keeps Deska read-only with this source is the rest of the gate: "GitHub writes" is off by default and turns off again on every switch of source, a build made with `DESKA_WRITES=off` (v1.0) refuses writes outright, and the write client has an operation allowlist with no delete in it. Settings says so next to the scopes. Reviewers who want GitHub itself to enforce read-only should have people use a read-only fine-grained PAT instead.
- **Where the token lives.** Main reads it at launch, when the Mac wakes, once after GitHub answers 401, and on "Check again", and hands it to the local server in the same IPC message as a stored token. It is held in memory only: **never written to disk** (no `github-token.bin` exists with this source; the only thing stored is the choice, `githubAuthSource: "gh"`, in `desktop-prefs.json`), and never passed to another process in arguments or environment. The local server is also started without any `GH_TOKEN` or `GITHUB_TOKEN` the user's shell may have exported. The same redaction covers it (`gho_…` and any value equal to the token).
- **A 401** makes Deska read the token from the CLI again, once. If GitHub refuses that one too, the app shows "Your GitHub token is invalid or expired" over the cached data.
- **Turning it off.** "Disconnect GitHub" or "Paste a token instead" turns the source off. Neither logs the GitHub CLI out. Switching to this source deletes any stored token first.

### Storage

- The user pastes the token in onboarding or Settings. It goes through a minimal preload bridge to the Electron **main** process, never over HTTP. The input field is emptied as soon as the token is handed over, and the page never gets it back.
- Main accepts only fine-grained (`github_pat_…`) and classic (`ghp_…`) tokens, encrypts the token with Electron `safeStorage` (the key is held in the macOS Keychain) and stores only the ciphertext (`github-token.bin`) in the app data folder.
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
- The renderer runs with `contextIsolation: true`, `sandbox: true` and `nodeIntegration: false`. The preload bridge exposes only token entry, the GitHub sign-in source (use the GitHub CLI login, its state, check again; never a token), notifications, open-external and app info.
- Navigation is locked to the app's own origin. `https://github.com/*` links open in the default browser; every other external URL is blocked.
- Nothing is loaded from the network at runtime except the GitHub API. The window itself may only fetch images from GitHub's hosts (`github.com`, `*.githubusercontent.com`) for avatars and issue attachments; every other request it makes outside the app is cancelled.
- One app instance per user profile, so two servers never open the same database.

## What is stored on disk

All under `~/Library/Application Support/Deska/`, readable only by the user's macOS account:

| What | Where | Contains |
|---|---|---|
| Encrypted token | app data folder (`github-token.bin`) | `safeStorage` ciphertext only. Absent with the GitHub CLI source, which stores no token |
| Encrypted AI API key (optional) | app data folder (`ai-key.bin`) | `safeStorage` ciphertext only. Absent unless the user set an API key for an OpenAI-compatible AI endpoint (see "AI assist") |
| Desktop settings | `desktop-prefs.json` | The quick-add shortcut, notification, Dock badge and launch-at-login toggles, the second backup folder's path, and the GitHub sign-in source (`token` or `gh`). **No token** |
| Local database | `db/` | A cache of the repository's issues and project values, the token owner's login, name and avatar URL, plus personal tasks, saved views, snoozes, watches and settings. **No token** |
| Backups | `backups/` | JSON of local-only data (tasks, projects, labels, sections, views, snoozes, watches, settings). Daily, before each migration and before "Reset everything"; every backup of the last 14 days is kept, then one a week for 8 weeks. Files are owner-only (0600). **No token**, and any token-shaped text in a task is replaced by `[redacted]` |
| Second backup folder (optional) | a folder the user picks in Settings; its path is in `desktop-prefs.json` | The same backup files, copied there after each backup. Chosen only with the native folder dialog (the page cannot name a path), never inside Deska's own data, written owner-only (0600). Deska only deletes files there that match its own backup names. **No token.** If it is in a synced folder (iCloud Drive, a Nextcloud or Dropbox client), the sync service then holds the user's tasks: that is the user's choice |
| Settings | in the database (`app_settings`) | Repo, org, project number and pinned node ID, project title, field mapping by field ID (with the Priority order and the Status options that count as done), toggles, and the AI settings (provider, model, endpoint URL, timeout, extra instructions, which provider and model last passed "Test connection"). **No token, no API key** |
| AI results (cache) | in the database (`ai_results`) | What a model answered for an issue, list, task or day, with provider, model, duration and cost. A cache: **not in backups or exports**; "Reset GitHub cache" clears the issue-based rows and "Reset everything" all of them. No key |

Exports from Settings contain the same data as a backup, and never the token.

## What Deska never does

- Never deletes issues, comments, project items or anything else on GitHub.
- Never creates, renames or deletes project fields, options or iterations.
- Never removes items from a project.
- Never edits issue titles or bodies, posts GitHub comments or changes parent/sub-issue links.
- Never writes to a project other than the pinned one.
- Never touches pull requests.
- Never sends data anywhere except the GitHub API and, only if the user turned AI assist on and it passed "Test connection", the AI provider the user chose (see "AI assist").
- Never shares data between users: personal tasks stay on the Mac and never go to GitHub.
- Never updates itself.

## AI assist

Optional and **off by default**; nothing is spawned or sent until the user picks a provider in Settings → AI and "Test connection" passes for that provider, model and URL (changing any of them clears the pass). AI runs only when the user asks: no schedule, no background runs.

- **What is sent, where.** Only the fields Settings → AI lists per feature (issue text, the typed task line, task and issue titles for planning). Never the GitHub token, the API key, backups, settings, or tasks a feature does not need. Claude Code provider: the prompt goes on the `claude` CLI's stdin and on to Anthropic under the user's own Claude login (Deska stores no Anthropic key). OpenAI-compatible provider: the prompt goes to the base URL the user set, from the server process only. `https` for any host; plain `http` only for loopback, private ranges (`10/8`, `172.16/12`, `192.168/16`) and `*.local`, checked when the URL is saved and on every call. Redirects are never followed, so a key cannot be forwarded to another host.
- **No tools for the model.** The `claude` child runs with `--tools ""`, `--strict-mcp-config`, `--setting-sources ""` and `--no-session-persistence`, in an empty temporary folder that is deleted afterwards, with an environment that has no `GITHUB_*`, `GH_*`, `DESKA_*` or Electron variable. An endpoint gets a chat request and nothing else. Deska parses the answer as JSON against a schema and shows it as text; it never executes it, and the only link it makes clickable is `https://github.com/…`.
- **Untrusted text.** Issue and task text goes into delimited data blocks that cannot close themselves, under instructions that say it is data. The schema is built per request with enums of real IDs, so a value that does not exist cannot come back. A model that is told by an issue to close it still only returns a suggestion: suggestions change nothing until the user accepts, and accepting a GitHub change goes through the write gate like a manual edit.
- **The API key** follows the token's rules: entered through the preload bridge to the main process, encrypted with `safeStorage` (`ai-key.bin`), handed to the server over IPC, held in memory only, sent only as the `Authorization` header to the configured endpoint, redacted from logs and errors (also any `sk-…` shape), and never in an API answer, backup, export or `ai_results`. "Remove key" deletes it.
- **Local cache.** Results are stored in `ai_results` so a suggestion can be shown again and marked outdated when the issue changed. It is a cache, not part of backups or exports.

## Write gate

Deska v1.0 is **read-only**. Writes (planning edits, close/reopen, create issue) come later, and a GitHub write happens only when **all three** hold:

1. **The token has write permissions** (Issues: Read and write, Projects: Read and write). With a read-only token GitHub refuses every write. A GitHub CLI login always has them (its `repo` scope), so with that source only 2 and 3 stand between Deska and a write.
2. **Settings → "GitHub writes" is on.** It's off by default, and turns off again after every token change, which includes switching between a pasted token and the GitHub CLI login.
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
