import { mkdir, readFile, rm } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { PluginStore } from '../shared/plugin'
import { writeAtomic } from './atomic'

// A plugin's own JSON values (MainHost.store, RendererHost.store): one file per key in the
// plugin's folder under the app's data, written atomically. Keys are plain names, so a key can't
// reach out of its folder. Operations on one key run in order, so the last set wins, whoever awaits.

const KEY = /^[\w-][\w.-]*$/

const queues = new Map<string, Promise<unknown>>()

// Runs fn after whatever is queued for file.
function queued<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const next = (queues.get(file) ?? Promise.resolve()).then(fn, fn)
  const settled = next.catch(() => {})
  queues.set(file, settled)
  void settled.then(() => queues.get(file) === settled && queues.delete(file))
  return next
}

// The store kept in dir (one plugin's folder). dead: the plugin was unloaded, so its old code's calls are refused.
export function pluginStore(dir: string, dead: () => boolean = () => false): PluginStore {
  const file = (key: unknown): string => {
    if (dead()) throw new Error('store: this plugin was unloaded (reloaded, or turned off)')
    if (!isAbsolute(dir)) throw new Error('store: no data folder')
    if (typeof key !== 'string' || !KEY.test(key)) throw new Error(`store: a key must match [\\w.-]+ and not start with a dot (got ${JSON.stringify(key)})`)
    return join(dir, `${key}.json`)
  }
  return {
    get: async <T>(key: string) => {
      const f = file(key)
      return queued(f, async () => {
        const text = await readFile(f, 'utf8').catch((err: NodeJS.ErrnoException) => {
          if (err.code === 'ENOENT') return null
          throw err
        })
        return text === null ? undefined : (JSON.parse(text) as T)
      })
    },
    set: async (key, value) => {
      const f = file(key)
      const text = JSON.stringify(value)
      if (text === undefined) throw new Error(`store: ${key}'s value isn't JSON (use delete to remove it)`)
      return queued(f, async () => {
        await mkdir(dir, { recursive: true })
        await writeAtomic(f, text)
      })
    },
    delete: async (key) => {
      const f = file(key)
      return queued(f, () => rm(f, { force: true }))
    }
  }
}
