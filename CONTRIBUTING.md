# Contributing to whyslow

Thanks for helping. whyslow is small on purpose, so most changes are a few lines.

## Setup

You need macOS and Node.js 22.18 or newer.

```bash
git clone https://github.com/cyberbandityt/whyslow
cd whyslow
npm install        # dev tools only: typescript and @types/node
npm run check      # type-check
npm test           # node --test
npm start -- disk  # run the CLI from the repo
```

## Where things live

- `skills/whyslow/SKILL.md`: the instructions an agent loads.
- `skills/whyslow/scripts/whyslow.ts`: CLI entry and argument parsing.
- `skills/whyslow/scripts/diagnose.ts`: the snapshot, findings, score, `services` and `progress`.
- `skills/whyslow/scripts/disk.ts`: clean targets, `disk`, `big` and `clean`.
- `skills/whyslow/scripts/lib.ts`: shell helper, size formatting, history file.
- `test/whyslow.test.ts`: tests for the parsers, rules, finders and the delete guard.

To add a clean target, add one line to the `TARGETS` list in `disk.ts`. Give it a `manual:` hint instead of making it deletable if the folder holds personal data, VMs, or anything that isn't rebuilt on demand.

## Rules

- Make the smallest change that works. Use the Node standard library and macOS's own tools. Don't add runtime dependencies, and don't add abstractions that have only one implementation.
- Agents read the output, so keep it short: one line per finding, no banners or colors, and sizes like `1.2G`.
- TypeScript runs directly through Node's type stripping. Use erasable syntax only (no `enum`, no `namespace`, no constructor parameter properties) and import with `.ts` extensions.
- `clean` must never delete without `--yes`, and every deleted path must go through `assertSafe`.
- Add or update a test in `test/whyslow.test.ts` when you change a rule, a parser or anything that decides what gets deleted.

## Pull requests

1. Fork the repo and create a branch.
2. Run `npm run check && npm test` before you push. CI runs the same checks on macOS with Node 22 and 24.
3. Describe what changed and paste the whyslow output before and after if the output changed.
4. Add a line under `Unreleased` in [CHANGELOG.md](CHANGELOG.md).

New here? Start with an issue labeled [good first issue](https://github.com/cyberbandityt/whyslow/labels/good%20first%20issue). For questions, open a [discussion](https://github.com/cyberbandityt/whyslow/discussions).

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
