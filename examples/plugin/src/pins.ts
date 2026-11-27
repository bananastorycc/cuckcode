import type { PluginStore } from 'cuckcode/plugin'

// The pinned files (absolute paths), kept in the plugin's store so they outlast reloads and
// relaunches. Kept apart from the React code, so a test can drive it with a fake store.
export interface Pins {
  list: () => string[]
  load: () => Promise<void>
  toggle: (path: string) => Promise<void>
  subscribe: (fn: () => void) => () => void
}

export function createPins(store: PluginStore): Pins {
  let list: string[] = []
  const listeners = new Set<() => void>()
  const set = (next: string[]): void => {
    list = next
    listeners.forEach((l) => l())
  }
  return {
    list: () => list,
    load: async () => set((await store.get<string[]>('pins')) ?? []),
    toggle: async (path) => {
      const next = list.includes(path) ? list.filter((p) => p !== path) : [...list, path]
      set(next)
      await store.set('pins', next)
    },
    subscribe: (fn) => {
      listeners.add(fn)
      return () => void listeners.delete(fn)
    }
  }
}
