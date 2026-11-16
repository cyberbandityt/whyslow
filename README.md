# whyslow

[![CI](https://github.com/cyberbandityt/whyslow/actions/workflows/ci.yml/badge.svg)](https://github.com/cyberbandityt/whyslow/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg)

**Find out why your Mac is slow and what fills its disk, clean caches safely, and see how much better it got.**

![whyslow in a terminal: diagnose a slow Mac, clean caches with a dry run first, then see the score go from 40 to 92](assets/demo.gif)

```bash
claude plugin marketplace add cyberbandityt/whyslow && claude plugin install whyslow@whyslow
```

Then ask Claude Code "why is my Mac slow?". For Codex, Copilot CLI, Gemini CLI and other agents, see [Install](#install).

whyslow is a tiny TypeScript CLI packaged as a skill for AI coding agents: Claude Code, Codex, GitHub Copilot CLI, Gemini CLI / Antigravity, or anything that can run a shell command. Ask your agent "why is my Mac slow?" and it runs whyslow, reads the short report, and explains the fixes.

```text
$ whyslow
whyslow: 16.0G RAM, 10 cores, load 6.2, up 23d, score 40/100
top: Google Chrome 4.6G x38, Visual Studio Code 3.2G x26, Docker 2.3G x5, Safari 1.4G x9, Slack 1.1G x6, WindowServer 790M
!! memory: swap 9.4G/10.0G, compressed 4.1G, 18% free of 16.0G RAM | fix: quit the heavy apps listed under top
!  vm: Docker Desktop running (2.3G) | fix: quit Docker Desktop
!  browsers: 2 open: Google Chrome 4.6G x38, Safari 1.4G x9 | fix: keep one browser open
!  background: 2 launchd jobs running 590M | fix: whyslow services
!  uptime: 23 days since restart | fix: restart to clear leaks and swap
!  disk: 61.3G free of 460.4G (13%) | fix: whyslow disk
vs last check 3d ago: worse, score 72 -> 40, swap 2.1G -> 9.4G, free memory 41% -> 18%, disk free 64.0G -> 61.3G
```

```text
$ whyslow disk
disk: 61.3G free of 460.4G (13%)
 21.4G  docker         manual: docker system prune -a with Docker Desktop running
 14.8G  photos         manual: Photos > Settings > iCloud > Optimize Mac Storage, or delete media inside Photos, never in Finder
  9.6G  projects       cache, 23 folders idle 30d+
  6.1G  xcode          cache
  3.4G  app-caches     cache, 41 folders
  2.9G  ai-models      manual: ollama rm <model>, huggingface-cli delete-cache, or delete models in LM Studio
  2.2G  npm            cache
  1.2G  vscode         cache, 37 folders
  1.1G  downloads      manual: sort Downloads by size in Finder
  640M  browsers       cache
cleanable 23.1G: whyslow clean projects xcode app-caches npm vscode browsers
```

```text
$ whyslow progress
progress: 2 checks over 14d since 2026-11-01
first -> now: better, score 36 -> 92, swap 9.4G -> 410M, free memory 18% -> 57%, disk free 21.7G -> 44.1G
cleaned: 22.1G freed in 2 runs (projects, xcode, npm, app-caches, vscode)
```

## What it checks

| Check | Flags when |
|---|---|
| Memory | swap is over half your RAM, or free memory is under 20% |
| CPU | load average is above your core count (names the busiest apps) |
| VMs | Colima/Lima, Docker Desktop, OrbStack, VMware, Parallels, QEMU or Apple Virtualization VMs are running |
| Browsers | more than one browser is open |
| Known leaks | macOS helpers that are known to grow (CursorUIViewService, WindowServer, Spotlight's `mds_stores`) are too large |
| Background | third-party launchd jobs use more than 512M between them |
| Uptime | 14 days or more since the last restart |
| Disk | less than 20% free |
| Thermal | the CPU is being throttled |

Memory is measured with the same footprint Activity Monitor uses (it includes compressed memory), and helper processes are grouped under their app, so "Google Chrome x38" means 38 Chrome processes.

The score starts at 100 and loses 20 for each `!!` finding and 8 for each `!` finding. It is a rough number for comparing one day with another, not a benchmark.

## Install

Every install below uses the same `skills/whyslow` folder from this repo. You need Node.js 22.18 or newer on your PATH, because the skill runs TypeScript directly with Node's built-in type stripping. There is no build step and there are no runtime dependencies.

### Claude Code

```bash
claude plugin marketplace add cyberbandityt/whyslow && claude plugin install whyslow@whyslow
```

Or, inside Claude Code, send `/plugin marketplace add cyberbandityt/whyslow` and then `/plugin install whyslow@whyslow` as two prompts. Then ask "why is my Mac slow?" or type `/whyslow`.

### Codex

```bash
codex plugin marketplace add cyberbandityt/whyslow && codex plugin add whyslow@whyslow
```

### GitHub Copilot CLI

```bash
copilot plugin marketplace add cyberbandityt/whyslow && copilot plugin install whyslow@whyslow
```

### Gemini CLI / Antigravity

```bash
gemini extensions install https://github.com/cyberbandityt/whyslow
# or
agy plugin install https://github.com/cyberbandityt/whyslow
```

### Any other agent (Cursor, Windsurf, Cline, ...)

Copy `skills/whyslow` into your tool's skills folder, or tell your agent: "run `node --no-warnings /path/to/whyslow/skills/whyslow/scripts/whyslow.ts` and explain the result".

### Plain CLI, no agent

```bash
git clone https://github.com/cyberbandityt/whyslow
cd whyslow
./skills/whyslow/scripts/whyslow.ts            # diagnose
./skills/whyslow/scripts/whyslow.ts disk
```

## Usage

```text
whyslow [diagnose]          memory, swap, CPU, VMs, browsers, leaks, background items, uptime, disk; scores 0-100
whyslow progress            first check against now, and the space clean has freed
whyslow services            launchd jobs (the macOS systemctl), listening servers and Docker containers
whyslow disk                caches, app data and project build folders, largest first
whyslow big [folder]        biggest items in a folder (default: home), to drill down
whyslow clean <id...>       dry run: what clean would delete
whyslow clean <id...> --yes delete it

--keep a,b  skip found folders whose path contains any of these words (disk, clean)
--days N    only take project folders idle N days or more (default 30, 0 for all)
```

### Before and after

Every `diagnose` adds one line (score, swap, free memory, free disk) to `~/Library/Application Support/whyslow/history.jsonl`, and every `clean --yes` adds the space it freed. `diagnose` compares itself with the previous check, and `progress` compares your first check with the latest one. The file never leaves your Mac; delete it to start over.

### Background services

macOS has no `systemctl`; background services are launchd jobs. `whyslow services` lists:

- third-party launch agents and daemons (`~/Library/LaunchAgents`, `/Library/LaunchAgents`, `/Library/LaunchDaemons`) and jobs that apps register from inside their bundle, running ones first with their memory
- Homebrew services, with the `brew services stop` command for each
- processes of yours listening on a TCP port, such as a dev server you forgot, a database or a local tool
- running Docker containers

```text
$ whyslow services
services: 5 third-party launchd jobs, 3 running 604M
  380M  homebrew.mxcl.postgresql@16 | stop: brew services stop postgresql@16
  210M  com.example.sync.agent
   14M  homebrew.mxcl.redis | stop: brew services stop redis
not running: com.example.updater, com.example.vpn.helper
listening: node[48211] :3000 612M, postgres[702] :5432 380M, redis-server[705] :6379 14M
docker: 2 up: api-db (postgres:16), mailpit (axllent/mailpit)
fix: turn launchd jobs off in System Settings > General > Login Items & Extensions or uninstall their app; kill <pid> for a forgotten server; docker stop <name>
```

### Finding space

`whyslow disk` measures every target below and prints the ones over 50M. For anything it doesn't explain, `whyslow big <folder>` shows the biggest items in one folder so you can drill down:

```text
$ whyslow big ~/Library
big: ~/Library 48.2G
 18.4G  Containers/
 12.1G  Application Support/
  9.8G  Caches/
  4.6G  Developer/
  1.9G  Group Containers/
  1.4G  57 more
```

A dry run shows exactly what `clean` would delete:

```text
$ whyslow clean projects app-caches --days 90 --keep client
would free ~4.2G from projects: rm -rf 5 folder(s)
    1.9G ~/Developer/shop-web/node_modules, idle 212d
    1.4G ~/Developer/game-engine/target, idle 95d
    598M ~/Projects/ml-notebooks/.venv, idle 140d
    234M ~/code/mobile-app/Pods, idle 301d
     51M ~/code/docs-site/.next, idle 118d
would free ~3.4G from app-caches: rm -rf 41 folder(s)
  apps: Slack 1.6G, Discord 1.1G, Notion 410M, Figma 303M
dry run: add --yes to delete
```

### Clean targets

| id | What gets deleted | How |
|---|---|---|
| `npm` | npm cache | `npm cache clean --force` |
| `pnpm` | unused packages in the pnpm store | `pnpm store prune` |
| `yarn`, `bun`, `deno` | package caches | rm |
| `pip` | pip and Poetry caches | rm |
| `uv` | uv cache | `uv cache clean` |
| `conda` | conda package cache | `conda clean --all --yes` |
| `cargo` | Cargo registry and git checkouts (installed binaries stay) | rm |
| `go` | Go build cache | rm |
| `maven` | `~/.m2/repository` | rm |
| `gradle` | `~/.gradle/caches` and downloaded Gradle versions (your `gradle.properties` stays) | rm |
| `composer`, `pub`, `cocoapods` | package caches | rm |
| `test-browsers` | browsers downloaded by Playwright and Puppeteer, and Electron downloads | rm |
| `brew` | Homebrew download cache | `brew cleanup --prune=all` |
| `xcode` | DerivedData, device support files and simulator caches | rm, only while Xcode and Simulator are closed |
| `ios-updates` | downloaded iPhone and iPad firmware | rm |
| `jetbrains` | JetBrains IDE caches and indexes | rm, only while the IDEs are closed |
| `vscode` | extension folders that VS Code, Cursor, Windsurf, VSCodium or another VS Code-based editor no longer lists (old versions, uninstalled ones), and workspace storage of folders that no longer exist | rm; an editor's extensions only while that editor is closed |
| `browsers` | caches of Chromium-based browsers and Firefox | rm, only while those browsers are closed |
| `app-caches` | `Cache`, `Code Cache`, `GPUCache` and similar folders of every Electron or Chromium-based app | rm, skipping apps that are open |
| `spotify` | Spotify cache | rm, only while Spotify is closed |
| `projects` | dependency and build folders in projects idle 30 days or more: `node_modules`, `.next`, `.nuxt`, `.turbo`, `.parcel-cache`, Python `.venv`/`venv`, Rust and Maven `target`, CocoaPods `Pods`, Flutter and Gradle `build`, `.gradle`, `.dart_tool` | rm, minus `--keep` matches |

`projects` looks under `~/Documents`, `~/Desktop`, `~/Developer`, `~/Projects`, `~/code`, `~/dev`, `~/src`, `~/repos`, `~/git`, `~/GitHub` and `~/workspace`. A project counts as idle when nothing at its top level (including `.git`) changed for `--days` days.

These are only reported, never deleted, because they hold personal data, VMs or things you chose to install: `vms`, `colima`, `docker`, `simulators`, `xcode-archives`, `android` (emulators and system images), `ai-models` (Ollama, Hugging Face, LM Studio), `toolchains` (old nvm, rustup and pyenv versions), `games` (Steam), `photos`, `messages`, `whatsapp`, `ios-backups`, `movies`, `music`, `downloads`, `trash`. whyslow prints how to free each one yourself.

### Safety

- `clean` is a dry run unless you pass `--yes`, and the dry run lists the folders it would remove.
- It refuses to delete anything outside your home folder, your home folder itself, or top-level folders such as `~/Documents`.
- It skips a target while the app that owns it is running. For `app-caches` and `vscode` this is decided per app, so one open app doesn't block the rest.
- `projects` only takes a folder when the file that creates it sits next to it (`Cargo.toml` or `pom.xml` for `target`, `Podfile` for `Pods`, `pyvenv.cfg` inside a venv, and so on), and only in idle projects.
- The skill tells agents to show you the dry run and wait for your OK before adding `--yes`.

## Development

```bash
npm install        # dev tools only: typescript and @types/node
npm run check      # type-check
npm test           # node --test
npm start -- disk  # run the CLI from the repo
```

To try your local copy in Claude Code before publishing, run `/plugin marketplace add /absolute/path/to/whyslow`, then `/plugin install whyslow@whyslow`.

## Publishing a new version

1. Bump `version` in `package.json`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `.github/plugin/plugin.json` and `gemini-extension.json`.
2. Add a section for the version to [CHANGELOG.md](CHANGELOG.md).
3. Run `npm run check && npm test`.
4. Commit, tag (`git tag v0.2.0`), push with tags, and publish the release with `gh release create v0.2.0 --notes-file <the changelog section>`. Plugin users get the update the next time their tool refreshes the marketplace.

## Contributing

Bug reports, ideas and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md), and look for issues labeled [good first issue](https://github.com/cyberbandityt/whyslow/labels/good%20first%20issue). Questions go to [Discussions](https://github.com/cyberbandityt/whyslow/discussions).

## Limitations

- macOS only. Every check uses macOS tools.
- Size scans call `du`, so `whyslow disk` and `whyslow big ~` can take 10 to 30 seconds on a big home folder.
- Folders protected by macOS privacy settings (Mail, Messages, Photos) read as empty unless your terminal has Full Disk Access.
- `services` sees jobs, ports and containers that your user can see without `sudo`, and ignores ports above 49151 that apps open for themselves.
- A project's idle time comes from its top-level files and `.git`, so weeks of uncommitted edits deep inside `src/` can look idle. Use `--keep` for projects you are still working on.

## License

[MIT](LICENSE)
