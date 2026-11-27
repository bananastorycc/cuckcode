import * as React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import * as ReactDOM from 'react-dom'
import { useSyncExternalStore } from 'react'
import type { AgentPreset } from '../../shared/agents'
import type { AgentBarItem, AgentRunHandlers, Disposable, EditorContext, HOST_MODULES, LoadedPlugin, PluginGit, PluginPanel, PluginView, ProjectSource, RendererHost, RendererPlugin, RunProps, When } from '../../shared/plugin'
import type { AgentRequest, AgentRun, AgentRunEvent, GitResult, PluginGitOp } from '../../shared/types'
import { EmbeddedPlayground } from './components/Playground'
import Run from './components/Run'
import Scratch from './components/Scratch'
import { toast } from './components/Toasts'
import { clearErrors, message, pluginError } from './errors'
import { addThemeRules, monaco } from './monaco'
import { onPlayChange } from './play'

// The renderer side of plugins: what they registered, for App and CodePane to use. Loaded at
// startup; a plugin that throws is reported and skipped. Everything a plugin registers is undone by
// its Disposable, so a reload (reloadPlugins) can take a plugin out and put its new version in.

type Editor = monaco.editor.ICodeEditor
type EditorHook = (editor: Editor, ctx: EditorContext<unknown>) => monaco.IDisposable | void
// Who a plugin is, for its errors.
type Who = { id: string; name: string }
type Hook = { plugin: Who; fn: EditorHook }

export interface Registered {
  id: string
  name: string
  // Which load this is: a reload makes a new Registered, so App drops the old version's data and
  // gives its crashed pages another try.
  key: number
  source: ProjectSource<unknown> | null
  views: (PluginView<unknown> & { when?: When<unknown> })[]
  panels: (PluginPanel<unknown> & { when?: When<unknown> })[]
  commands: Map<string, () => void>
  presets: AgentPreset[]
  bar: AgentBarItem[]
  // A command's shortcut as the menu shows it (⇧⌘S), or ''.
  shortcut: (command: string) => string
  error?: string // its renderer side failed to activate
}

// A loaded plugin, as the host keeps it.
interface Live {
  reg: Registered
  who: Who
  path: string
  requires: string[]
  module: Partial<RendererPlugin>
  // What it registered, undone at unload, newest first.
  undo: Set<() => void>
  style: HTMLStyleElement | null
  // Activating: what it registers shows once activate is done.
  quiet: boolean
  // Unloaded: what the old code still tries to register is refused.
  dead: boolean
}

const GLYPHS: Record<string, string> = { cmd: '⌘', cmdorctrl: '⌘', command: '⌘', ctrl: '⌃', control: '⌃', alt: '⌥', option: '⌥', shift: '⇧' }
const ORDER = '⌃⌥⇧⌘'

// 'Cmd+Shift+S' -> '⇧⌘S', in the order macOS menus use.
export function keys(accelerator: string): string {
  const parts = accelerator.split('+')
  const mods = parts.slice(0, -1).map((m) => GLYPHS[m.toLowerCase()] ?? '').sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))
  return mods.join('') + parts[parts.length - 1].toUpperCase()
}

const MODULES: Record<(typeof HOST_MODULES)[number], unknown> = {
  react: React,
  'react/jsx-runtime': jsxRuntime,
  'react-dom': ReactDOM,
  'monaco-editor/editor/editor.api': monaco
}

// How long a deactivate gets before the reload goes on without it.
const DEACTIVATE_MS = 5000

let plugins: Registered[] = []
const lives = new Map<string, Live>() // by id, in activation order
let loads = 0
const listeners = new Set<() => void>()
const changed = (): void => {
  plugins = [...plugins]
  listeners.forEach((l) => l())
}
// A change to what live registered, shown now unless it's still activating.
const touched = (live: Live): void => {
  if (!live.quiet) changed()
}

const editorHooks = new Set<Hook>()
// Each live editor and the hooks' disposables on it.
const editors = new Map<Editor, { hook: Hook; d: monaco.IDisposable }[]>()
const apis = new Map<string, unknown>()
// Per plugin: its data for the active project. App keeps it current.
const current = new Map<string, unknown>()
let openFile: (abs: string, line: number) => void = () => {}
export interface Send {
  text: string
  submit: boolean
  stay: boolean
  project?: string // the project whose agent gets it; unset: see agentProject (pages.ts)
  plugin: string // the sender's id and name
  from: string
}
let sendToAgent: (send: Send) => Promise<boolean> = async () => false
let show: (plugin: string, command: string, on: boolean) => boolean = () => false
// CodePane's saveAll (CodePane imports this module, so it's handed over rather than imported).
let saveAll: () => Promise<unknown> = async () => {}

export const usePlugins = (): Registered[] =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => plugins
  )

// The plugin as it's loaded now, for code holding on to an older Registered.
export const pluginNow = (id: string): Registered | undefined => lives.get(id)?.reg

export function setCurrent(id: string, data: unknown): void {
  current.set(id, data)
}

export function setOpenFile(fn: (abs: string, line: number) => void): void {
  openFile = fn
}

export function setSendToAgent(fn: typeof sendToAgent): void {
  sendToAgent = fn
}

// Opens (on) or closes the view or panel for a plugin's command; false when it isn't offered.
export function setShow(fn: typeof show): void {
  show = fn
}

export function setSaveAll(fn: typeof saveAll): void {
  saveAll = fn
}

// Only data crosses to main: a plugin's object may hold anything.
const runOf = (run: AgentRun): AgentRun => ({
  project: String(run?.project ?? ''),
  prompt: String(run?.prompt ?? ''),
  profile: String(run?.profile ?? ''),
  thread: !!run?.thread,
  ...(run?.resume !== undefined && run.resume !== null ? { resume: String(run.resume) } : {}),
  ...(typeof run?.timeout === 'number' ? { timeout: run.timeout } : {})
})

// A run's events for a page: what main kept so far, then live ones. Live events that arrive
// while the catch-up is on its way wait for it; seq drops any already delivered.
function watchRun(plugin: Who, id: string, on: AgentRunHandlers): () => void {
  let next = 0
  let caught = false
  let off = false
  const waiting: AgentRunEvent[] = []
  const call = <A,>(fn: ((a: A) => void) | undefined, a: A): void => {
    try {
      fn?.(a)
    } catch (err) {
      pluginError(plugin, 'onAgentRun', err)
    }
  }
  const deliver = (e: AgentRunEvent): void => {
    if (off || e.seq < next) return
    next = e.seq + 1
    if ('end' in e) call(on?.end, e.end)
    else for (const line of e.lines) call(on?.output, line)
  }
  const unsubscribe = window.api.onAgentRunEvent(id, (e) => (caught ? deliver(e) : waiting.push(e)))
  void window.api
    .agentRunEvents(plugin.id, id)
    .catch((): AgentRunEvent[] => [])
    .then((kept) => {
      kept.forEach(deliver)
      caught = true
      waiting.splice(0).forEach(deliver)
    })
  return () => {
    off = true
    unsubscribe()
  }
}

// As the git panel does it: unsaved editors first, so what's committed is what's on screen.
const gitOp = async (repo: string, op: PluginGitOp, message?: string): Promise<GitResult> => {
  await saveAll()
  return window.api.pluginGit(repo, op, message)
}

const git: PluginGit = {
  status: (repo) => window.api.pluginGitStatus(repo),
  draft: (repo) => gitOp(repo, 'draft'),
  commit: (repo, message) => gitOp(repo, 'commit', String(message ?? '')),
  sync: (repo) => gitOp(repo, 'sync'),
  pull: (repo) => gitOp(repo, 'pull'),
  push: (repo) => gitOp(repo, 'push')
}

export const mediaUrl = (abs: string): string => `media://local/?path=${encodeURIComponent(abs)}`

function context(id: string): EditorContext<unknown> {
  return { data: () => current.get(id) ?? null, openFile: (abs, line) => openFile(abs, line), mediaUrl }
}

function hook(editor: Editor, h: Hook): void {
  try {
    const d = h.fn(editor, context(h.plugin.id))
    if (d) editors.get(editor)?.push({ hook: h, d })
  } catch (err) {
    pluginError(h.plugin, 'onEditor', err)
  }
}

// A plugin's disposable, which it may run before the host does.
function safeDispose(plugin: Who, d: monaco.IDisposable): void {
  try {
    d.dispose()
  } catch (err) {
    pluginError(plugin, 'onEditor', err)
  }
}

// CodePane registers each editor it makes; returns the cleanup for when it's disposed.
export function addEditor(editor: Editor): () => void {
  editors.set(editor, [])
  for (const h of editorHooks) hook(editor, h)
  return () => {
    editors.get(editor)?.forEach((x) => safeDispose(x.hook.plugin, x.d))
    editors.delete(editor)
  }
}

export function runCommand(plugin: string, command: string): void {
  const p = plugins.find((x) => x.id === plugin)
  try {
    p?.commands.get(command)?.()
  } catch (err) {
    pluginError(p!, `command ${command}`, err)
  }
}

// Agent requests (agentrequest.ts in main): main hears at once whether anyone's listening, so
// with no plugin subscribed the agent asks in its terminal without waiting. heard: the plugins
// each pending request went to, so one that only a reloaded plugin heard isn't left waiting.
type Sub<A> = { plugin: Who; fn: (a: A) => void }
const requestSubs = new Set<Sub<AgentRequest>>()
const endSubs = new Set<Sub<string>>()
const heard = new Map<string, Set<string>>()

function subscribe<A>(subs: Set<Sub<A>>, plugin: Who, where: string, fn: (a: A) => void): () => void {
  const sub: Sub<A> = {
    plugin,
    fn: (a) => {
      try {
        fn(a)
      } catch (err) {
        pluginError(plugin, where, err)
      }
    }
  }
  subs.add(sub)
  return () => void subs.delete(sub)
}

// Registers through register (which returns its undo) unless live is gone, and hands back the
// Disposable that undoes it, once.
function disposable(live: Live, register: () => () => void): Disposable {
  let undo: (() => void) | null = null
  const dispose = (): void => {
    if (!undo) return
    const u = undo
    undo = null
    live.undo.delete(u)
    try {
      u()
    } catch (err) {
      pluginError(live.who, 'dispose', err)
    }
  }
  if (!live.dead) {
    undo = register()
    live.undo.add(undo)
  }
  return dispose
}

function hostFor(live: Live, p: LoadedPlugin): RendererHost {
  const { reg, who: plugin } = live
  const refuse = (what: string): Disposable => {
    pluginError(plugin, 'registration', what)
    return disposable(live, () => () => {})
  }
  // A change to reg that App shows, and its undo.
  const shown = (register: () => () => void): Disposable =>
    disposable(live, () => {
      const undo = register()
      touched(live)
      return () => {
        undo()
        touched(live)
      }
    })
  // An unloaded version's timers and callbacks can still call in; what reaches main or an agent is refused.
  const unloaded = (what: string): Error => new Error(`${what}: ${p.name} was unloaded (reloaded, or turned off)`)
  return {
    monaco,
    // Rejects with main's own message, without Electron's wrapping.
    invoke: async <R,>(name: string, ...args: unknown[]) => {
      if (live.dead) throw unloaded('invoke')
      return (window.api.pluginInvoke(p.id, name, args) as Promise<R>).catch((err: unknown) => {
        throw new Error(message(err))
      })
    },
    provide: (api) =>
      disposable(live, () => {
        apis.set(p.id, api)
        return () => void (apis.get(p.id) === api && apis.delete(p.id))
      }),
    use: <A,>(id: string) => apis.get(id) as A | undefined,
    addThemeRules: (light, dark) => disposable(live, () => addThemeRules(light ?? [], dark ?? [])),
    projectData: (source) =>
      shown(() => {
        reg.source = source
        return () => void (reg.source === source && (reg.source = null))
      }),
    // One per command, which names its header button, so one without a command is refused. Registering
    // a command's view again replaces it in place, keeping its button where it was.
    view: (v: PluginView<unknown> & { when?: When<unknown> }) => {
      if (typeof v?.command !== 'string') return refuse(`a view needs a command (got ${JSON.stringify(v?.command)})`)
      return shown(() => {
        if (reg.views.some((x) => x.command === v.command)) reg.views = reg.views.map((x) => (x.command === v.command ? v : x))
        else reg.views = [...reg.views, v]
        return () => void (reg.views = reg.views.filter((x) => x !== v))
      })
    },
    // A panel's id names its dock tab and is saved in layouts, so a bad or repeated one is refused,
    // as is one without a command (nothing could open it).
    panel: (panel: PluginPanel<unknown> & { when?: When<unknown> }) => {
      if (typeof panel?.id !== 'string' || !/^[\w-]+$/.test(panel.id)) return refuse(`a panel's id must match [\\w-]+ (got ${JSON.stringify(panel?.id)})`)
      if (typeof panel.command !== 'string') return refuse(`panel ${panel.id} needs a command`)
      if (reg.panels.some((x) => x.id === panel.id)) return refuse(`panel ${panel.id} is already registered`)
      return shown(() => {
        reg.panels = [...reg.panels, panel]
        return () => void (reg.panels = reg.panels.filter((x) => x !== panel))
      })
    },
    show: (command) => show(p.id, command, true),
    hide: (command) => void show(p.id, command, false),
    toast: (text, opts) => toast(opts?.ok ?? true, p.name, String(text)),
    onCommand: (id, fn) =>
      disposable(live, () => {
        reg.commands.set(id, fn)
        return () => void (reg.commands.get(id) === fn && reg.commands.delete(id))
      }),
    onEditor: (fn) =>
      disposable(live, () => {
        const h: Hook = { plugin, fn: fn as EditorHook }
        editorHooks.add(h)
        for (const editor of editors.keys()) hook(editor, h)
        return () => {
          editorHooks.delete(h)
          for (const [editor, list] of editors) {
            list.filter((x) => x.hook === h).forEach((x) => safeDispose(plugin, x.d))
            editors.set(editor, list.filter((x) => x.hook !== h))
          }
        }
      }),
    sendToAgent: async (text, opts) =>
      !live.dead &&
      sendToAgent({
        text: String(text),
        submit: opts?.submit ?? true,
        stay: !!opts?.stay,
        project: typeof opts?.project === 'string' && opts.project ? opts.project : undefined,
        plugin: p.id,
        from: p.name
      }),
    mediaUrl,
    agentPreset: (preset) =>
      shown(() => {
        reg.presets = [...reg.presets, preset]
        return () => void (reg.presets = reg.presets.filter((x) => x !== preset))
      }),
    agentBar: (item) =>
      shown(() => {
        reg.bar = [...reg.bar, item]
        return () => void (reg.bar = reg.bar.filter((x) => x !== item))
      }),
    Scratch,
    Playground: EmbeddedPlayground,
    // Bound to the plugin, whose id scopes its runs' names.
    Run: (props: RunProps) => React.createElement(Run, { ...props, plugin }),
    git,
    onAgentRequest: (fn) => disposable(live, () => subscribe(requestSubs, plugin, 'onAgentRequest', fn)),
    answerAgent: (id, output) => window.api.agentAnswer(String(id), output ?? null),
    onAgentRequestEnd: (fn) => disposable(live, () => subscribe(endSubs, plugin, 'onAgentRequestEnd', fn)),
    runAgent: async (run) => {
      if (live.dead) throw unloaded('runAgent')
      const started = await window.api.agentRunStart(p.id, runOf(run))
      if ('refused' in started) throw new Error(`runAgent: ${started.refused}`)
      return started.id
    },
    onAgentRun: (id, on) => disposable(live, () => watchRun(plugin, String(id), on)),
    stopAgentRun: (id) => window.api.agentRunStop(p.id, String(id)),
    onPlayground: (fn) =>
      disposable(live, () =>
        onPlayChange((slot, project) => {
          try {
            fn(slot, project)
          } catch (err) {
            pluginError(plugin, 'onPlayground', err)
          }
        })
      )
  }
}

async function activate(p: LoadedPlugin): Promise<void> {
  const reg: Registered = {
    id: p.id,
    name: p.name,
    key: ++loads,
    source: null,
    views: [],
    panels: [],
    commands: new Map(),
    presets: [],
    bar: [],
    shortcut: (command) => {
      const a = p.commands.find((c) => c.id === command)?.accelerator
      return a ? keys(a) : ''
    }
  }
  const live: Live = { reg, who: { id: p.id, name: p.name }, path: p.path, requires: p.requires, module: {}, undo: new Set(), style: null, quiet: true, dead: false }
  lives.set(p.id, live)
  plugins = [...plugins, reg]
  if (p.style) {
    live.style = document.createElement('style')
    live.style.dataset.plugin = p.id
    live.style.textContent = p.style
    document.head.append(live.style)
  }
  if (p.renderer) {
    try {
      const module = { exports: {} as Partial<RendererPlugin> }
      const require = (name: string): unknown => {
        if (name in MODULES) return MODULES[name as keyof typeof MODULES]
        throw new Error(`${p.id} requires ${name}, which cuckcode doesn't provide: bundle it in`)
      }
      new Function('require', 'module', 'exports', p.renderer)(require, module, module.exports)
      live.module = module.exports
      await module.exports.activate?.(hostFor(live, p))
    } catch (err) {
      reg.error = String(err)
      pluginError(live.who, 'activate', err)
    }
  }
  live.quiet = false
}

// Takes a plugin out: its deactivate, then everything it registered, newest first, and its
// stylesheet. A request only it heard goes back to the agent's terminal.
async function unload(live: Live): Promise<void> {
  clearErrors(live.reg.id)
  live.dead = true
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`didn't finish in ${DEACTIVATE_MS / 1000} s`)), DEACTIVATE_MS)))
    await Promise.race([Promise.resolve().then(() => live.module.deactivate?.()), late])
  } catch (err) {
    pluginError(live.who, 'deactivate', err)
  } finally {
    clearTimeout(timer)
  }
  live.quiet = true
  for (const undo of [...live.undo].reverse()) {
    live.undo.delete(undo)
    try {
      undo()
    } catch (err) {
      pluginError(live.who, 'dispose', err)
    }
  }
  live.style?.remove()
  apis.delete(live.reg.id)
  for (const [id, by] of heard) {
    by.delete(live.reg.id)
    if (by.size) continue
    heard.delete(id)
    void window.api.agentAnswer(id, null).catch(() => false)
  }
  lives.delete(live.reg.id)
  plugins = plugins.filter((x) => x !== live.reg)
}

let first: Promise<void> | null = null

export function loadPlugins(): Promise<void> {
  first ??= (async () => {
    window.api.onAgentRequest((r) => {
      window.api.agentTaken(r.id, requestSubs.size > 0)
      if (requestSubs.size) heard.set(r.id, new Set([...requestSubs].map((s) => s.plugin.id)))
      for (const s of [...requestSubs]) s.fn(r)
    })
    window.api.onAgentRequestEnd((id) => {
      heard.delete(id)
      ;[...endSubs].forEach((s) => s.fn(id))
    })
    const loaded = await window.api.pluginRenderers().catch(() => [])
    for (const p of loaded) await activate(p)
    changed()
  })()
  return first
}

let reloading: Promise<unknown> = Promise.resolve()

// Reloads the plugin in folder path and the ones that require it (and those that require them),
// or every plugin (path null), without a relaunch: this side unloads them, last-activated first,
// main reloads its sides (rebuilding what's stale), and the new versions activate in order, each
// where it was in the list. Agents' terminals and runs aren't touched. Resolves to how many loaded.
export function reloadPlugins(path: string | null): Promise<number> {
  const run = reloading.then(() => reloadNow(path))
  reloading = run.catch(() => {})
  return run
}

async function reloadNow(path: string | null): Promise<number> {
  await loadPlugins()
  const order = plugins.map((p) => p.id)
  const ids = new Set([...lives.values()].filter((l) => path === null || l.path === path).map((l) => l.reg.id))
  for (let grew = true; grew; ) {
    grew = false
    for (const l of lives.values())
      if (!ids.has(l.reg.id) && l.requires.some((r) => ids.has(r))) {
        ids.add(l.reg.id)
        grew = true
      }
  }
  for (const l of [...lives.values()].reverse()) if (ids.has(l.reg.id)) await unload(l)
  changed()
  let fresh: LoadedPlugin[]
  try {
    fresh = await window.api.pluginReload(path)
  } catch (err) {
    // Main kept what it had: this side's of them come back.
    for (const p of await window.api.pluginRenderers().catch((): LoadedPlugin[] => [])) if (!lives.has(p.id)) await activate(p)
    changed()
    throw err
  }
  for (const p of fresh) {
    // One main reloaded that this side didn't take out (a requirement it learned of since).
    const old = lives.get(p.id)
    if (old) await unload(old)
    await activate(p)
  }
  const rank = (id: string): number => (order.includes(id) ? order.indexOf(id) : order.length)
  plugins = [...plugins].sort((a, b) => rank(a.id) - rank(b.id))
  changed()
  return fresh.length
}
