# Working on whyslow

- Ponytail rules: the smallest change that works. Use the Node standard library, add no runtime dependencies, no abstractions with a single implementation.
- Output is read by AI agents, so keep it token-lean (the RTK idea): one line per finding, no banners, no colors, sizes like `1.2G`.
- TypeScript runs directly through Node type stripping. Use erasable syntax only (no `enum`, no `namespace`, no constructor parameter properties) and import with `.ts` extensions.
- Never let `clean` delete without `--yes`, and keep every deleted path behind `assertSafe`.
- Before you finish: `npm run check && npm test`.
