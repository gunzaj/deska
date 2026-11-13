# Deska

A macOS desktop app for working with **GitHub Issues and an org GitHub Project**: better filtering, fast triage, parent issue progress, a sprint view, and Todoist-like personal tasks that can link to issues.

- Talks to GitHub directly with your own fine-grained personal access token. No server, no hosting.
- Read-only by default. Writes are opt-in and need a token with write permissions.
- Your tasks and settings stay on your Mac.

**Status:** early. The spec is written; the app is being built milestone by milestone. See [`docs/SPEC.md`](docs/SPEC.md).

## Run it

Needs Node 24 and pnpm on macOS.

```bash
pnpm install
pnpm desktop:dev     # the app with hot reload, on fictional demo data
pnpm desktop:build   # an ad-hoc signed universal .dmg in release/ (no Developer ID)
```

`pnpm dev` still serves the same UI in a browser on the demo data, which is handy for UI work.

## Contributing

Read [`AGENTS.md`](AGENTS.md) first, whether you're a person or a coding agent. After cloning:

```bash
git config core.hooksPath .githooks
```

## License

[MIT](LICENSE)
