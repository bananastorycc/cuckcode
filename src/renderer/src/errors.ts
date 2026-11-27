import { useSyncExternalStore } from 'react'
import { toast } from './components/Toasts'

// ipcRenderer.invoke wraps what main threw: "Error invoking remote method 'x': Error: <message>".
export const message = (err: unknown): string =>
  String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

// What went wrong in a plugin's renderer side since it last loaded, per plugin id, newest first: a throw
// in one of its pages, hooks or handlers, a registration cuckcode refused. The Plugins page lists
// them; each new one also toasts. Kept apart from the plugin registry so that recording one never
// rerenders App, which would ask the page again and could throw again.

export interface PluginError {
  text: string
  count: number
  last: number // Date.now()
}

const MAX = 20
// The same error toasts again only after this long, so one thrown on every output line or render
// doesn't bury the screen.
const RETOAST_MS = 60_000

let errors: Record<string, PluginError[]> = {}
const listeners = new Set<() => void>()
let queued = false

// Often called while React renders (a page's when, a crashed view): what it changes is shown
// once that's done.
function notify(): void {
  if (queued) return
  queued = true
  queueMicrotask(() => {
    queued = false
    listeners.forEach((l) => l())
  })
}

export function pluginError(plugin: { id: string; name: string }, where: string, err: unknown): void {
  console.error(`plugin ${plugin.id} (${where}):`, err)
  const text = `${where}: ${message(err)}`
  const now = Date.now()
  const list = errors[plugin.id] ?? []
  const seen = list.find((e) => e.text === text)
  if (!seen || now - seen.last >= RETOAST_MS) queueMicrotask(() => toast(false, plugin.name, text))
  const entry = seen ? { ...seen, count: seen.count + 1, last: now } : { text, count: 1, last: now }
  errors = { ...errors, [plugin.id]: [entry, ...list.filter((e) => e !== seen)].slice(0, MAX) }
  notify()
}

// A reload starts the plugin's list afresh.
export function clearErrors(id: string): void {
  if (!(id in errors)) return
  const { [id]: _, ...rest } = errors
  errors = rest
  notify()
}

export const usePluginErrors = (): Record<string, PluginError[]> =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => errors
  )
