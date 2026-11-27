import * as React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import * as ReactDOM from 'react-dom'
import { useSyncExternalStore } from 'react'
import type { AgentPreset } from '../../shared/agents'
import type { AgentBarItem, AgentRunHandlers, EditorContext, HOST_MODULES, PluginGit, PluginPanel, PluginView, ProjectSource, RendererHost, RendererPlugin, RunProps, When } from '../../shared/plugin'
import type { AgentRequest, AgentRun, AgentRunEvent, GitResult, PluginGitOp } from '../../shared/types'
import { EmbeddedPlayground } from './components/Playground'
import Run from './components/Run'
import Scratch from './components/Scratch'
import { toast } from './components/Toasts'
import { message, pluginError } from './errors'
import { addThemeRules, monaco } from './monaco'
import { onPlayChange } from './play'

// The renderer side of plugins: what they registered, for App and CodePane to use. Loaded once
// at startup; a plugin that throws is reported and skipped.

type Editor = monaco.editor.ICodeEditor
type EditorHook = (editor: Editor, ctx: EditorContext<unknown>) => monaco.IDisposable | void
// Who a plugin is, for its errors.
type Who = { id: string; name: string }

export interface Registered {
  id: string
  name: string
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

let plugins: Registered[] = []
const listeners = new Set<() => void>()
const changed = (): void => {
  plugins = [...plugins]
  listeners.forEach((l) => l())
}

const editorHooks: { plugin: Who; fn: EditorHook }[] = []
// Each live editor and the hooks' disposables on it.
const editors = new Map<Editor, monaco.IDisposable[]>()
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

function hook(editor: Editor, h: (typeof editorHooks)[number]): void {
  try {
    const d = h.fn(editor, context(h.plugin.id))
    if (d) editors.get(editor)?.push(d)
  } catch (err) {
    pluginError(h.plugin, 'onEditor', err)
  }
}

// CodePane registers each editor it makes; returns the cleanup for when it's disposed.
export function addEditor(editor: Editor): () => void {
  editors.set(editor, [])
  for (const h of editorHooks) hook(editor, h)
  return () => {
    editors.get(editor)?.forEach((d) => d.dispose())
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
// with no plugin subscribed the agent asks in its terminal without waiting.
const requestSubs = new Set<(r: AgentRequest) => void>()
const endSubs = new Set<(id: string) => void>()

function subscribe<A>(subs: Set<(a: A) => void>, plugin: Who, where: string, fn: (a: A) => void): () => void {
  const safe = (a: A): void => {
    try {
      fn(a)
    } catch (err) {
      pluginError(plugin, where, err)
    }
  }
  subs.add(safe)
  return () => void subs.delete(safe)
}

let started = false

export async function loadPlugins(): Promise<void> {
  if (started) return
  started = true
  window.api.onAgentRequest((r) => {
    window.api.agentTaken(r.id, requestSubs.size > 0)
    for (const fn of [...requestSubs]) fn(r)
  })
  window.api.onAgentRequestEnd((id) => [...endSubs].forEach((fn) => fn(id)))
  const loaded = await window.api.pluginRenderers().catch(() => [])
  for (const p of loaded) {
    const reg: Registered = {
      id: p.id,
      name: p.name,
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
    plugins.push(reg)
    if (p.style) {
      const style = document.createElement('style')
      style.dataset.plugin = p.id
      style.textContent = p.style
      document.head.append(style)
    }
    if (!p.renderer) continue
    const plugin = { id: p.id, name: p.name }
    const refuse = (what: string): void => pluginError(plugin, 'registration', what)
    const host: RendererHost = {
      monaco,
      // Rejects with main's own message, without Electron's wrapping.
      invoke: <R,>(name: string, ...args: unknown[]) =>
        (window.api.pluginInvoke(p.id, name, args) as Promise<R>).catch((err: unknown) => {
          throw new Error(message(err))
        }),
      provide: (api) => apis.set(p.id, api),
      use: <A,>(id: string) => apis.get(id) as A | undefined,
      addThemeRules,
      projectData: (source) => (reg.source = source),
      // One per command, which names its header button, so one without a command is refused. Registering
      // a command's view again replaces it in place, keeping its button where it was.
      view: (v: PluginView<unknown> & { when?: When<unknown> }) => {
        if (typeof v?.command !== 'string') refuse(`a view needs a command (got ${JSON.stringify(v?.command)})`)
        else if (reg.views.some((x) => x.command === v.command)) reg.views = reg.views.map((x) => (x.command === v.command ? v : x))
        else reg.views = [...reg.views, v]
      },
      // A panel's id names its dock tab and is saved in layouts, so a bad or repeated one is refused,
      // as is one without a command (nothing could open it).
      panel: (panel: PluginPanel<unknown> & { when?: When<unknown> }) => {
        if (typeof panel?.id !== 'string' || !/^[\w-]+$/.test(panel.id)) refuse(`a panel's id must match [\\w-]+ (got ${JSON.stringify(panel?.id)})`)
        else if (typeof panel.command !== 'string') refuse(`panel ${panel.id} needs a command`)
        else if (reg.panels.some((x) => x.id === panel.id)) refuse(`panel ${panel.id} is already registered`)
        else reg.panels.push(panel)
      },
      show: (command) => show(p.id, command, true),
      hide: (command) => void show(p.id, command, false),
      toast: (text, opts) => toast(opts?.ok ?? true, p.name, String(text)),
      onCommand: (id, fn) => reg.commands.set(id, fn),
      onEditor: (fn) => {
        const h = { plugin, fn: fn as EditorHook }
        editorHooks.push(h)
        for (const editor of editors.keys()) hook(editor, h)
      },
      sendToAgent: (text, opts) =>
        sendToAgent({
          text: String(text),
          submit: opts?.submit ?? true,
          stay: !!opts?.stay,
          project: typeof opts?.project === 'string' && opts.project ? opts.project : undefined,
          plugin: p.id,
          from: p.name
        }),
      mediaUrl,
      agentPreset: (preset) => reg.presets.push(preset),
      agentBar: (item) => reg.bar.push(item),
      Scratch,
      Playground: EmbeddedPlayground,
      // Bound to the plugin, whose id scopes its runs' names.
      Run: (props: RunProps) => React.createElement(Run, { ...props, plugin }),
      git,
      onAgentRequest: (fn) => subscribe(requestSubs, plugin, 'onAgentRequest', fn),
      answerAgent: (id, output) => window.api.agentAnswer(String(id), output ?? null),
      onAgentRequestEnd: (fn) => subscribe(endSubs, plugin, 'onAgentRequestEnd', fn),
      runAgent: async (run) => {
        const started = await window.api.agentRunStart(p.id, runOf(run))
        if ('refused' in started) throw new Error(`runAgent: ${started.refused}`)
        return started.id
      },
      onAgentRun: (id, on) => watchRun(plugin, String(id), on),
      stopAgentRun: (id) => window.api.agentRunStop(p.id, String(id)),
      onPlayground: (fn) =>
        onPlayChange((slot, project) => {
          try {
            fn(slot, project)
          } catch (err) {
            pluginError(plugin, 'onPlayground', err)
          }
        })
    }
    try {
      const module = { exports: {} as Partial<RendererPlugin> }
      const require = (name: string): unknown => {
        if (name in MODULES) return MODULES[name as keyof typeof MODULES]
        throw new Error(`${p.id} requires ${name}, which cuckcode doesn't provide: bundle it in`)
      }
      new Function('require', 'module', 'exports', p.renderer)(require, module, module.exports)
      await module.exports.activate?.(host)
    } catch (err) {
      reg.error = String(err)
      pluginError(plugin, 'activate', err)
    }
  }
  changed()
}
