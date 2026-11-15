# Changelog

Every change to the app bumps the version here and in `package.json` (see Versioning in the README). The newest version comes first. The app shows the newest section's lines when it launches on a new version.

## 1.27.1 — 2026-11-14

- The branch picker stays inside the window when the Git pane is narrow, instead of running off its left edge.

## 1.27.0 — 2026-11-14

- The branch picker has a Remote section: see where each remote points, edit its URL in place, or add origin to a repo that has none.

## 1.26.2 — 2026-11-14

The first public release, under GPL-3.0-or-later.

- One window, one tab per project: agent terminals (Claude Code, Junie, or any command), a live diff of the working tree against HEAD, a file tree and a small git panel with AI commit messages.
- A rearrangeable workspace with layout presets, find and replace across files, go to file, and a shared scratchpad.
- Playgrounds where Claude builds pages for you to look at or fill in, plus web pages and a media folder browser a keystroke away.
- Plugins: git repos that add languages, views, editor hooks and commands, installed and updated from the Plugins page.
- Updates itself from git on every launch.
- Runs on macOS. Linux and Windows are planned.
