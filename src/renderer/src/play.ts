import { createContext, useEffect, useSyncExternalStore } from 'react'
import type { Theme } from '../../shared/types'

// The playgrounds as App tracks them, for a page a plugin's view embeds (RendererHost.Playground)
// and for plugins that want to hear when a page changes.

export interface PlayState {
  project: string | null // the tab in front
  names: string[] // per slot, from 1 at index 0
  // Per playKey: when the slot's page last changed; null: no page. Tracked for the tab in front and
  // the projects plugin pages away from home are showing.
  versions: Record<string, number | null>
  theme: Theme
}

// The project a plugin's page is for, around its render: its home, when it's shown away from it.
// Undefined outside a page, where the tab in front's project counts.
export const PageProject = createContext<string | null | undefined>(undefined)

let state: PlayState = { project: null, names: [], versions: {}, theme: 'dark' }
const listeners = new Set<() => void>()
const changes = new Set<(slot: number, project: string) => void>()
// Embedded pages on screen, by `${slot}:${project}`, each counted once per mount.
const embedded = new Map<string, number>()
let handlers = {
  // Done on an embedded page: tells the project's agent, leaving the screen as it is.
  done: async (_slot: number, _project: string): Promise<boolean> => false,
  // An embedded page is up, so its header dot goes out.
  seen: (_key: string): void => {}
}

export const playKey = (slot: number, project: string): string => `${slot}:${project}`

export function setPlay(next: PlayState): void {
  if (JSON.stringify(next) === JSON.stringify(state)) return
  state = next
  listeners.forEach((l) => l())
}

export function setPlayHandlers(next: typeof handlers): void {
  handlers = next
}

export const playDone = (slot: number, project: string): Promise<boolean> => handlers.done(slot, project)

export const usePlay = (): PlayState =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state
  )

// A slot's page changed, in the tab in front or a project a page away from home shows: what
// lights the header dot.
export function playChanged(slot: number, project: string): void {
  changes.forEach((fn) => fn(slot, project))
}

export function onPlayChange(fn: (slot: number, project: string) => void): () => void {
  changes.add(fn)
  return () => void changes.delete(fn)
}

export const isEmbedded = (key: string): boolean => embedded.has(key)

// While mounted with a key, that page counts as on screen: its changes don't light the header dot.
export function useEmbedded(key: string | null): void {
  useEffect(() => {
    if (!key) return
    embedded.set(key, (embedded.get(key) ?? 0) + 1)
    handlers.seen(key)
    return () => {
      const n = (embedded.get(key) ?? 1) - 1
      if (n) embedded.set(key, n)
      else embedded.delete(key)
    }
  }, [key])
}
