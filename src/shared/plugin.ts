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
// lockfile changed) and `npm run build` there before loading, whenever src/ is newer than the bundles.
import type * as Monaco from 'monaco-editor/editor/editor.api'
import type { ReactNode } from 'react'

export const MANIFEST = 'cuckcode-plugin.json'

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
  openFile: (abs: string, line: number) => void
}

// A header button and a command that show a full-workspace view, while the project has data.
export interface PluginView<T> {
  command: string // one of the manifest's commands
  title: string
  icon: ReactNode
  render: (props: ViewProps<T>) => ReactNode
}

export interface EditorContext<T> {
  // This plugin's data for the open project.
  data: () => T | null
  openFile: (abs: string, line: number) => void
  // A URL the page can load for a file on disk (images, video).
  mediaUrl: (abs: string) => string
}

export interface RendererHost<T = unknown> {
  monaco: typeof Monaco
  invoke: <R>(name: string, ...args: unknown[]) => Promise<R>
  provide: (api: unknown) => void
  use: <A>(id: string) => A | undefined
  // Token colors added to cuckcode's light and dark editor themes.
  addThemeRules: (light: Monaco.editor.ITokenThemeRule[], dark: Monaco.editor.ITokenThemeRule[]) => void
  projectData: (source: ProjectSource<T>) => void
  view: (view: PluginView<T>) => void
  onCommand: (id: string, fn: () => void) => void
  // Called for each code editor, now and later; the disposable runs when it goes.
  onEditor: (fn: (editor: Monaco.editor.ICodeEditor, ctx: EditorContext<T>) => Monaco.IDisposable | void) => void
}

export interface RendererPlugin {
  activate: (host: RendererHost) => void | Promise<void>
}
