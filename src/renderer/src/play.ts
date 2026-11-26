import { useEffect, useSyncExternalStore } from 'react'
import type { Theme } from '../../shared/types'

// The open project's playgrounds as App tracks them, for a page a plugin's view embeds
// (RendererHost.Playground) and for plugins that want to hear when a page changes.

export interface PlayState {
  project: string | null
  names: string[] // per slot, from 1 at index 0
  versions: Record<number, number | null> // per slot: when its page last changed; null: no page
  theme: Theme
}

let state: PlayState = { project: null, names: [], versions: {}, theme: 'dark' }
const listeners = new Set<() => void>()
const changes = new Set<(slot: number, project: string) => void>()
// Embedded pages on screen, by `${slot}:${project}`, each counted once per mount.
const embedded = new Map<string, number>()
let handlers = {
  // Done on an embedded page: tells the agent, leaving the screen as it is.
  done: async (_slot: number): Promise<boolean> => false,
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

export const playDone = (slot: number): Promise<boolean> => handlers.done(slot)

export const usePlay = (): PlayState =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state
  )

// A slot's page in the open project changed: what lights the header dot.
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
