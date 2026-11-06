# Agent guidance

Read [`docs/SPEC.md`](docs/SPEC.md) and follow it. Part 0 is the runbook: how to work, the rules, and the only points where you stop. Part 5 is the build plan, in order. Track progress in `docs/PROGRESS.md`.

The short version of the hard rules (full list in SPEC §0.2):

- **This repo is public.** No real organization, company, repository or people names, real GitHub IDs, internal links, tokens or emails. Use the fictional `acme/widgets` dataset.
- **`private/` is off-limits** unless the maintainer asks. Never copy anything from it into tracked files.
- **Never write to a real GitHub repo or project**, never delete, never touch project fields, options or iterations.
- **The leak guard must pass.** Never commit with `--no-verify`.

One-time setup in a fresh clone or worktree:

```bash
git config core.hooksPath .githooks
```
