import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { Settings } from '../shared/types'

// Reloading plugins' main sides, with an agent's PTY running beside them: a stand-in for
// node-pty, so the session is the real pty.ts bookkeeping around a fake process.

interface Fake {
  data: (d: string) => void
  killed: boolean
}
const spawned: Fake[] = []
vi.mock('node-pty', () => ({
  spawn: () => {
    const listeners: ((d: string) => void)[] = []
    const fake: Fake = { data: (d) => listeners.forEach((fn) => fn(d)), killed: false }
    spawned.push(fake)
    return {
      onData: (fn: (d: string) => void) => listeners.push(fn),
      onExit: () => {},
      resize: () => {},
      write: () => {},
      kill: () => void (fake.killed = true)
    }
  }
}))
vi.mock('electron', () => ({ powerSaveBlocker: { start: () => 0, stop: () => {}, isStarted: () => false } }))

const pty = await import('./pty')
const plugins = await import('./plugins')

const root = mkdtempSync(join(tmpdir(), 'cuckcode-reload-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const log: string[] = []
;(globalThis as { __reloadLog?: string[] }).__reloadLog = log

// A plugin folder whose main side logs its activate and deactivate, under its version.
function plugin(id: string, version: number, body: string, requires: string[] = []): string {
  const dir = join(root, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'cuckcode-plugin.json'), JSON.stringify({ id, name: id, main: 'main.js', requires }))
  writeFileSync(
    join(dir, 'main.js'),
    `const log = globalThis.__reloadLog
exports.activate = (host) => {
  log.push('${id}${version} up')
  ${body}
}
exports.deactivate = () => log.push('${id}${version} down')
`
  )
  return dir
}

const a = (v: number): string => plugin('a', v, `host.provide({ v: 'a${v}' }); host.handle('v', () => 'a${v}'); host.handle('keep', (x) => host.store.set('kept', x)); globalThis.__aStore = host.store${v === 1 ? `; host.handle('old', () => 'still here')` : ''}`)
const b = plugin('b', 1, `const a = host.use('a'); host.handle('v', () => 'b sees ' + a.v)`, ['a'])
const c = plugin('c', 1, `host.handle('v', () => 'c')`)
a(1)
const refs = [
  { path: join(root, 'a'), enabled: true },
  { path: b, enabled: true },
  { path: c, enabled: true }
]

const AGENT = `claude:${root}`
const config = (): Settings => ({ agents: [{ id: 'claude', name: 'Claude Code', command: 'claude' }], playgrounds: [] }) as unknown as Settings
const sent: string[] = []

describe('reloading plugins', () => {
  it('loads at launch in dependency order, with an agent running', async () => {
    plugins.setDataDir(join(root, 'data'))
    pty.start(AGENT, 80, 24, (channel, _id, data) => void (channel === 'pty:data' && sent.push(String(data))), config)
    spawned[0].data('before the reload\n')
    await plugins.start(Promise.resolve(), () => refs)
    expect(log).toEqual(['a1 up', 'b1 up', 'c1 up'])
    expect(await plugins.invoke('b', 'v', [])).toBe('b sees a1')
  })

  it('runs an edited plugin after a reload, with what requires it, and leaves the agent alone', async () => {
    a(2)
    log.length = 0
    expect(await plugins.reload(join(root, 'a'))).toEqual(['a', 'b'])
    // What requires it goes first and comes back last; the others stay as they are.
    expect(log).toEqual(['b1 down', 'a1 down', 'a2 up', 'b1 up'])
    expect(await plugins.invoke('a', 'v', [])).toBe('a2')
    expect(await plugins.invoke('b', 'v', [])).toBe('b sees a2')
    expect(await plugins.invoke('c', 'v', [])).toBe('c')
    // The old version's handler went with it.
    await expect(plugins.invoke('a', 'old', [])).rejects.toThrow('a has no old')

    // The agent's PTY wasn't killed or spawned again, and its session goes on.
    expect(spawned).toHaveLength(1)
    expect(spawned[0].killed).toBe(false)
    expect(pty.isAgent(AGENT)).toBe(true)
    spawned[0].data('after the reload\n')
    await new Promise((r) => setTimeout(r, 20))
    expect(pty.start(AGENT, 80, 24, () => {}, config)).toBe('before the reload\nafter the reload\n')
    expect(spawned).toHaveLength(1)
  })

  it('leaves nothing twice after reloading twice', async () => {
    log.length = 0
    await plugins.reload(join(root, 'a'))
    await plugins.reload(join(root, 'a'))
    expect(log).toEqual(['b1 down', 'a2 down', 'a2 up', 'b1 up', 'b1 down', 'a2 down', 'a2 up', 'b1 up'])
    const list = await plugins.list()
    expect(list.map((s) => s.id)).toEqual(['a', 'b', 'c'])
    expect((await plugins.renderers()).map((p) => p.id)).toEqual(['c', 'a', 'b'])
    expect(spawned).toHaveLength(1)
  })

  it('reloads every plugin as the settings list them, dropping a disabled one', async () => {
    refs[2] = { ...refs[2], enabled: false }
    log.length = 0
    expect(await plugins.reload(null)).toEqual(['a', 'b'])
    expect(log).toEqual(['b1 down', 'a2 down', 'c1 down', 'a2 up', 'b1 up'])
    await expect(plugins.invoke('c', 'v', [])).rejects.toThrow('c has no v')
    expect((await plugins.list()).find((s) => s.path === c)).toEqual({ path: c, enabled: false })
    expect(spawned[0].killed).toBe(false)
  })

  it("reports a deactivate that throws, and loads the new version anyway", async () => {
    writeFileSync(join(c, 'main.js'), `exports.activate = (host) => host.handle('v', () => 'c2')\nexports.deactivate = () => { throw new Error('boom') }\n`)
    refs[2] = { ...refs[2], enabled: true }
    await plugins.reload(c)
    await plugins.reload(c)
    expect(await plugins.invoke('c', 'v', [])).toBe('c2')
    expect((await plugins.list()).find((s) => s.path === c)?.note).toBe("Its old version's deactivate failed: boom")
  })

  it("keeps a plugin's store across reloads, shared with its renderer side, and refuses the old version's calls", async () => {
    const old = (globalThis as { __aStore?: { get: (k: string) => Promise<unknown> } }).__aStore!
    await plugins.invoke('a', 'keep', [{ n: 1 }])
    expect(await plugins.store('a', 'get', 'kept')).toEqual({ n: 1 })
    await plugins.reload(join(root, 'a'))
    await expect(old.get('kept')).rejects.toThrow('was unloaded')
    expect(await plugins.store('a', 'get', 'kept')).toEqual({ n: 1 })
    await plugins.store('a', 'set', 'kept', 2)
    expect(await (globalThis as { __aStore?: { get: (k: string) => Promise<unknown> } }).__aStore!.get('kept')).toBe(2)
    await expect(plugins.store('nope', 'get', 'kept')).rejects.toThrow("nope isn't loaded")
    await expect(plugins.store('a', 'get', '../b/kept')).rejects.toThrow('a key must match')
  })

  it('refuses a folder that is not one of the plugins', async () => {
    await expect(plugins.reload(join(root, 'nope'))).rejects.toThrow("isn't one of your plugins")
  })
})
