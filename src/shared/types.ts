// Contract between main, preload and renderer. Paths in ChangedFile are repo-root relative.
import type { LoadedPlugin, PluginInfo, PluginStatus } from './plugin'

export type Theme = 'light' | 'dark'
// What Settings stores: auto follows the system, dark when it can't tell.
export type ThemeChoice = 'auto' | Theme

// The workspace's sections, each a tab in the dock (the renderer's layout.ts arranges them).
export const SECTIONS = ['files', 'search', 'editor', 'terminal', 'agents', 'git', 'scratch'] as const
export type Section = (typeof SECTIONS)[number]

export type ChangeCode = 'M' | 'A' | 'D' | 'R' | '?'

export interface ChangedFile {
  path: string
  code: ChangeCode
  from?: string // original path of a rename
  commit?: string // set for a file as a past commit changed it (vs its first parent), not the working tree
}

export interface GitStatus {
  root: string // absolute repo root ('' when not a repo)
  head: string // HEAD's sha ('' before the first commit)
  branch: string
  ahead: number
  behind: number
  files: ChangedFile[]
}

// text: head/work are file contents. media: head/work are media:// URLs. null = absent on that side.
export interface FileSnapshot {
  kind: 'text' | 'image' | 'video' | 'binary'
  head: string | null
  work: string | null
}

export interface Commit {
  sha: string
  subject: string
  author: string
  date: number // unix seconds
}

// switch takes a branch name (a remote-only one gets a tracking branch); branch creates one from HEAD.
// aicommit is commit with a message the configured commit command writes from the changes.
export type GitOp = 'commit' | 'aicommit' | 'pull' | 'push' | 'sync' | 'switch' | 'branch'

export interface GitResult {
  ok: boolean
  output: string
}

// One command a plugin runs in a terminal of its own (RendererHost.Run).
export interface RunSpec {
  cwd: string
  argv: string[]
  pin?: { path: string; sha256: string }
}

// How a run ended. code is null when it was stopped (✕, a signal) or never started; refused says
// why it never started.
export interface RunExit {
  code: number | null
  refused?: string
}

// A helper run a plugin starts (RendererHost.runAgent): the project's agent, headless, on one prompt.
export interface AgentRun {
  project: string
  prompt: string
  profile: string // a profile's name: <project>/.claude/profiles/<name>.json
  thread?: boolean // keep the session, to resume
  resume?: string // a session id an earlier thread or resume run ended with
  timeout?: number // seconds
}

// How a run ended. code is null when it was stopped, timed out or never really started (error
// says why). The rest comes from the last result line the command printed, when it printed one.
export interface AgentRunEnd {
  code: number | null
  stopped?: 'stop' | 'timeout'
  session?: string // thread and resume runs: the id to resume
  result?: string // the agent's final answer
  usage?: Record<string, number> // token counts, named as the agent names them
  cost?: number // USD, where the agent says
  error?: string
}

// What main sends for a run, numbered from 0 so a page catching up never sees one twice.
export type AgentRunEvent = { seq: number; lines: unknown[] } | { seq: number; end: AgentRunEnd }

// An agent's hook waiting for a plugin to answer it (RendererHost.onAgentRequest). session is the
// agent's PTY key, `${agent}:${project}`; payload is what the hook got on stdin, parsed when it's
// JSON (as Claude Code's is), else the text.
export interface AgentRequest {
  id: string
  session: string
  agent: string // the agent's id in Settings › Agents
  project: string
  payload: unknown
}

// A rebase or merge git stopped in the middle of (a conflict to resolve), or null.
export type Midway = 'rebase' | 'merge' | null

export interface RepoStatus extends GitStatus {
  midway: Midway
}

// The ops a plugin runs (RendererHost.git). draft writes a message without committing.
export type PluginGitOp = 'draft' | 'commit' | 'sync' | 'push' | 'pull'

export interface Remote {
  name: string
  url: string
}

// Most recently committed first. remote holds names that exist only on a remote.
export interface Branches {
  local: string[]
  remote: string[]
  remotes: Remote[]
}

export interface SearchQuery {
  text: string
  regex: boolean
  caseSensitive: boolean
  word: boolean
}

// line is 1-based; ranges are [start, end) offsets into text, a preview window of the line.
export interface SearchMatch {
  line: number
  col: number // 1-based column of the first match in the full line
  text: string
  ranges: [number, number][]
}

export interface SearchResult {
  files: { path: string; matches: SearchMatch[] }[]
  truncated: boolean
  error?: string
}

// A PTY id is `${agent id}:${project path}`; `shell` is the bottom pane, never an agent's id.
export const SHELL_ID = 'shell'

// An agent tab: any command, run by the login shell, and what cuckcode does with it. Every agent
// gets $CUCKCODE_NOTIFY (a script its hooks can run to notify) and, with playground on,
// $CUCKCODE_PLAYGROUND (the playground prompt); the command passes them on however its tool takes them.
export interface Agent {
  id: string
  name: string
  command: string
  notify: boolean // a bell or OSC 9/777 lights up the tab and sends a notification
  awake: boolean // its output keeps the Mac from idle-sleeping
  mentions: boolean // dropped files and Send Selection go in as @path#L1-2 (else a quoted path)
  newline: boolean // ⇧↩ sends ESC+CR (a newline without submitting)
  playground: boolean // gets $CUCKCODE_PLAYGROUND, and is told when a playground page is done
}

// A full-window web page on ⌃⌘1–0.
export interface WebPage {
  name: string
  url: string
}

// A playground slot on ⌥⌘1–0: .cuckcode/playground/<n>/ in each project, n from 1.
export interface PlaygroundSlot {
  name: string
}

export interface PluginRef {
  path: string // the plugin's folder (holds cuckcode-plugin.json)
  url?: string // the git URL it was installed from; only these travel in the config file
  enabled: boolean
}

// What the Settings screen edits.
export interface Config {
  projectsDir: string // where ⌘T opens from and new clones go; '' until chosen
  notifications: boolean // a macOS notification when an agent with notify on is done or needs input
  // Writes AI commit messages: run by sh with the changes on stdin, the instructions in
  // $CUCKCODE_COMMIT_PROMPT; prints the message. '' hides the AI buttons.
  commitCommand: string
  // Runs plugins' helper runs (RendererHost.runAgent): run by sh in the project, the prompt on
  // stdin, the profile and the kind of run in $CUCKCODE_RUN_*; prints JSON lines. '' turns them off.
  agentRunCommand: string
  confirmAllRepos: boolean // AI commit all / sync all ask first
  readme: boolean
  folders: { enabled: boolean; dirs: string[] }
  playgrounds: PlaygroundSlot[]
  webPages: WebPage[]
  agents: Agent[] // in the agent dropdown's order; the first is each project's default
  plugins: PluginRef[]
  configRepo: string // a git remote the config file syncs through; '' = off
}

export const MAX_SLOTS = 10

export interface Settings extends Config {
  projects: string[]
  // Open projects kept off the tab bar: still running, committed and synced with the rest.
  shelved: string[]
  // The tab in front at quit; it reopens in front regardless of tab order.
  active: string | null
  theme: ThemeChoice
  // Per project path: the file (repo-root relative) in front at quit.
  files: Record<string, string>
  // Per project path: the agent id in front at quit; it reopens in front.
  agent: Record<string, string>
  // Projects opened before, most recently opened or closed first; the empty screen lists them.
  recent: string[]
  // The window's last size and place. Main keeps it; the renderer never sends it.
  window?: Bounds
  // The workspace's dock layout as last left (dockview's JSON; the renderer validates it),
  // and the layouts saved by name.
  layout: unknown
  layouts: SavedLayout[]
  // Per plugin id: the projects its ProjectSource.load last returned data for (its homes), most
  // recently opened first. No entry: the projects folder hasn't been looked through for it yet.
  pluginHomes: Record<string, string[]>
}

export interface SavedLayout {
  name: string
  layout: unknown
}

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

// One item of a browsed folder: a subfolder, or an image/video. mtime in ms.
export interface BrowseEntry {
  name: string
  dir: boolean
  mtime: number
  size: number
}

// The config repo's last sync. at: ms.
export interface SyncStatus {
  state: 'off' | 'syncing' | 'ok' | 'error'
  message: string
  at: number
}

export type MenuCommand =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'closeFile' }
  | { type: 'newFile' }
  | { type: 'quickOpen' }
  | { type: 'sendSelection' }
  | { type: 'tab'; index: number }
  | { type: 'search' }
  | { type: 'pane'; dir: PaneDir }
  | { type: 'cycle'; step: 1 | -1 }
  | { type: 'playground'; slot: number }
  | { type: 'readme' }
  | { type: 'web'; index: number }
  | { type: 'folders' }
  | { type: 'settings' }
  | { type: 'plugins' }
  | { type: 'reloadPlugins' }
  | { type: 'plugin'; plugin: string; command: string }

export type PaneDir = 'left' | 'right' | 'up' | 'down'

export interface Api {
  init: () => Promise<Settings>
  save: (settings: Settings) => void
  // A fresh install's settings.
  defaults: () => Promise<Settings>
  // A folder from the open dialog, or null.
  pickFolder: () => Promise<string | null>
  // The folders in dir, the projects folder (absolute paths).
  repos: (dir: string) => Promise<string[]>
  // Clones remote into dir/name, or, when it's empty, inits there and pushes a first commit
  // to main. Resolves to the new folder; rejects with git's error.
  setUpRepo: (dir: string, remote: string, name: string) => Promise<string>
  focus: () => void
  watch: (projects: string[]) => void

  ptyStart: (id: string, cols: number, rows: number) => Promise<string>
  ptyRestart: (id: string, cols: number, rows: number) => Promise<void>
  ptyWrite: (id: string, data: string) => void
  ptyResize: (id: string, cols: number, rows: number) => void
  ptyKill: (id: string) => void
  // A plugin's run (id `run.<plugin>.<name>`): starts it once, or reattaches to it, running or
  // ended. exit is set when it has ended (or was refused); then nothing more arrives.
  runStart: (id: string, spec: RunSpec, cols: number, rows: number) => Promise<{ replay: string; exit?: RunExit }>
  // Stops a run; its exit still arrives (code null).
  runStop: (id: string) => void
  // Whether a plugin took an agent request (see agentrequest.ts); then its answer, null for
  // the terminal. False when the request is no longer pending.
  agentTaken: (id: string, taken: boolean) => void
  agentAnswer: (id: string, output: unknown) => Promise<boolean>
  // A plugin's helper runs (RendererHost.runAgent). Run ids are `<plugin>.<uuid>`; a plugin only
  // reaches its own. events: what was sent so far, for a page that starts listening late.
  agentRunStart: (plugin: string, run: AgentRun) => Promise<{ id: string } | { refused: string }>
  agentRunEvents: (plugin: string, id: string) => Promise<AgentRunEvent[]>
  agentRunStop: (plugin: string, id: string) => void

  status: (cwd: string) => Promise<GitStatus>
  files: (root: string) => Promise<string[]>
  snapshot: (root: string, file: ChangedFile) => Promise<FileSnapshot>
  branches: (cwd: string) => Promise<Branches>
  // A page of HEAD's history, newest first, starting skip commits back.
  log: (cwd: string, skip: number) => Promise<Commit[]>
  commitFiles: (root: string, sha: string) => Promise<ChangedFile[]>
  // arg: the commit message, or the branch name for switch/branch.
  git: (cwd: string, op: GitOp, arg?: string) => Promise<GitResult>
  // Puts a changed file back as HEAD has it (new files go to the Trash). The caller confirms first.
  discard: (root: string, file: ChangedFile) => Promise<GitResult>
  // Points a remote at url, adding it if the repo doesn't have it yet.
  setRemote: (cwd: string, name: string, url: string) => Promise<GitResult>
  // For plugins (RendererHost.git), on a folder that's an open project, in one, or in the projects
  // folder. Status rejects for any other folder; an op resolves ok false.
  pluginGitStatus: (dir: string) => Promise<RepoStatus>
  pluginGit: (dir: string, op: PluginGitOp, message?: string) => Promise<GitResult>
  writeFile: (path: string, content: string) => Promise<void>
  // Absolute paths. create and rename make missing parent directories and never overwrite.
  createFile: (path: string) => Promise<void>
  rename: (from: string, to: string) => Promise<void>
  trash: (path: string) => Promise<void>
  scratchRead: () => Promise<string>
  scratchWrite: (text: string) => Promise<void>
  search: (root: string, q: SearchQuery) => Promise<SearchResult>
  replace: (root: string, q: SearchQuery, replacement: string, paths: string[]) => Promise<number>
  // A playground slot's page (slot from 1): when it last changed (null: no page), and saving its answers.
  playVersion: (project: string, slot: number) => Promise<number | null>
  playSave: (project: string, slot: number, name: string, text: string) => Promise<void>
  // A folder's README (name + text), or null.
  readme: (dir: string) => Promise<{ name: string; text: string } | null>
  // A folder's subfolders and media files (absolute path), for the browser view.
  browse: (dir: string) => Promise<BrowseEntry[]>
  reveal: (path: string) => void
  // Every configured plugin folder and how loading it went.
  plugins: () => Promise<PluginStatus[]>
  // The loaded plugins' renderer sides, in activation order.
  pluginRenderers: () => Promise<LoadedPlugin[]>
  // Reloads the plugin in folder path and the ones that require it, or every plugin as the
  // settings list them (path null), without relaunching; resolves to the renderer sides it
  // loaded, in activation order. The renderer unloads its sides of them first.
  pluginReload: (path: string | null) => Promise<LoadedPlugin[]>
  pluginInvoke: (id: string, name: string, args: unknown[]) => Promise<unknown>
  // Clones a plugin's git repo into cuckcode's plugins folder; resolves to the folder, rejects
  // with git's error or when it isn't a plugin.
  pluginInstall: (url: string) => Promise<string>
  pluginInfo: (path: string, fetch: boolean) => Promise<PluginInfo | null>
  // git pull --ff-only; resolves to git's output.
  pluginUpdate: (path: string) => Promise<string>
  // Moves a clone cuckcode made to the Trash; a folder of your own is left alone.
  pluginUninstall: (path: string) => Promise<void>
  // The portable config file: written to / read from a file the user picks. Export resolves
  // false when cancelled; import to the new settings, or null when cancelled, and rejects on a bad file.
  exportConfig: () => Promise<boolean>
  importConfig: () => Promise<Settings | null>
  syncNow: () => void
  syncStatus: () => Promise<SyncStatus>

  onPtyData: (id: string, cb: (data: string) => void) => () => void
  // A run's exit carries how it ended; an agent's or shell's carries nothing.
  onPtyExit: (id: string, cb: (exit?: RunExit) => void) => () => void
  onAgentRequest: (cb: (r: AgentRequest) => void) => () => void
  onAgentRunEvent: (id: string, cb: (event: AgentRunEvent) => void) => () => void
  // A request ended: answered, timed out, or its hook went away.
  onAgentRequestEnd: (cb: (id: string) => void) => () => void
  // paths: what changed, relative to the project; null when the watcher couldn't say.
  onFsChange: (cb: (project: string, paths: string[] | null) => void) => () => void
  onMenu: (cb: (cmd: MenuCommand) => void) => () => void
  // The config repo brought in settings from another machine.
  onRemoteConfig: (cb: (settings: Settings) => void) => () => void
  // The config repo or an import brought in the scratchpad.
  onRemoteScratch: (cb: (text: string) => void) => () => void
  onSyncStatus: (cb: (status: SyncStatus) => void) => () => void
  // Quitting waits for cb (saving unsaved edits) before exiting.
  onFlush: (cb: () => Promise<void>) => () => void
}
