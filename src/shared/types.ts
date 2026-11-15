// Contract between main, preload and renderer. Paths in ChangedFile are repo-root relative.
import type { LoadedPlugin, PluginInfo, PluginStatus } from './plugin'

export type Theme = 'light' | 'dark'

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
// aicommit is commit with a message claude writes from the changes.
export type GitOp = 'commit' | 'aicommit' | 'pull' | 'push' | 'sync' | 'switch' | 'branch'

export interface GitResult {
  ok: boolean
  output: string
}

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

// What an agent tab runs: claude (with the playground prompt, usage meter and notifications),
// junie on one license (with its credit meter), or any command.
export type AgentType = 'claude' | 'junie' | 'command'

export interface Agent {
  id: string
  name: string
  type: AgentType
  license?: string // junie: the JetBrains license id, passed as --auth-license
  command?: string // command: run by the login shell
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
  enabled: boolean
}

// What the Settings screen edits.
export interface Config {
  projectsDir: string // where ⌘T opens from and new clones go
  meters: boolean // Claude usage and Junie credit meters (read from the Keychain)
  readme: boolean
  folders: { enabled: boolean; dirs: string[] }
  playgrounds: PlaygroundSlot[]
  webPages: WebPage[]
  agents: Agent[] // in the agent dropdown's order; the first is each project's default
  plugins: PluginRef[]
}

export const MAX_SLOTS = 10

export interface Settings extends Config {
  projects: string[]
  // The tab in front at quit; it reopens in front regardless of tab order.
  active: string | null
  theme: Theme
  // Per project path: the file (repo-root relative) in front at quit. The terminal always reopens on the first agent.
  files: Record<string, string>
  // Projects opened before, most recently opened or closed first; the empty screen lists them.
  recent: string[]
  // The window's last size and place. Main keeps it; the renderer never sends it.
  window?: Bounds
  // The workspace's dock layout as last left (dockview's JSON; the renderer validates it),
  // and the layouts saved by name.
  layout: unknown
  layouts: SavedLayout[]
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

// Account-wide plan usage, as `claude /usage` shows it. resetsAt is ISO.
export interface UsageLimit {
  label: string
  percent: number
  resetsAt: string | null
}

export interface Usage {
  limits: UsageLimit[]
  // Extra usage credits, when enabled. In currency units; limit null when uncapped.
  credits: { used: number; limit: number | null; currency: string } | null
}

// AI credits left of a pool's total.
export interface JuniePool {
  left: number
  total: number
}

export interface JunieBalance {
  monthly: JuniePool // the license's own allowance, refilled every 30 days
  topUp: JuniePool // bought credits: one pool for the whole account, the same on both licenses
  resetsAt: string | null // when the license's monthly credits next refill
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
  | { type: 'plugin'; plugin: string; command: string }

export type PaneDir = 'left' | 'right' | 'up' | 'down'

export interface Api {
  init: () => Promise<Settings>
  save: (settings: Settings) => void
  // A fresh install's settings.
  defaults: () => Promise<Settings>
  // A folder from the open dialog, or null.
  pickFolder: () => Promise<string | null>
  // The folders in the projects folder (absolute paths).
  repos: () => Promise<string[]>
  // Clones remote into <projects folder>/name, or, when it's empty, inits there and pushes a first commit
  // to main. Resolves to the new folder; rejects with git's error.
  setUpRepo: (remote: string, name: string) => Promise<string>
  focus: () => void
  watch: (projects: string[]) => void

  ptyStart: (id: string, cols: number, rows: number) => Promise<string>
  ptyRestart: (id: string, cols: number, rows: number) => Promise<void>
  ptyWrite: (id: string, data: string) => void
  ptyResize: (id: string, cols: number, rows: number) => void
  ptyKill: (id: string) => void

  status: (cwd: string) => Promise<GitStatus>
  files: (root: string) => Promise<string[]>
  snapshot: (root: string, file: ChangedFile) => Promise<FileSnapshot>
  branches: (cwd: string) => Promise<Branches>
  // A page of HEAD's history, newest first, starting skip commits back.
  log: (cwd: string, skip: number) => Promise<Commit[]>
  commitFiles: (root: string, sha: string) => Promise<ChangedFile[]>
  // arg: the commit message, or the branch name for switch/branch.
  git: (cwd: string, op: GitOp, arg?: string) => Promise<GitResult>
  // Puts a changed file back as HEAD has it (new files go to the Trash), after a confirm for
  // tracked ones. null when the confirm is cancelled.
  discard: (root: string, file: ChangedFile) => Promise<GitResult | null>
  // Points a remote at url, adding it if the repo doesn't have it yet.
  setRemote: (cwd: string, name: string, url: string) => Promise<GitResult>
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
  pluginInvoke: (id: string, name: string, args: unknown[]) => Promise<unknown>
  // Clones a plugin's git repo into cuckcode's plugins folder; resolves to the folder, rejects
  // with git's error or when it isn't a plugin.
  pluginInstall: (url: string) => Promise<string>
  pluginInfo: (path: string, fetch: boolean) => Promise<PluginInfo | null>
  // git pull --ff-only; resolves to git's output.
  pluginUpdate: (path: string) => Promise<string>
  // Moves a clone cuckcode made to the Trash; a folder of your own is left alone.
  pluginUninstall: (path: string) => Promise<void>
  // Quits (as ⌘Q does) and starts again, to apply plugin changes.
  relaunch: () => void
  // null when signed out or the request fails.
  usage: () => Promise<Usage | null>
  junieBalance: (license: string) => Promise<JunieBalance | null>

  onPtyData: (id: string, cb: (data: string) => void) => () => void
  onPtyExit: (id: string, cb: () => void) => () => void
  // paths: what changed, relative to the project; null when the watcher couldn't say.
  onFsChange: (cb: (project: string, paths: string[] | null) => void) => () => void
  onMenu: (cb: (cmd: MenuCommand) => void) => () => void
  // Quitting waits for cb (saving unsaved edits) before exiting.
  onFlush: (cb: () => Promise<void>) => () => void
}
