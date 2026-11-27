// The plugin contract. A plugin is a folder holding cuckcode-plugin.json (a PluginManifest) and
// the bundles it names. Settings › Plugins lists the folders; changes apply on relaunch.
//
// Bundles are CommonJS, one file each, exporting `activate(host)`:
// - main: runs in the main process with Node's require. Never block it: async fs and execFile only.
// - renderer: evaluated with a require that resolves only the host's own modules (HOST_MODULES),
//   so there is one React and one Monaco. Bundle everything else in.
// - style: a stylesheet added to the page. The host's colors are CSS variables (--bg, --panel,
//   --line, --fg, --muted, --accent, --add, --del, --mod, --new); light and dark switch them.
// When the folder's package.json has a build script, cuckcode runs `npm install` (when the
// lockfile changed, or it never ran) and `npm run build` there before loading, whenever src/ is newer than the bundles.
import type * as Monaco from 'monaco-editor/editor/editor.api'
import type { ComponentType, ReactNode } from 'react'
import type { AgentPreset } from './agents'
import type { Agent, AgentRequest, GitResult, RepoStatus, RunExit, Section } from './types'

export const MANIFEST = 'cuckcode-plugin.json'

// The folder a plugin installed from url gets: git@host:me/cuckcode-thing.git -> cuckcode-thing
export const folderName = (url: string): string =>
  url.trim().replace(/\/+$/, '').replace(/\.git$/, '').split(/[/:]/).pop()?.replace(/[^\w.-]/g, '-') ?? ''

export const HOST_MODULES = ['react', 'react/jsx-runtime', 'react-dom', 'monaco-editor/editor/editor.api'] as const

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
  commands: PluginCommand[]
  renderer: string | null // the bundle's code
  style: string | null
}

export interface MainHost {
  // A function the renderer side calls with invoke(name, ...args).
  handle: (name: string, fn: (...args: never[]) => unknown) => void
  // Hands other plugins (activated later) an API; they get it with use(id).
  provide: (api: unknown) => void
  use: <T>(id: string) => T | undefined
  // The environment cuckcode's terminals get, for running tools.
  shellEnv: () => Record<string, string>
}

export interface MainPlugin {
  activate: (host: MainHost) => void | Promise<void>
}

// Per-project data a plugin keeps, such as an index of the project. null: nothing for this project.
export interface ProjectSource<T> {
  load: (root: string) => Promise<T | null>
  // Whether these changed paths (project-relative; null: unknown) could change the data.
  // Without it every change reloads. A project with null data is rechecked only when its tab is next opened.
  relevant?: (paths: string[] | null) => boolean
}

export interface ViewProps<T> {
  data: T
  root: string | null // the open project's folder; null on the home screen
  openFile: (abs: string, line: number) => void
  close: () => void // hides this view, or closes this panel
}

// When a view or panel is offered (its header button, its command, show()). By default: while a
// project is open and has data for the plugin, or always with a project open if the plugin keeps
// none. `when` decides instead, from the plugin's data for the open project and the project's
// folder, both null on the home screen. Panels live in the workspace, so they're never offered
// there. A view or panel with `when` can be offered without data, so its render gets T | null.
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
  // A URL the page can load for a file on disk (images, video).
  mediaUrl: (abs: string) => string
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

export interface RendererHost<T = unknown> {
  monaco: typeof Monaco
  invoke: <R>(name: string, ...args: unknown[]) => Promise<R>
  provide: (api: unknown) => void
  use: <A>(id: string) => A | undefined
  // Token colors added to cuckcode's light and dark editor themes.
  addThemeRules: (light: Monaco.editor.ITokenThemeRule[], dark: Monaco.editor.ITokenThemeRule[]) => void
  projectData: (source: ProjectSource<T>) => void
  // Registering a command's view again replaces it.
  view: {
    (view: PluginView<T | null> & { when: When<T> }): void
    (view: PluginView<T>): void
  }
  panel: {
    (panel: PluginPanel<T | null> & { when: When<T> }): void
    (panel: PluginPanel<T>): void
  }
  // Opens the view or panel for this command, as its button would, but never toggles it closed.
  // false when it isn't offered right now (see When).
  show: (command: string) => boolean
  // Hides the view or closes the panel for this command, if it's showing.
  hide: (command: string) => void
  // A note in the corner, titled with the plugin's name. A failure (ok false) stays up longer.
  toast: (text: string, opts?: { ok?: boolean }) => void
  onCommand: (id: string, fn: () => void) => void
  // Called for each code editor, now and later; the disposable runs when it goes.
  onEditor: (fn: (editor: Monaco.editor.ICodeEditor, ctx: EditorContext<T>) => Monaco.IDisposable | void) => void
  // Types text into the agent that takes playground answers (the one in front, else the first), as
  // if typed there: closes the view, shows the agent (starting it if needed), pastes, and presses
  // Enter unless submit is false. Resolves false when there's no such agent or it didn't start.
  // With stay, the screen and keyboard focus stay as they are: the view stays open and the agent
  // isn't shown or brought to the front, though it's still started if needed. Nothing tells the
  // plugin what the text lands on (half-typed input, or a dialog the agent is showing, which
  // the Enter would answer), so toast what it sent. A prompt an agent's hook sends through
  // $CUCKCODE_HOOK is answered with answerAgent instead, never typed.
  sendToAgent: (text: string, opts?: { submit?: boolean; stay?: boolean }) => Promise<boolean>
  // An agent's hook, run through $CUCKCODE_HOOK (the Claude Code preset's PermissionRequest and
  // PreToolUse on AskUserQuestion), waiting for an answer. payload is the hook's input as the
  // agent sent it; cuckcode doesn't read it. Every subscribed plugin hears each request; the
  // agent waits (its terminal shows no dialog) until one answers, or 5 minutes pass. With no
  // plugin subscribed, the agent asks in its terminal at once. A plugin that won't show a
  // request should answer it null straight away. Returns the unsubscribe.
  onAgentRequest: (fn: (request: AgentRequest) => void) => () => void
  // Answers request id: output becomes the hook's stdout (a string as is, anything else as JSON),
  // and null lets the agent ask in its terminal as usual. Resolves false, and sends nothing,
  // when id is no longer pending (another plugin answered, it timed out, the agent stopped):
  // a late click can't answer the next prompt.
  answerAgent: (id: string, output: unknown | null) => Promise<boolean>
  // Called with the id of each request that ended, however it ended. Returns the unsubscribe.
  onAgentRequestEnd: (fn: (id: string) => void) => () => void
  // A URL the page can load for a file on disk (images, video).
  mediaUrl: (abs: string) => string
  // An agent to start from in Settings › Agents › Add, beside the built-in ones.
  agentPreset: (preset: AgentPreset) => void
  agentBar: (item: AgentBarItem) => void
  // cuckcode's scratchpad, for a view to show (it covers the Scratch section): the same notes,
  // kept in step as they're typed, saved the same way. actions go at the right of its title bar.
  Scratch: ComponentType<{ actions?: ReactNode }>
  // A playground slot of the open project, for a view (or panel) to show: the same page, kit,
  // answers and live reload as ⌥⌘<slot>, with no ✕ (put your own in actions). Its Done sends the
  // agent the same "I'm done in …" as the full-window one does, but with stay (see sendToAgent),
  // then calls onDone, so the view can switch back to what it was showing. Nothing else on screen
  // changes. While it's showing, its slot's header dot stays out. On the home screen it says to
  // open a project.
  Playground: ComponentType<PlaygroundProps>
  Run: ComponentType<RunProps>
  git: PluginGit
  // Called when a playground slot's page in the open project changes (an agent wrote or touched
  // it): what lights the slot's dot in the header, though this fires even while the page is
  // showing. A page already there when the project opens doesn't count. Returns the unsubscribe.
  onPlayground: (fn: (slot: number, project: string) => void) => () => void
}

export interface RendererPlugin {
  activate: (host: RendererHost) => void | Promise<void>
}
