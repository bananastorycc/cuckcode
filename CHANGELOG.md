# Changelog

Every change to the app bumps the version here and in `package.json` (see Versioning in the README). The newest version comes first. The app shows the newest section's lines when it launches on a new version.

## 1.45.2 — 2026-11-16

- Moving focus between sections is now ⌃⇧arrows, since ⌃⌘arrows kept making macOS beep.

## 1.45.1 — 2026-11-16

- A section you minimize, restore, move and minimize again comes back where you left it, not in the group it used to share.
- A required playground field answered with 0 (a number, a slider) counts as answered, so Done goes through.
- Dragging a divider does less work per frame.
- The README grew an attitude. Fuck you. ❤️

## 1.45.0 — 2026-11-15

- ✨ Minimize sections you don't need with the – on their tab. They wait as buttons in the title bar and come back where they were, at the same size.
- Opening a file, ⇧⌘F and sending a selection bring the Editor, Search and Agents back (or to the front of their tabs) when they're minimized or hidden behind another tab.

## 1.44.0 — 2026-11-15

- ✨ Playground review tiles show the whole picture (tall sprites were cropped to the head) and turn portrait when most pictures are tall.
- ✨ The playground lightbox: ‹ › arrows, a verdict key keeps your zoom, Esc leaves the note box before closing, and closing lands on the tile you ended on.
- ✨ Enlarge a choice's picture and Pick it from there; pictures in reports enlarge too.
- A playground keeps your scroll position and open tab when the agent updates the page.
- Done won't send while a required field is empty; it shows you which.
- Copy buttons in playgrounds work.
- Annotate fits tall images in the window; missing images say which file; a page with a bug says so instead of going blank.
- A ✕ closes the playground. Pages can no longer scroll the whole window up under the header.

## 1.43.1 — 2026-11-15

- A note typed on an enlarged image in a playground review now shows on its tile when you close it.

## 1.43.0 — 2026-11-15

- ✨ Playground images open fitted whole to the window, however tall, and zoom: pinch or ⌘-scroll, drag to pan, double-click, or + / − / 0.
- The dock's dividers no longer show through the playground as stray draggable lines.

## 1.42.1 — 2026-11-15

- A confirm that replaces another one now answers the first cleanly, without React warnings.

## 1.42.0 — 2026-11-15

- ✨ commit all and sync all ask before running, saying what they'll do. Tick Don't ask again to skip it; Settings › Git › Confirm all-repo actions turns it back on.

## 1.41.0 — 2026-11-15

- Agents are now any command plus switches for what cuckcode does with them: Notify, Keep awake, @ mentions, ⇧↩ newline and Playground. Add one from a preset (Claude Code, or a plain command) and change anything. Agents set up before this version need adding again: Claude Code is a preset, and Junie is a Command agent running `junie --auth-license=<id>`.
- Notifications, keep-awake, file mentions, ⌥⌘K and a playground's Done work with any agent that has them switched on, not only Claude.
- The command that writes AI commit messages is a setting (Settings › Git), still Claude Haiku by default. Empty hides the AI buttons.
- Usage meters moved to a plugin, cuckcode-meters. Plugins can now add agent presets and draw in the Agents title bar.
- A playground's Done and ⌥⌘K say so when no agent can take them, instead of doing nothing.
- A scratchpad edit made just before quitting is no longer lost when syncing the config through git.
- Discard Changes asks in cuckcode's own dialog, and branch names starting with a dash are refused.
- A plugin without a lockfile gets its dependencies installed before it builds.
- The Sync settings now say what travels: plugins installed from a URL and the scratchpad do.

## 1.40.1 — 2026-11-15

- Agents started in a cuckcode that was itself launched from a Claude Code session no longer inherit that session's markers, which turned off transcript saving and could deny their shell commands.

## 1.40.0 — 2026-11-15

- A section alone in its group no longer spends a row on a tab bar: a thin strip stays, and hovering it shows the tab to drag. Stack another section there and the tab bar comes back.

## 1.39.0 — 2026-11-15

- Closing a project (⇧⌘W), resetting settings or the layout, and removing a plugin now ask in cuckcode's own dialog instead of a macOS sheet. Esc cancels, Return confirms.

## 1.38.1 — 2026-11-15

- Error notes (a failed sync or push) fade on their own after 30 seconds instead of staying until clicked, and every note has a close button.

## 1.38.0 — 2026-11-15

- Plugins installed from a git URL are part of your config file, so Export…/Import… and the config repo carry them. A plugin added on another machine is cloned and loaded at the next launch here.
- At launch, plugins load after the config sync, so they're always the newest your config knows of.
- Installing a plugin whose clone is already in the plugins folder reuses it. Plugins installed before this version sync once you install their URL again.

## 1.37.0 — 2026-11-14

- cuckcode follows your system's light or dark appearance by default, and is dark when it can't tell. Settings has a Theme menu (Auto, Dark or Light) in place of the Dark mode checkbox.

## 1.36.0 — 2026-11-14

- Each project reopens on the agent it had in front when you quit, instead of always the first one.
- The scratchpad travels with your config: Export… and the config repo carry it, and Import… or a sync brings it in.

## 1.35.5 — 2026-11-14

- The usage meters in the Agents title bar use the whole bar: when they don't all fit, they fill the room up to the agent picker and clip at the edge instead of leaving a gap.

## 1.35.4 — 2026-11-14

- The Claude usage meter shows your usage credits again when there's a per-model weekly limit too: per-model limits now give way first in a narrow pane.

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
