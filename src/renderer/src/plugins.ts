import * as React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import * as ReactDOM from 'react-dom'
import { useSyncExternalStore } from 'react'
import type { EditorContext, PluginView, ProjectSource, RendererHost, RendererPlugin } from '../../shared/plugin'
import { addThemeRules, monaco } from './monaco'

// The renderer side of plugins: what they registered, for App and CodePane to use. Loaded once
// at startup; a plugin that throws is reported and skipped.

type Editor = monaco.editor.ICodeEditor
type EditorHook = (editor: Editor, ctx: EditorContext<unknown>) => monaco.IDisposable | void

export interface Registered {
  id: string
  name: string
  source: ProjectSource<unknown> | null
  view: PluginView<unknown> | null
  commands: Map<string, () => void>
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

const MODULES: Record<string, unknown> = {
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
      view: null,
      commands: new Map(),
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
      view: (view) => (reg.view = view),
      onCommand: (id, fn) => reg.commands.set(id, fn),
      onEditor: (fn) => {
        const h = { id: p.id, fn: fn as EditorHook }
        editorHooks.push(h)
        for (const editor of editors.keys()) hook(editor, h)
      }
    }
    try {
      const module = { exports: {} as Partial<RendererPlugin> }
      const require = (name: string): unknown => {
        if (name in MODULES) return MODULES[name]
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
