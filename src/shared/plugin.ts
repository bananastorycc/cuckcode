// The plugin contract. A plugin is a folder holding cuckcode-plugin.json (a PluginManifest) and
// the bundles it names. Settings › Plugins lists the folders; changes apply on a reload. Plugins
// import it as cuckcode/plugin, the repo root's plugin.ts, which also has the types.ts parts it uses.
//
// Bundles are CommonJS, one file each, exporting `activate(host)` and, optionally, `deactivate()`:
// - main: runs in the main process with Node's require. Never block it: async fs and execFile only.
// - renderer: evaluated with a require that resolves only the host's own modules (HOST_MODULES),
//   so there is one React and one Monaco. Bundle everything else in.
// - style: a stylesheet added to the page, after cuckcode's own. The host's colors are CSS
//   variables, the stable ones --bg, --panel, --hover, --line, --fg, --muted, --accent, --add,
//   --del, --mod and --new: light mode's on :root, dark mode's on .dark (a class on <html>). A
//   theme sets them on :root:not(.dark), .dark, or :root for both.
// When the folder's package.json has a build script, cuckcode runs `npm install` (when the
// lockfile changed, or it never ran) and `npm run build` there before loading, whenever anything
// the build reads (src/, the manifest, package.json, the lockfile, build.*, tsconfig*.json, the
// installed dependencies) is newer than the bundles. examples/plugin is a plugin to start from.
//
// Reloading a plugin (the Plugins page, View › Reload Plugins) runs both sides' deactivate (5 s at
// most; a throw is reported, and the reload goes on), then disposes everything the plugin
// registered (each registration's Disposable) and its stylesheet, rebuilds it if it's stale, and
// evaluates its bundles again. The plugins that require it, and those that require them, reload
// with it, in dependency order. Agents' terminals, Run terminals and helper runs (runAgent) carry
// on: a new version hears a run again with onAgentRun(id). An agent request only the old version
// heard goes back to the agent's terminal. What the old version still calls afterwards gets
// nowhere: invoke and runAgent reject, sendToAgent resolves false, registrations do nothing.
// What the host can't see, deactivate undoes: timers, watchers, processes and servers the plugin
// started, and what it did through the raw monaco object (a provider's IDisposable; a language
// registered with monaco.languages.register stays until relaunch, as Monaco can't remove one).
// Only the bundles are read again: a module the main side required from node_modules stays
// cached until relaunch.
import type * as Monaco from 'monaco-editor/editor/editor.api'
import type { ComponentType, ReactNode } from 'react'
import type { AgentPreset } from './agents'
import type { Agent, AgentRequest, AgentRun, AgentRunEnd, GitResult, RepoStatus, RunExit, Section } from './types'

export const MANIFEST = 'cuckcode-plugin.json'

// The folder a plugin installed from url gets: git@host:me/cuckcode-thing.git -> cuckcode-thing
export const folderName = (url: string): string =>
  url.trim().replace(/\/+$/, '').replace(/\.git$/, '').split(/[/:]/).pop()?.replace(/[^\w.-]/g, '-') ?? ''

// What every registration returns, as onAgentRequest always has: the function that undoes it
// (once; calling it again does nothing). A plugin only needs it to undo something itself: a
// reload disposes whatever is left.
export type Disposable = () => void

export const HOST_MODULES = ['react', 'react/jsx-runtime', 'react-dom', 'monaco-editor/editor/editor.api'] as const

// The build: esbuild's options for each side's one CommonJS file, to spread into build() with
// entryPoints and outfile. The renderer's leaves HOST_MODULES to the host. A build.mjs imports them
// from cuckcode/plugin, at $CUCKCODE_PLUGIN_API when cuckcode runs the build.
export const BUILD = {
  main: { bundle: true, platform: 'node' as const, format: 'cjs' as const, target: 'node22' },
  renderer: { bundle: true, platform: 'browser' as const, format: 'cjs' as const, target: 'chrome130', jsx: 'automatic' as const, external: [...HOST_MODULES] as string[] }
}

// A plugin's own values, as JSON: one file per key in <userData>/plugin-data/<plugin id>/, written
// atomically (a crash leaves the old value whole), so both sides of a plugin share them, and they
// outlast reloads, relaunches and removing the plugin. A key is a plain name ([\w.-]+, not starting
// with a dot). Operations on one key run in the order they were called. After the plugin is
// unloaded, its old code's calls reject.
export interface PluginStore {
  get: <T>(key: string) => Promise<T | undefined> // undefined: never set, or deleted
  set: (key: string, value: unknown) => Promise<void> // rejects for a value JSON.stringify can't write (undefined, a function)
  delete: (key: string) => Promise<void>
}

export interface PluginManifest {
  id: string // [\w-]+, unique
  name: string
  requires?: string[] // plugin ids activated first; a missing one keeps this one from loading
  main?: string // bundle paths, relative to the folder
  renderer?: string
  style?: string
  // Menu items under View; each sends the command to the renderer's onCommand.
  commands?: PluginCommand[]
}

export interface PluginCommand {
  id: string
  title: string
  accelerator?: string // Electron syntax ('Cmd+Shift+S'); dropped (and reported) if it's taken
}

// How loading a configured folder went at launch.
export interface PluginStatus {
  path: string
  enabled: boolean
  id?: string
  name?: string
  error?: string
  note?: string // what the launch-time pull did, when it did something (or couldn't)
}

// A plugin's git clone.
export interface PluginInfo {
  remote: string | null // origin's URL; null: no remote, so nothing to update from
  commit: string // short sha
  subject: string
  date: number // unix seconds
  dirty: boolean // local changes (launch-time pulls skip it)
  behind: number | null // commits to pull; null until fetched, or with no upstream
  managed: boolean // cloned by cuckcode into its plugins folder
}

// A loaded plugin's renderer side, as main hands it over.
export interface LoadedPlugin {
  id: string
  name: string
  path: string // its folder
  requires: string[]
  commands: PluginCommand[]
  renderer: string | null // the bundle's code
  style: string | null
}

export interface MainHost {
  // A function the renderer side calls with invoke(name, ...args). Handling a name again replaces it.
  handle: (name: string, fn: (...args: never[]) => unknown) => Disposable
  // Hands other plugins (activated later) an API; they get it with use(id). A plugin that keeps
  // what use returned is reloaded whenever the one it requires is.
  provide: (api: unknown) => Disposable
  use: <T>(id: string) => T | undefined
  // The environment cuckcode's terminals get, for running tools. A plugin that runs git itself
  // should add GIT_OPTIONAL_LOCKS=0, as cuckcode does: without it git status rewrites .git/index,
  // which wakes the project's watcher, which refreshes git status, and so on.
  shellEnv: () => Record<string, string>
  store: PluginStore
}

export interface MainPlugin {
  activate: (host: MainHost) => void | Promise<void>
  // Before a reload: stop what the host can't see (timers, watchers, processes, servers).
  deactivate?: () => void | Promise<void>
}

// Per-project data a plugin keeps, such as an index of the project. null: nothing for this project.
// The projects load returns data for are the plugin's homes: its views and panels open for them
// from any tab (see When). cuckcode remembers them, and looks through the projects folder once for
// a plugin it has none remembered for, so load may run for a project that isn't open.
export interface ProjectSource<T> {
  load: (root: string) => Promise<T | null>
  // Whether these changed paths (project-relative; null: unknown) could change the data.
  // Without it every change reloads. A project with null data is rechecked only when its tab is next opened.
  relevant?: (paths: string[] | null) => boolean
}

export interface ViewProps<T> {
  data: T // the plugin's data for root
  // The folder of the project the page is for: the tab's own, or its home when it's shown away
  // from it (see When); null on the home screen. Pass it as sendToAgent's project.
  root: string | null
  openFile: (abs: string, line: number) => void // in root's project, switching to its tab when it isn't in front
  close: () => void // hides this view, or closes this panel
}

// When a view or panel is offered for a project (its header button, its command, show()). By
// default: while the project has data for the plugin, or always with a project open if the plugin
// keeps none. `when` decides instead, from the plugin's data for the project and the project's
// folder, both null on the home screen. Panels live in the workspace, so they're never offered
// for the home screen. A view or panel with `when` can be offered without data, so its render
// gets T | null.
//
// A page not offered for the tab in front still opens from it, for a home of the plugin's (a
// project its ProjectSource.load returned data for, and that `when` offers it for): the only one
// directly, else the button and command ask which, and show() takes the one opened last. From the
// home screen, the home opens as a tab. A home that isn't open opens in the background (shelved,
// off the tab bar). Everything the page gets is its home's: root, data, reloads on its changes,
// openFile, Playground, and sendToAgent's default. Its header button and a panel's tab say which
// project it's for. A panel opened away from home stays tied to that project, in every tab and
// across relaunches; one opened in its home follows the tab in front, as before.
export type When<T> = (data: T | null, root: string | null) => boolean

// Shows a view or a panel. A plugin can have several of each, one per command.
interface Shown<T> {
  command: string // one of the manifest's commands
  title: string
  icon: ReactNode
  button?: boolean // false: no header button; the command and show() still open it
  render: (props: ViewProps<T>) => ReactNode
}

// A full-workspace view, over everything but the header. Its button and command toggle it.
export type PluginView<T> = Shown<T>

// A dockable panel: a tab in the workspace, for something to keep in view while you work. It opens
// where dock says (by default a tab beside Scratch, or the first section showing of the ones that
// usually share a group with it); drag it anywhere after, like the sections. Its button and command
// open it, bring it to the front, or close it when it's showing; the tab's ✕ closes it too. Open
// panels are saved with the layout.
export interface PluginPanel<T> extends Shown<T> {
  id: string // [\w-]+, unique within the plugin
  // Where it first opens: a tab with that section, or split off to one side of it. When the
  // section is minimized, it opens in the default place instead.
  dock?: { section: Section; side?: 'tab' | 'left' | 'right' | 'above' | 'below' }
}

export interface EditorContext<T> {
  // This plugin's data for the open project.
  data: () => T | null
  openFile: (abs: string, line: number) => void
}

// The file the editor shows in the tab in front (RendererHost.activeFile).
export interface ActiveFile {
  path: string // absolute
  project: string // the tab's project
  // The editor's selection (Monaco's 1-based lines and columns; start = end is just the cursor)
  // and its text. null while the file isn't shown as text (an image, a binary file, still loading).
  selection: Monaco.IRange | null
  text: string
}

// An item a plugin adds to a right-click menu, below the host's own: 'files' for a file or folder
// in the file tree, 'editor' for the open file's title bar above the editor, 'git' for a changed
// file in the git panel. run gets that file's (or folder's) absolute path. when, if given, decides
// for each path whether the item shows. Items show in the order they were registered.
export interface MenuItem {
  where: 'files' | 'editor' | 'git'
  title: string
  run: (path: string) => void
  when?: (path: string) => boolean
}

// Drawn in the Agents section's title bar for the agent in front (a usage meter, a status).
// Renders null for agents it has nothing for; it decides that from the agent's settings.
export type AgentBarItem = ComponentType<{ agent: Agent }>

// git for a plugin whose view covers the workspace, and so the git panel. repo is an absolute
// folder: an open project or a folder in one, or a folder in the projects folder (Settings); any
// other is refused. Every op is the git panel's own: unsaved editors are saved first, one op per
// repo at a time (queued behind the panel's, a launch sync's, the others'), and a result
// (GitResult) to toast. A failing op leaves the repo as it was, as the panel's do.
export interface PluginGit {
  // What the git panel shows (branch, ahead, behind, the changed files; root '' when it isn't a
  // repo), plus midway: a rebase or merge git stopped in the middle of. Rejects for a folder out of reach.
  status: (repo: string) => Promise<RepoStatus>
  // The commit message the commit command (Settings › Git) writes for the changes, as ✨ would,
  // without committing anything: output is the message. ok false says why not (no commit
  // command set, nothing to commit, what the command printed), for the user to write one.
  draft: (repo: string) => Promise<GitResult>
  // The panel's Commit: stages every change (add -A), commits with message (show the user the
  // files and the message first: what's committed is what's there now), and syncs when the
  // repo has a remote.
  commit: (repo: string, message: string) => Promise<GitResult>
  // pull --rebase --autostash, then push. A pull that conflicts is backed out.
  sync: (repo: string) => Promise<GitResult>
  pull: (repo: string) => Promise<GitResult>
  push: (repo: string) => Promise<GitResult>
}

export interface PlaygroundProps {
  slot: number // from 1, as in Settings › Playgrounds
  // After Done has told the agent; sent is false when no agent took it (the user got a toast saying why).
  onDone?: (sent: boolean) => void
  actions?: ReactNode // at the right of its title bar
}

// One command in a terminal of its own, drawn where the plugin renders it: for a plugin that runs
// a script the user has just read, with one click. It isn't the Terminal section's shell and
// nothing in it reaches an agent: its output goes only to this terminal. Keys typed in it go to
// the command (to answer its prompts); its ✕ stops it.
export interface RunProps {
  // Names the run within the plugin ([\w-]+). The command runs once, when a Run with a new id
  // first mounts. Rendering that id again (the view reopened, the panel moved, another project's
  // tab) shows the same run, still running or ended, whatever the other props say then. Nothing
  // reruns it, not even a key pressed after it ends: running again takes a new id (a new click).
  // A run that's still going when its Run unmounts carries on; quitting stops it.
  id: string
  // Where it runs: as for git, an open project or a folder in one, or a folder in the projects
  // folder (Settings); any other is refused.
  cwd: string
  // The program and its arguments, as is: no shell reads them, so nothing needs quoting. It runs
  // with the login shell's environment, as the terminals do (so the user's PATH finds it), and
  // none of the CUCKCODE_* variables agents get.
  argv: string[]
  // Runs a script only if it's still what the user was shown. path is absolute, and one of argv's
  // arguments, as a shell takes a script: ['bash', path, ...args]. cuckcode reads the file once,
  // checks its sha256 (hex), and runs exactly those bytes, as `bash -c <bytes> <path> ...args`
  // ($0 is still the path; BASH_SOURCE is empty), so a change made after the check can't run.
  // A changed file is refused ("file changed since shown"), as is a missing or binary one: nothing runs.
  // Only shells take a script this way: sh, bash, zsh.
  pin?: { path: string; sha256: string }
  title?: string // in its title bar; by default the command
  // When the run ends, or is refused (refused says why, and the terminal shows it). Called again
  // when a Run for a run that already ended mounts, so a view reopened later still hears how it went.
  onExit?: (exit: RunExit) => void
  actions?: ReactNode // at the right of its title bar, before the ✕
}

// What a helper run sends while it runs (RendererHost.onAgentRun).
export interface AgentRunHandlers {
  // Each line the command printed: parsed when it's a JSON object (as Claude Code's stream-json
  // lines are), else the text.
  output?: (line: unknown) => void
  end?: (end: AgentRunEnd) => void
}

// What throws in a plugin's renderer side (a page or agent bar item, a hook or handler given to the
// host, a load or when, activate) or a registration the host refuses is the plugin's error: a
// toast, and the plugin's last errors on the Plugins page.
export interface RendererHost<T = unknown> {
  // The host's Monaco, which every editor uses. A plugin may add languages (monaco.languages.register
  // plus a Monarch tokenizer, colored with addThemeRules) and providers: on-demand ones (hover,
  // definition) and completion or snippet ones, which run as you type, at the plugin's cost. No
  // workers and no language services.
  monaco: typeof Monaco
  // Calls a function the main side handles; rejects with what it threw, as its own message.
  invoke: <R>(name: string, ...args: unknown[]) => Promise<R>
  provide: (api: unknown) => Disposable
  use: <A>(id: string) => A | undefined
  // Token colors added to cuckcode's light and dark editor themes.
  addThemeRules: (light: Monaco.editor.ITokenThemeRule[], dark: Monaco.editor.ITokenThemeRule[]) => Disposable
  // Registering it again replaces it.
  projectData: (source: ProjectSource<T>) => Disposable
  // Registering a command's view again replaces it.
  view: {
    (view: PluginView<T | null> & { when: When<T> }): Disposable
    (view: PluginView<T>): Disposable
  }
  panel: {
    (panel: PluginPanel<T | null> & { when: When<T> }): Disposable
    (panel: PluginPanel<T>): Disposable
  }
  // Opens the view or panel for this command, as its button would, but never toggles it closed and
  // never asks: away from home it opens for the home opened last. false when it isn't offered
  // right now (see When).
  show: (command: string) => boolean
  // Hides the view or closes the panel for this command, if it's showing.
  hide: (command: string) => void
  // A note in the corner, titled with the plugin's name. A failure (ok false) stays up longer.
  toast: (text: string, opts?: { ok?: boolean }) => void
  // Registering a command again replaces its handler.
  onCommand: (id: string, fn: () => void) => Disposable
  // Called for each code editor, now and later; the disposable fn returns runs when the editor
  // goes, or when this registration is disposed.
  onEditor: (fn: (editor: Monaco.editor.ICodeEditor, ctx: EditorContext<T>) => Monaco.IDisposable | void) => Disposable
  // Types text into a project's agent that takes playground answers (the one in front there, else
  // the first), as if typed there: closes the view, shows the agent (starting it if needed, and
  // switching to its project's tab), pastes, and presses Enter unless submit is false. Resolves
  // false when there's no such agent or it didn't start.
  // The project: project, an open project or a folder in the projects folder (one that isn't open
  // opens in the background; any other is refused). Without it: the project of this plugin's pages
  // on screen (its view over the workspace, else its panels in front in the dock, an untied one
  // being the tab in front's), so a page away from home never types into the tab's own agent;
  // otherwise the tab in front. When its panels show for different projects nothing is sent (it
  // resolves false, and the user is told). A page should pass its root; code running outside a
  // page (looping over projects) names each.
  // With stay, the screen and keyboard focus stay as they are: the view stays open and the agent
  // isn't shown or brought to the front, though it's still started if needed. Nothing tells the
  // plugin what the text lands on (half-typed input, or a dialog the agent is showing, which
  // the Enter would answer), so toast what it sent. A prompt an agent's hook sends through
  // $CUCKCODE_HOOK is answered with answerAgent instead, never typed.
  sendToAgent: (text: string, opts?: { submit?: boolean; stay?: boolean; project?: string }) => Promise<boolean>
  // An agent's hook, run through $CUCKCODE_HOOK (the Claude Code preset's PermissionRequest and
  // PreToolUse on AskUserQuestion), waiting for an answer. payload is the hook's input as the
  // agent sent it; cuckcode doesn't read it. Every subscribed plugin hears each request; the
  // agent waits (its terminal shows no dialog) until one answers, or 5 minutes pass. With no
  // plugin subscribed, the agent asks in its terminal at once. A plugin that won't show a
  // request should answer it null straight away.
  onAgentRequest: (fn: (request: AgentRequest) => void) => Disposable
  // Answers request id: output becomes the hook's stdout (a string as is, anything else as JSON),
  // and null lets the agent ask in its terminal as usual. Resolves false, and sends nothing,
  // when id is no longer pending (another plugin answered, it timed out, the agent stopped):
  // a late click can't answer the next prompt.
  answerAgent: (id: string, output: unknown | null) => Promise<boolean>
  // Called with the id of each request that ended, however it ended.
  onAgentRequestEnd: (fn: (id: string) => void) => Disposable
  // A helper run: the project's agent, headless, on one prompt, with nothing on screen. It runs
  // the run command (Settings › Agents; by default Claude Code's `claude -p` with stream-json)
  // under sh in project, with the login shell's PATH as cuckcode has it and none of the agents'
  // CUCKCODE_* variables, and the prompt on stdin. Resolves to the run's id; rejects, and runs
  // nothing, with why not.
  //
  // What the run may do comes from the project, never the plugin: profile names a file the
  // project keeps, <project>/.claude/profiles/<profile>.json, a JSON object (for Claude Code, a
  // settings file: model, permissions, env). A plugin can't pass tools, models or flags. The
  // name is plain ([\w-]+); a missing profile, a symlink anywhere on the way to it, or one that
  // isn't a JSON object is refused. The command gets its text in $CUCKCODE_RUN_PROFILE (what was
  // checked, so a later change can't slip in) and its path in $CUCKCODE_RUN_PROFILE_PATH.
  //
  // project is a project itself: an open project, or a folder right in the projects folder
  // (Settings); any other is refused. Three kinds of run, each one of these set for the command:
  // - plain (neither thread nor resume): one-shot, no session kept. $CUCKCODE_RUN_PLAIN=1.
  // - thread: true starts a session that's kept; the end's session is its id. $CUCKCODE_RUN_THREAD=1.
  // - resume: <id> continues that session (thread is implied); the end's session is the id again.
  //   $CUCKCODE_RUN_RESUME=<id>.
  // timeout is in seconds: 600 by default, 3600 at most; then the run is stopped. At most 6
  // runs go at once (another is refused), and quitting stops them all.
  runAgent: (run: AgentRun) => Promise<string>
  // Hears run id (one of this plugin's): everything it sent so far first, then the rest as it
  // comes, ending with end. The end has the exit code (null when stopped, with stopped saying
  // why), and from the last {"type":"result"} line the command printed (as Claude Code's
  // stream-json ends): result, usage (its token counts as the agent names them), cost
  // (total_cost_usd) and, for thread and resume runs, session (its session_id). error says what
  // went wrong: the result line's is_error, a timeout, or the command's stderr on a failing exit.
  // An ended run is kept for a while, so a page reopened later (or the plugin, reloaded) still
  // hears how it went.
  onAgentRun: (id: string, on: AgentRunHandlers) => Disposable
  // Stops run id (SIGTERM to it and what it started, SIGKILL 3 s later); its end still arrives.
  stopAgentRun: (id: string) => void
  // A URL the page can load for a file on disk (images, video).
  mediaUrl: (abs: string) => string
  // The project of the tab in front (its folder), or null on the home screen.
  activeProject: () => string | null
  // Called with the tab in front's project each time it changes (null: the home screen).
  onProjectSwitched: (fn: (project: string | null) => void) => Disposable
  // The working file the editor shows in the tab in front, with its selection; null when it shows
  // none, or a past commit's version of one.
  activeFile: () => ActiveFile | null
  // Called with a file's absolute path each time the editor writes it to disk (⌘S, leaving a file
  // with edits, a commit or a prompt saving first). Not for changes made outside the editor.
  onFileSaved: (fn: (path: string) => void) => Disposable
  contextMenu: (item: MenuItem) => Disposable
  store: PluginStore
  // An agent to start from in Settings › Agents › Add, beside the built-in ones.
  agentPreset: (preset: AgentPreset) => Disposable
  agentBar: (item: AgentBarItem) => Disposable
  // cuckcode's scratchpad, for a view to show (it covers the Scratch section): the same notes,
  // kept in step as they're typed, saved the same way. actions go at the right of its title bar.
  Scratch: ComponentType<{ actions?: ReactNode }>
  // A playground slot of the project the view (or panel) is for (its root), for it to show: the same
  // page, kit, answers and live reload as ⌥⌘<slot>, with no ✕ (put your own in actions). Its Done
  // sends that project's agent the same "I'm done in …" as the full-window one does, but with stay (see sendToAgent),
  // then calls onDone, so the view can switch back to what it was showing. Nothing else on screen
  // changes. While it's showing, its slot's header dot stays out. On the home screen it says to
  // open a project.
  Playground: ComponentType<PlaygroundProps>
  Run: ComponentType<RunProps>
  git: PluginGit
  // Called when a playground slot's page changes (an agent wrote or touched it), in the tab in
  // front's project or in one a page away from home is showing: what lights the slot's dot in the
  // header, though this fires even while the page is showing. A page already there when the
  // project opens doesn't count.
  onPlayground: (fn: (slot: number, project: string) => void) => Disposable
}

export interface RendererPlugin {
  activate: (host: RendererHost) => void | Promise<void>
  // Before a reload, and before the main side's: undo what the host can't see (see the top).
  deactivate?: () => void | Promise<void>
}
