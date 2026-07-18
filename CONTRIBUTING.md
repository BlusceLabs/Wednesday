# Contributing to Wednesday

Thanks for your interest in improving Wednesday! This guide covers how to get
set up, the conventions we follow, and how to get your change merged.

## Getting started

```bash
bun install
bun run dev        # launches the terminal UI
bun run serve      # launches the web dashboard
bun run headless "your prompt"   # runs a single turn, no TUI
```

TypeScript is checked with `bunx tsc --noEmit`. Please keep the tree clean
before opening a pull request.

## Branching

- `main` is the stable line and is what releases are cut from.
- Open feature/fix branches from `main` (e.g. `feat/model-picker`,
  `fix/scrollbar`).
- Keep PRs focused — one logical change per pull request.

## Commit style

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add per-provider OpenRouter attribution
fix: prevent nested <text> crash in model picker
docs: document attribution headers in README
```

## Code conventions

- No comments unless explicitly requested or the logic is genuinely
  non-obvious — prefer self-documenting names.
- Match the existing style: `COLORS` palette, `Divider`/`SectionHeader`/
  `StatusPill` helpers in the TUI, `padEnd` single-`<text>` rows for aligned
  columns (OpenTUI `<text>` does not accept nested `<text>` children).
- Run `bunx tsc --noEmit` before pushing.

## Reporting bugs

Open an issue with:

- Wednesday version (`bun run config` or the About tab)
- Your OS and terminal
- Steps to reproduce, expected vs. actual behavior
- Any relevant logs (redact secrets)

## Security

Found a vulnerability? **Do not open a public issue.** Follow
[SECURITY.md](./SECURITY.md) and report privately.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](./LICENSE).
