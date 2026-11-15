import { watch, type FSWatcher } from 'node:fs'
import { TMP_SUFFIX } from './atomic'

// fs.watch with `recursive` is a single FSEvents stream on macOS: no directory crawl,
// no per-file handles, so it costs nothing even on repos with huge node_modules.

const DEBOUNCE_MS = 150
// A watcher that failed (or a folder that's missing) is tried again this often while its project is open.
const RETRY_MS = 2000

export function isRelevant(rel: string | null): boolean {
  if (!rel) return true
  const segs = rel.split('/')
  if (segs[0] === '.git') {
    // Only what changes on commit, checkout, or staging from the terminal.
    return rel === '.git/index' || rel === '.git/HEAD' || rel.startsWith('.git/refs/')
  }
  // Playground pages save answers there on every keystroke; nothing shown depends on them.
  if (/^\.cuckcode\/playground\/\d+\/data\//.test(rel)) return false
  // A save's temp file; the rename over the real file reports that one.
  if (rel.endsWith(TMP_SUFFIX)) return false
  return !segs.includes('node_modules') && !segs.includes('.git') && segs[segs.length - 1] !== '.DS_Store'
}

// Past this many paths in one burst (a checkout, an unzip), listing them isn't worth it.
const MAX_PATHS = 500

type OnChange = (project: string, paths: string[] | null) => void

interface Entry {
  watcher: FSWatcher
  timer?: NodeJS.Timeout
  // Paths changed since the last report, relative to the project; null when unknown.
  changed: Set<string> | null
}

const watchers = new Map<string, Entry>()
const retries = new Map<string, NodeJS.Timeout>()
let wanted: string[] = []
let notify: OnChange = () => {}

export function setWatched(projects: string[], onChange: OnChange): void {
  wanted = projects
  notify = onChange
  for (const [dir, timer] of retries) {
    if (!projects.includes(dir)) {
      clearTimeout(timer)
      retries.delete(dir)
    }
  }
  for (const [dir, entry] of watchers) if (!projects.includes(dir)) close(dir, entry)
  for (const dir of projects) if (!watchers.has(dir) && !retries.has(dir)) add(dir, false)
}

function close(dir: string, entry: Entry): void {
  clearTimeout(entry.timer)
  entry.watcher.close()
  if (watchers.get(dir) === entry) watchers.delete(dir)
}

function add(dir: string, recovered: boolean): void {
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
          notify(dir, paths)
        }, DEBOUNCE_MS)
      })
    }
    entry.watcher.on('error', () => {
      close(dir, entry)
      retry(dir)
    })
    watchers.set(dir, entry)
    // Whatever changed while it wasn't watched went unreported.
    if (recovered) notify(dir, null)
  } catch {
    // Directory missing for now.
    retry(dir)
  }
}

function retry(dir: string): void {
  if (!wanted.includes(dir) || retries.has(dir)) return
  retries.set(
    dir,
    setTimeout(() => {
      retries.delete(dir)
      if (wanted.includes(dir) && !watchers.has(dir)) add(dir, true)
    }, RETRY_MS)
  )
}

export function closeAll(): void {
  setWatched([], () => {})
}
