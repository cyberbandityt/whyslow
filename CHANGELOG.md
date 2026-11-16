# Changelog

All notable changes to whyslow are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

## 0.1.0 - 2026-11-16

First release.

### Added

- `diagnose` (the default command): memory pressure and swap, CPU load with the busiest apps, VMs and Docker, open browsers, oversized system processes such as WindowServer and Spotlight, background launchd jobs, uptime, thermal throttling and free disk space. Each finding is one line with its fix, worst first, plus a 0-100 score.
- `progress`: how much better the Mac is since the first check, and how much space `clean` has freed. `diagnose` also compares each run with the previous one.
- `services`: third-party launchd jobs (the macOS equivalent of systemctl), servers listening on ports, and running Docker containers.
- `disk`: what fills the disk, largest first, split into `cache` targets that are safe to delete and `manual` targets that only get a hint.
- `big [folder]`: the biggest items in one folder.
- `clean <id...>`: a dry run that lists what would be deleted. Nothing is deleted without `--yes`, and every path goes through a safety check.
- Clean targets for package manager caches (npm, pnpm, Yarn, Bun, Deno, pip, uv, conda, Cargo, Go, Maven, Gradle, Composer, pub, CocoaPods), Playwright, Puppeteer and Electron downloads, Homebrew, Xcode, iOS updates, JetBrains, old VS Code extensions and workspace state, browser caches, Electron app caches, Spotify, and build folders in idle projects (`--keep`, `--days`).
- Report-only targets for VMs, Colima, Docker, simulators, Xcode archives, Android emulators, AI models, old toolchains, Steam games, Photos, Messages, WhatsApp, iOS backups, Movies, Music, Downloads and the Trash.
- Plugin manifests for Claude Code, Codex, GitHub Copilot CLI and Gemini CLI / Antigravity.
