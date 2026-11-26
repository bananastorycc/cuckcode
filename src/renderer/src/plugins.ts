import * as React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import * as ReactDOM from 'react-dom'
import { useSyncExternalStore } from 'react'
import type { AgentPreset } from '../../shared/agents'
import type { AgentBarItem, EditorContext, HOST_MODULES, PluginGit, PluginPanel, PluginView, ProjectSource, RendererHost, RendererPlugin, RunProps, When } from '../../shared/plugin'
import type { GitResult, PluginGitOp } from '../../shared/types'
import { EmbeddedPlayground } from './components/Playground'
import Run from './components/Run'
import Scratch from './components/Scratch'
import { toast } from './components/Toasts'
import { addThemeRules, monaco } from './monaco'
import { onPlayChange } from './play'

// The renderer side of plugins: what they registered, for App and CodePane to use. Loaded once
// at startup; a plugin that throws is reported and skipped.

type Editor = monaco.editor.ICodeEditor
type EditorHook = (editor: Editor, ctx: EditorContext<unknown>) => monaco.IDisposable | void

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

const editorHooks: { id: string; fn: EditorHook }[] = []
// Each live editor and the hooks' disposables on it.
const editors = new Map<Editor, monaco.IDisposable[]>()
const apis = new Map<string, unknown>()
// Per plugin: its data for the active project. App keeps it current.
const current = new Map<string, unknown>()
let openFile: (abs: string, line: number) => void = () => {}
let sendToAgent: (text: string, submit: boolean, from: string, stay?: boolean) => Promise<boolean> = async () => false
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
    const d = h.fn(editor, context(h.id))
    if (d) editors.get(editor)?.push(d)
  } catch (err) {
    console.error(`plugin ${h.id}:`, err)
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
  plugins.find((p) => p.id === plugin)?.commands.get(command)?.()
}

let started = false

export async function loadPlugins(): Promise<void> {
  if (started) return
  started = true
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
    const host: RendererHost = {
      monaco,
      invoke: <R,>(name: string, ...args: unknown[]) => window.api.pluginInvoke(p.id, name, args) as Promise<R>,
      provide: (api) => apis.set(p.id, api),
      use: <A,>(id: string) => apis.get(id) as A | undefined,
      addThemeRules,
      projectData: (source) => (reg.source = source),
      // One per command, which names its header button, so one without a command is refused. Registering
      // a command's view again replaces it in place, keeping its button where it was.
      view: (v: PluginView<unknown> & { when?: When<unknown> }) => {
        if (typeof v?.command !== 'string') console.error(`plugin ${p.id}: view needs a command:`, v?.command)
        else if (reg.views.some((x) => x.command === v.command)) reg.views = reg.views.map((x) => (x.command === v.command ? v : x))
        else reg.views = [...reg.views, v]
      },
      // A panel's id names its dock tab and is saved in layouts, so a bad or repeated one is refused,
      // as is one without a command (nothing could open it).
      panel: (panel: PluginPanel<unknown> & { when?: When<unknown> }) => {
        if (typeof panel?.id !== 'string' || !/^[\w-]+$/.test(panel.id)) console.error(`plugin ${p.id}: panel id must match [\\w-]+:`, panel?.id)
        else if (typeof panel.command !== 'string') console.error(`plugin ${p.id}: panel ${panel.id} needs a command:`, panel.command)
        else if (reg.panels.some((x) => x.id === panel.id)) console.error(`plugin ${p.id}: panel ${panel.id} is already registered`)
        else reg.panels.push(panel)
      },
      show: (command) => show(p.id, command, true),
      hide: (command) => void show(p.id, command, false),
      toast: (text, opts) => toast(opts?.ok ?? true, p.name, String(text)),
      onCommand: (id, fn) => reg.commands.set(id, fn),
      onEditor: (fn) => {
        const h = { id: p.id, fn: fn as EditorHook }
        editorHooks.push(h)
        for (const editor of editors.keys()) hook(editor, h)
      },
      sendToAgent: (text, opts) => sendToAgent(text, opts?.submit ?? true, p.name, opts?.stay),
      mediaUrl,
      agentPreset: (preset) => reg.presets.push(preset),
      agentBar: (item) => reg.bar.push(item),
      Scratch,
      Playground: EmbeddedPlayground,
      // Bound to the plugin, whose id scopes its runs' names.
      Run: (props: RunProps) => React.createElement(Run, { ...props, plugin: p.id }),
      git,
      onPlayground: (fn) =>
        onPlayChange((slot, project) => {
          try {
            fn(slot, project)
          } catch (err) {
            console.error(`plugin ${p.id}:`, err)
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
      console.error(`plugin ${p.id}:`, err)
    }
  }
  changed()
}
