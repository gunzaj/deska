# Agent guidance

Read [`docs/SPEC.md`](docs/SPEC.md) before writing any code. It is the product and technical source of truth. Build the milestones in §9 in order, one small PR each.

## This repo is public

- Never add real organization, company, product, repository or people names, real GitHub node IDs, real issue titles, internal links, tokens or emails. Use the fictional dataset: org `acme`, repo `acme/widgets`, people `alice`, `bob`, `carol`, `dave`.
- `private/` is the maintainer's gitignored folder. Read it only when asked. NEVER copy its content into tracked files, commit messages, PR descriptions or fixtures.
- Test fixtures and recorded GitHub responses must be synthetic.
- Commit with a GitHub noreply email.
- The leak guard must pass. Never commit with `--no-verify`.

One-time setup in a fresh clone:

```bash
git config core.hooksPath .githooks
```

Check everything tracked at any time:

```bash
node scripts/leak-guard.mjs --all
```

## GitHub safety

- Development and tests never write to a real repository or project. Use mocks or a sandbox org/project.
- Never call a delete operation. Never create, rename or delete project fields, options or iterations. Never remove project items.
- Never hardcode field names, option names or emoji. Discover them via GraphQL and store them by ID.

## Done means

- CI passes `typecheck`, `lint`, `vitest`, `playwright` (mocks) and the leak guard.
- The PR lists the milestone's acceptance criteria and how each was checked.
- Behavior changes update `docs/SPEC.md` in the same PR.
