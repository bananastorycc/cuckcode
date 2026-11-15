# Changelog

Every change to the app bumps the version here and in `package.json` (see Versioning in the README). The newest version comes first. The app shows the newest section's lines when it launches on a new version.

## 1.35.3 — 2026-11-14

- A playground's Done, or ⌥⌘K, reaches Claude even when it wasn't running yet: the message waits until Claude's prompt is up instead of getting lost while it starts.
- Settings arriving from the config repo or an import can't be undone by a save the window made just before it showed them.

## 1.35.2 — 2026-11-14

- A playground's Done only tells Claude once your answers have saved. If saving fails, the page says why and Claude isn't sent to read answers that aren't there.
- Switching projects right after typing in a playground no longer saves that last edit into the other project's playground.

## 1.35.1 — 2026-11-14

- The focused section's orange frame shows on all four sides. Its left edge used to hide under the divider line.

## 1.35.0 — 2026-11-14

- A playground page's Done button now hands over to Claude: it saves your answers, closes the playground and tells Claude to read them.

## 1.34.0 — 2026-11-14

- Playgrounds come with a built-in kit of templates: choices, image and video reviews, forms, plans, triage boards, tables, live design tuning, image annotation, charts, progress and reports. Claude builds pages from them in a few lines, so they cost fewer tokens and match cuckcode's look.
- Claude now uses the playground on its own whenever showing beats describing, and the page follows cuckcode's light or dark theme.
- The Templates button in a playground shows every template live.

## 1.33.0 — 2026-11-14

- Settings › Sync exports your settings, theme and saved layouts to a file and imports them back, to move them to another machine.
- Or give it a git repo: cuckcode pulls your settings at launch and commits and pushes each change, so every machine stays in step.

## 1.32.0 — 2026-11-14

- The section you're in has an orange frame, so you can see where focus is and where ⌃⌘arrows move it.

## 1.31.1 — 2026-11-14

- ⌘E toggles the README even while the editor has focus. The editor used to take it for Find with Selection.
- A plugin shortcut that clashes with one cuckcode already uses no longer shows in its button's tooltip, since it doesn't work.

## 1.31.0 — 2026-11-14

- Notifications when Claude is done or needs your input now work without any setup. They were silent unless you'd set Claude's notification channel by hand. macOS asks once whether cuckcode may show them.
- Settings › General › Notifications turns them off (they're on by default). The project tab still lights up either way.

## 1.30.0 — 2026-11-14

- ⌘W now closes the open file, and ⇧⌘W closes the project. Closing a project from the keyboard or menu asks first, since it stops its terminals.
- ⌘← and ⌘→ go back to jumping to the start and end of the line everywhere. Switch projects with ⇧⌘[ and ⇧⌘].
- Moving focus between sections is now ⌃⌘ + arrows, so ⌥⌘↑/↓ adds cursors in the editor again.

## 1.29.4 — 2026-11-14

- A plugin can no longer take a shortcut that copy, paste, undo, select all, minimize or project/pane switching already use; it keeps its menu item without the shortcut.
- Settings describe where agents and playgrounds show in the current layout, and tab tooltips only list ⌘1–9 shortcuts that exist.

## 1.29.3 — 2026-11-14

- Updating a plugin on the Plugins page now shows its new README right away, without switching plugins first.

## 1.29.2 — 2026-11-14

- Saving can no longer leave a half-written file if the app or Mac dies mid-save. Symlinks, permissions and read-only files behave as before. The same goes for Replace All, settings, scratch notes and playground answers.
- Live updates (diff, file tree, git status) come back on their own if a project's file watcher fails, or once a missing project folder reappears.
- Search no longer shows the previous project's results for a moment after switching tabs.
- Closing a project frees what was kept for it; reopened, it starts fresh.
- Two Claude agents starting in one project at once no longer both add `.cuckcode/` to `.git/info/exclude`.

## 1.29.1 — 2026-11-14

- Typing in a terminal can't get stuck if saving open files before a prompt fails.
- Git buttons, the branch picker and the all-repos buttons can't stay greyed out after an unexpected error; it's shown instead.
- A plugin whose project data fails to load no longer breaks the rest of the app.
- Small memory and code tidy-ups.

## 1.29.0 — 2026-11-14

- Playgrounds now fill the whole workspace instead of only the code pane.

## 1.28.0 — 2026-11-14

- The projects folder no longer defaults to `~/repos`. The first ⌘T asks where your projects live and remembers it. Change it any time in Settings.

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
