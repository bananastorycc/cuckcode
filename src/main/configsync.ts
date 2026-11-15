import { mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { SyncStatus } from '../shared/types'
import { writeAtomic } from './atomic'
import { run } from './git'

// Keeps the config file in a git repo of your own: a clone in cuckcode's folder, pulled at launch
// and when the repo is set, committed and pushed a few seconds after a change. One file, so a
// clash resolves hunk by hunk with this machine's side winning. Every step is serialized.

const FILE = 'cuckcode-config.json'
const PUSH_DELAY = 3000

interface Hooks {
  local: () => string // the config file as this machine's settings would write it
  onRemote: (text: string) => void // the repo's file differs: apply it, or throw if it's unreadable
  onStatus: (s: SyncStatus) => void
}

let dir = ''
let url = ''
let hooks: Hooks | null = null
let status: SyncStatus = { state: 'off', message: '', at: 0 }
// The file as last read from or written to the repo; a change back to it needs no push.
let last: string | null = null
// A local change waiting to be committed.
let dirty = false
let timer: ReturnType<typeof setTimeout> | undefined
let queue = Promise.resolve()

export const current = (): SyncStatus => status

function report(state: SyncStatus['state'], message = ''): void {
  status = { state, message, at: Date.now() }
  hooks?.onStatus(status)
}

function enqueue(step: () => Promise<void>): Promise<void> {
  queue = queue.then(step).catch(() => {})
  return queue
}

export function setUp(d: string, h: Hooks): void {
  dir = d
  hooks = h
}

// At launch and whenever the repo setting changes. '' turns syncing off (the clone stays).
export function connect(next: string): void {
  url = next
  clearTimeout(timer)
  dirty = false
  last = null
  if (!url) return report('off')
  void enqueue(sync)
}

// After every settings save: schedules a push if the file would change.
export function changed(): void {
  if (!url || !hooks) return
  clearTimeout(timer)
  if (hooks.local() === last) {
    dirty = false
    return
  }
  dirty = true
  timer = setTimeout(() => void enqueue(sync), PUSH_DELAY)
}

export function now(): void {
  if (!url) return
  clearTimeout(timer)
  void enqueue(sync)
}

// At quit: a pending change is committed here, never pushed (quitting doesn't wait on the
// network). The next launch's sync pushes it.
export function flush(): Promise<void> {
  if (!url || !dirty) return queue
  clearTimeout(timer)
  return enqueue(async () => {
    await clone()
    await commit(await identity())
  })
}

async function clone(): Promise<void> {
  const have = await run(dir, ['remote', 'get-url', 'origin']).then((s) => s.trim(), () => '')
  if (have === url) return
  await rm(dir, { recursive: true, force: true })
  await mkdir(dirname(dir), { recursive: true })
  await run(dirname(dir), ['clone', url, dir], 60_000)
}

// Commits work with or without a git identity set up on this machine.
async function identity(): Promise<string[]> {
  const email = await run(dir, ['config', 'user.email']).then((s) => s.trim(), () => '')
  return email ? [] : ['-c', 'user.name=cuckcode', '-c', 'user.email=cuckcode@localhost']
}

const exists = (ref: string): Promise<boolean> => run(dir, ['rev-parse', '--verify', '-q', ref]).then(() => true, () => false)

async function commit(id: string[]): Promise<void> {
  if (!dirty || !hooks) return
  dirty = false
  const text = hooks.local()
  await writeAtomic(join(dir, FILE), text)
  last = text
  await run(dir, ['add', FILE])
  if (await run(dir, ['diff', '--cached', '--quiet']).then(() => false, () => true)) {
    await run(dir, [...id, 'commit', '-m', 'Update cuckcode config'])
  }
}

async function sync(): Promise<void> {
  if (!hooks) return
  const at = url
  report('syncing')
  try {
    await clone()
    const id = await identity()
    await commit(id)
    await run(dir, ['fetch', 'origin'], 60_000)
    const branch = (await run(dir, ['symbolic-ref', '--short', 'HEAD'])).trim()
    const upstream = `refs/remotes/origin/${branch}`
    const hasUpstream = await exists(upstream)
    if (hasUpstream && (await exists('HEAD'))) {
      // In a rebase "theirs" is the commit being replayed: this machine's.
      await run(dir, [...id, 'rebase', '-X', 'theirs', upstream]).catch(async (err) => {
        await run(dir, ['rebase', '--abort']).catch(() => {})
        throw err
      })
    } else if (hasUpstream) {
      await run(dir, ['reset', '--hard', upstream])
    }
    if (url !== at) return
    const text = await readFile(join(dir, FILE), 'utf8').catch(() => null)
    if (text === null) {
      // An empty repo: this machine's settings start it.
      dirty = true
      await commit(id)
    } else if (text !== hooks.local()) {
      last = text
      try {
        hooks.onRemote(text)
      } catch {
        // A merge that broke the file: this machine's settings replace it.
        dirty = true
        await commit(id)
      }
    } else last = text
    const ahead = !hasUpstream ? await exists('HEAD') : (await run(dir, ['rev-list', '--count', `${upstream}..HEAD`])).trim() !== '0'
    if (ahead) await run(dir, ['push', 'origin', 'HEAD'], 60_000)
    if (url === at) report('ok')
  } catch (err) {
    if (url === at) report('error', err instanceof Error ? err.message : String(err))
  }
}
