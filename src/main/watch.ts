import { watch, type FSWatcher } from 'node:fs'

// fs.watch with `recursive` is a single FSEvents stream on macOS: no directory crawl,
// no per-file handles, so it costs nothing even on repos with huge node_modules.

const DEBOUNCE_MS = 150

export function isRelevant(rel: string | null): boolean {
  if (!rel) return true
  const segs = rel.split('/')
  if (segs[0] === '.git') {
    // Only what changes on commit, checkout, or staging from the terminal.
    return rel === '.git/index' || rel === '.git/HEAD' || rel.startsWith('.git/refs/')
  }
  // Playground pages save answers there on every keystroke; nothing shown depends on them.
  if (/^\.cuckcode\/playground\/\d+\/data\//.test(rel)) return false
  return !segs.includes('node_modules') && !segs.includes('.git') && segs[segs.length - 1] !== '.DS_Store'
}

// Past this many paths in one burst (a checkout, an unzip), listing them isn't worth it.
const MAX_PATHS = 500

interface Entry {
  watcher: FSWatcher
  timer?: NodeJS.Timeout
  // Paths changed since the last report, relative to the project; null when unknown.
  changed: Set<string> | null
}

const watchers = new Map<string, Entry>()

export function setWatched(projects: string[], onChange: (project: string, paths: string[] | null) => void): void {
  for (const [dir, entry] of watchers) {
    if (!projects.includes(dir)) {
      clearTimeout(entry.timer)
      entry.watcher.close()
      watchers.delete(dir)
    }
  }
  for (const dir of projects) {
    if (watchers.has(dir)) continue
    try {
      const entry: Entry = {
        changed: new Set(),
        watcher: watch(dir, { recursive: true }, (_event, file) => {
          if (!isRelevant(file)) return
          if (!file || !entry.changed || entry.changed.size >= MAX_PATHS) entry.changed = null
          else entry.changed.add(file)
          clearTimeout(entry.timer)
          entry.timer = setTimeout(() => {
            const paths = entry.changed && [...entry.changed]
            entry.changed = new Set()
            onChange(dir, paths)
          }, DEBOUNCE_MS)
        })
      }
      entry.watcher.on('error', () => {
        clearTimeout(entry.timer)
        entry.watcher.close()
        watchers.delete(dir)
      })
      watchers.set(dir, entry)
    } catch {
      // Directory vanished; nothing to watch.
    }
  }
}

export function closeAll(): void {
  setWatched([], () => {})
}
