import type { Disposable, MainHost, MenuItem, PluginPanel, PluginStore, RendererHost } from 'cuckcode/plugin'

// Stand-ins for cuckcode's hosts, with only what this plugin uses: what it registers is kept here
// for the test to look at, and each registration's Disposable takes it out again, as cuckcode's do.
// Anything else the plugin reaches for throws, so a test notices a new dependency on the host.

export function fakeStore(): PluginStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>()
  return {
    data,
    get: async <T>(key: string) => data.get(key) as T | undefined,
    // As the real one keeps it: JSON.
    set: async (key, value) => void data.set(key, JSON.parse(JSON.stringify(value))),
    delete: async (key) => void data.delete(key)
  }
}

function strict<T extends object>(host: Partial<T>): T {
  return new Proxy(host, {
    get: (t, k) => {
      if (!(k in t)) throw new Error(`the fake host has no ${String(k)}`)
      return t[k as keyof typeof t]
    }
  }) as T
}

const listed = <A>(list: A[], a: A): Disposable => {
  list.push(a)
  return () => void (list.includes(a) && list.splice(list.indexOf(a), 1))
}

export interface Fake {
  host: RendererHost
  main: MainHost
  store: ReturnType<typeof fakeStore>
  panels: PluginPanel<unknown>[]
  menus: MenuItem[]
  saved: ((path: string) => void)[]
  shown: string[]
}

export function fakeRenderer(store = fakeStore()): Fake {
  const panels: PluginPanel<unknown>[] = []
  const menus: MenuItem[] = []
  const saved: ((path: string) => void)[] = []
  const shown: string[] = []
  const handlers = new Map<string, (...args: never[]) => unknown>()
  const host = strict<RendererHost>({
    store,
    panel: ((p: PluginPanel<unknown>) => listed(panels, p)) as RendererHost['panel'],
    contextMenu: (item) => listed(menus, item),
    onFileSaved: (fn) => listed(saved, fn),
    show: (command) => (shown.push(command), true),
    // As cuckcode's does: calls what the main side handled.
    invoke: async <R>(name: string, ...args: unknown[]) => {
      const fn = handlers.get(name)
      if (!fn) throw new Error(`example has no ${name}`)
      return (fn as (...a: unknown[]) => R)(...args)
    }
  })
  const main = strict<MainHost>({ handle: (name, fn) => (handlers.set(name, fn), () => void handlers.delete(name)) })
  return { host, main, store, panels, menus, saved, shown }
}
