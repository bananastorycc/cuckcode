import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SyncStatus } from '../shared/types'

// Two machines (two copies of the module, each with its own clone) syncing through a bare repo.
const home = mkdtempSync(join(tmpdir(), 'cuckcode-sync-'))
const remote = join(home, 'config.git')
const env = { ...process.env }

interface Machine {
  text: string
  received: string[]
  sync: typeof import('./configsync')
  settled: () => Promise<SyncStatus>
}

async function machine(name: string, text: string): Promise<Machine> {
  vi.resetModules()
  const sync = await import('./configsync')
  let waiting: ((s: SyncStatus) => void) | null = null
  const m: Machine = {
    text,
    received: [],
    sync,
    settled: () => new Promise((resolve) => (waiting = resolve))
  }
  sync.setUp(join(home, name), {
    local: () => m.text,
    onRemote: (t) => {
      m.received.push(t)
      m.text = t
    },
    onStatus: (s) => s.state !== 'syncing' && waiting?.(s)
  })
  return m
}

beforeAll(() => {
  Object.assign(process.env, { HOME: home })
  execFileSync('git', ['init', '--bare', '-q', '-b', 'main', remote])
})

afterAll(() => {
  process.env = env
  rmSync(home, { recursive: true, force: true })
})

describe('config sync', () => {
  it('starts an empty repo from the first machine, then carries changes both ways', async () => {
    const a = await machine('a', '{"theme":"dark"}\n')
    let done = a.settled()
    a.sync.connect(remote)
    expect((await done).state).toBe('ok')

    const b = await machine('b', '{"theme":"light"}\n')
    done = b.settled()
    b.sync.connect(remote)
    expect(await done).toMatchObject({ state: 'ok' })
    expect(b.received).toEqual(['{"theme":"dark"}\n'])

    b.text = '{"theme":"light","meters":false}\n'
    b.sync.changed()
    done = b.settled()
    b.sync.now()
    expect((await done).state).toBe('ok')

    done = a.settled()
    a.sync.now()
    expect((await done).state).toBe('ok')
    expect(a.text).toBe('{"theme":"light","meters":false}\n')

    // Both change the same line; A only commits (as at quit), B pushes first. A's side wins.
    a.text = '{"theme":"dark","meters":false}\n'
    a.sync.changed()
    await a.sync.flush()
    b.text = '{"theme":"blue","meters":false}\n'
    b.sync.changed()
    done = b.settled()
    b.sync.now()
    expect((await done).state).toBe('ok')
    done = a.settled()
    a.sync.now()
    expect((await done).state).toBe('ok')
    done = b.settled()
    b.sync.now()
    expect((await done).state).toBe('ok')
    expect(b.text).toBe('{"theme":"dark","meters":false}\n')
  }, 30_000)
})
