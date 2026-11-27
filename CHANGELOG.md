# Changelog

Every change to the app bumps the version here and in `package.json` (see Versioning in the README). The newest version comes first. The app shows the newest section's lines when it launches on a new version.

## 1.58.0 — 2026-11-27

- ✨ Plugins can have a project's agent do a job in the background (`runAgent`), with nothing on screen, and show the answer, its tokens and cost themselves. What such a run may do is set by the project, in a profile under `.claude/profiles/`, never by the plugin. A run is one-shot with no session kept, or a thread that a later run continues. The command it runs is in Settings › Agents (Run command), and defaults to a headless Claude Code.

## 1.57.0 — 2026-11-27

- ✨ A plugin's views and panels open from any project tab, and from the welcome screen, for the project they're made for (the plugin's home). With several, the button asks which. Everything the page does belongs to that project, including what it sends to an agent: it goes to that project's agent, never to the one in the tab you're in. The button and a panel's tab show which project it's for, and a panel opened this way stays with its project across tabs and relaunches. A home that isn't open opens in the background, off the tab bar.
- Plugins can send text to a chosen project's agent (`sendToAgent` with `project`).

## 1.56.3 — 2026-11-27

- 🐛 Installing a plugin's dependencies no longer changes its files, which stopped it from updating ("it has local changes") when its lockfile didn't match its package.json. Such a plugin still installs and loads, and the Plugins page says its lockfile is out of date.

## 1.56.2 — 2026-11-26

- 🐛 A plugin can answer an agent in a project whose folder name has accented or other non-ASCII letters: such a request no longer, now and then, went straight back to the terminal.

## 1.56.1 — 2026-11-26

- 🐛 A plugin can now answer what an agent is waiting on: the request no longer ends the moment it arrives, sending the prompt back to the terminal. It ends when a plugin answers, after 5 minutes, or when the agent stops.

## 1.56.0 — 2026-11-26

- ✨ A plugin can show what an agent is waiting on and answer it, instead of typing into its terminal: with the Claude Code preset, a permission prompt, a plan to approve, or a question with its options. An answer to a prompt that already ended goes nowhere, so a late click can't answer the next one. With no such plugin, or no answer within 5 minutes, Claude asks in its terminal as before.
- An agent added from the Claude Code preset before this version keeps its old command: add it again from the preset (or copy the preset's command) to get the new hooks.

## 1.55.1 — 2026-11-26

- 🐛 Done on a playground page saves what a block showed as already chosen when you left it as it was: a form's defaults, a plan, checklist or board as written, tune's starting values. An answer you already gave is kept.

## 1.55.0 — 2026-11-26

- ✨ A plugin can run a command in a terminal inside its own view, with one click: output stays in that terminal, never reaches an agent, and ✕ stops it. A script can be pinned to what you were shown: if it changed since, it's refused and nothing runs.

## 1.54.0 — 2026-11-26

- ✨ A plugin whose view covers the workspace can run the git panel's commit, sync, pull and push on your repos, have your commit command draft a message to show you before committing, and see when a rebase or merge is stuck.
- ✨ A plugin's view can show a playground inside itself. Done there tells the agent without leaving the view, and the plugin hears when a playground page changes.

## 1.53.0 — 2026-11-26

- ✨ A plugin can send text to the agent and stay on screen (`sendToAgent` with `stay`): its view stays open and keeps the keyboard, and the agent gets the text without coming to the front, started first if it wasn't running.

## 1.52.3 — 2026-11-24

- 🐛 A plugin view, playground or README opened while a web page or Folders is up comes out from under it, instead of lighting its button and showing nothing.
- 🐛 A plugin panel opened with only the editor showing lands beside the editor, never in a minimized section's hidden group where nothing could bring it back.

## 1.52.2 — 2026-11-24

- 🐛 A section alone in its group no longer shows a stray "1 ⌄" overflow badge in its top right corner.

## 1.52.1 — 2026-11-24

- ✨ A section alone in its group shows a small grip at its top edge on hover instead of a whole tab bar. Hover the grip and the tab drops down as a chip to drag or minimize, and the content beside it stays clickable.

## 1.52.0 — 2026-11-24

- ✨ Plugins can open and close their own views and panels, decide when each is offered (views on the home screen too), leave out a header button, choose where a panel first docks, and show notes in the corner.
- 🐛 A plugin view that hits an error shows a note instead of blanking the window.

## 1.51.0 — 2026-11-24

- ✨ A plugin can have several full-window views, one per command, each with its own header button that toggles it on and off.

## 1.50.2 — 2026-11-24

- 🐛 media:// serves audio files (`.ogg`, `.opus`, `.mp3`, `.wav`, `.flac`, `.m4a`) with their audio types, so plugins can play them in `<audio>` reliably.

## 1.50.1 — 2026-11-23

- 🐛 An AI commit message whose subject starts with "Commit messages" isn't mistaken for the model talking about the task, and a `<message>` tag the model left open doesn't end up in the commit.

## 1.50.0 — 2026-11-23

- ✨ Plugins can add dockable panels: a tab in the workspace (beside Scratch at first, drag it anywhere) with its own header button and shortcut, for something to keep in view while you work, such as a status or activity monitor.

## 1.49.0 — 2026-11-21

- ✨ Plugins can show the scratchpad inside their full-window view (`Scratch` on the renderer host), since the view covers the Scratch section: the same notes, kept in step as you type.

## 1.48.2 — 2026-11-19

- 🐛 AI commit messages can't come out as the model thinking out loud or echoing its instructions: output that isn't a commit message gets one more try, then an error asking you to write it yourself.
- 🐛 A plugin whose upstream history was rewritten (force-pushed) catches up at launch or on Update, instead of staying behind for good, as long as your clone has no changes of its own.

## 1.48.1 — 2026-11-18

- 🐛 The tab bar can't empty while projects sit on the shelf: the last tab stays, closing it brings a shelved project back. An empty bar used to hide every terminal and silence the shelved agents' notifications.

## 1.48.0 — 2026-11-18

- ✨ The shelf: right-click a project tab › Move to Shelf to take it off the bar while it stays open. Shelved projects keep running and are still included in commit all and sync all; the shelf button next to + brings them back.

## 1.47.1 — 2026-11-16

- 🧹 A bug-check pass found nothing broken: only a stray style comment to tidy.

## 1.47.0 — 2026-11-16

- 🎨 Web pages share one globe button in the header, with a dropdown listing them by name, instead of a button each.

## 1.46.2 — 2026-11-16

- 🐛 The + (open project) button stays in view when the project tabs overflow, instead of scrolling off the end.

## 1.46.1 — 2026-11-16

- 🎨 The project in front gets an orange tab, so it's easy to spot among many.
- 🐛 The project tabs no longer show a scrollbar over them when they overflow, and switching projects by shortcut scrolls the active tab into view.

## 1.46.0 — 2026-11-16

- ✨ Plugins can hand the agent a task: `sendToAgent(text)` types it into the agent that takes playground answers, the same way a playground's Done does. They also get `mediaUrl` for showing images from disk in their views.

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
- Usage meters moved out of the core into a plugin. Plugins can now add agent presets and draw in the Agents title bar.
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
