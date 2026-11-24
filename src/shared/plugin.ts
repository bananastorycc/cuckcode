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
import type { Agent, Section } from './types'

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
  sendToAgent: (text: string, opts?: { submit?: boolean }) => Promise<boolean>
  // A URL the page can load for a file on disk (images, video).
  mediaUrl: (abs: string) => string
  // An agent to start from in Settings › Agents › Add, beside the built-in ones.
  agentPreset: (preset: AgentPreset) => void
  agentBar: (item: AgentBarItem) => void
  // cuckcode's scratchpad, for a view to show (it covers the Scratch section): the same notes,
  // kept in step as they're typed, saved the same way. actions go at the right of its title bar.
  Scratch: ComponentType<{ actions?: ReactNode }>
}

export interface RendererPlugin {
  activate: (host: RendererHost) => void | Promise<void>
}
