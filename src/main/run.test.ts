import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// A stand-in PTY: what was spawned, and a way to end it.
interface Fake {
  file: string
  args: string[]
  opts: { cwd: string; env: Record<string, string> }
  exit: (e: { exitCode: number; signal?: number }) => void
  killed: boolean
}
const spawned: Fake[] = []
vi.mock('node-pty', () => ({
  spawn: (file: string, args: string[], opts: Fake['opts']) => {
    const exits: ((e: { exitCode: number; signal?: number }) => void)[] = []
    const fake: Fake = { file, args, opts, exit: (e) => exits.forEach((fn) => fn(e)), killed: false }
    spawned.push(fake)
    return {
      onData: () => {},
      onExit: (fn: (e: { exitCode: number; signal?: number }) => void) => exits.push(fn),
      resize: () => {},
      write: () => {},
      kill: () => {
        fake.killed = true
        fake.exit({ exitCode: 0, signal: 1 })
      }
    }
  }
}))
vi.mock('electron', () => ({ powerSaveBlocker: { start: () => 0, stop: () => {}, isStarted: () => false } }))

const { prepare, run, stop } = await import('./pty')

const dir = mkdtempSync(join(tmpdir(), 'cuckcode-run-'))
const script = join(dir, 'go.sh')
const SCRIPT = 'echo "ran $0 $1 ü"\n'
const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
const reach = (d: string): boolean => d === dir
const sends: [string, string, unknown][] = []
const send = (channel: 'pty:data' | 'pty:exit', id: string, data?: unknown): void => void sends.push([channel, id, data])
let n = 0
const fresh = (): string => `run.test.r${++n}`

process.env.SHELL = '/bin/bash'
process.env.CUCKCODE_LEAK = '1'

beforeEach(() => {
  writeFileSync(script, SCRIPT)
  spawned.length = 0
  sends.length = 0
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('prepare', () => {
  it('execs argv through the login shell, unparsed', async () => {
    const r = await prepare({ cwd: dir, argv: ['echo', 'a b', '$HOME'] }, reach)
    expect(r).toEqual({ file: '/bin/bash', args: ['-l', '-i', '-c', 'exec "$@"', 'run', 'echo', 'a b', '$HOME'] })
  })

  it('refuses a folder out of reach, or nothing to run', async () => {
    expect(await prepare({ cwd: '/', argv: ['true'] }, reach)).toEqual({ refused: expect.stringContaining("isn't an open project") })
    expect(await prepare({ cwd: dir, argv: [] }, reach)).toEqual({ refused: 'nothing to run' })
  })

  it('hands a pinned script in as its checked bytes, keeping $0', async () => {
    const r = await prepare({ cwd: dir, argv: ['bash', script, 'x'], pin: { path: script, sha256: sha(SCRIPT) } }, reach)
    if (!('args' in r)) throw new Error(r.refused)
    expect(r.args.slice(5)).toEqual(['bash', '-c', SCRIPT, script, 'x'])
    // Changed after the check: what runs is still what was checked.
    writeFileSync(script, 'echo tampered\n')
    const { stdout } = await promisify(execFile)(r.file, r.args, { cwd: dir, env: { ...process.env, HOME: dir } })
    expect(stdout.trim()).toBe(`ran ${script} x ü`)
  })

  it('refuses a changed, missing or unlisted pinned file', async () => {
    const pin = { path: script, sha256: sha(SCRIPT) }
    writeFileSync(script, 'echo other\n')
    expect(await prepare({ cwd: dir, argv: ['bash', script], pin }, reach)).toEqual({ refused: 'file changed since shown' })
    const gone = join(dir, 'gone.sh')
    expect(await prepare({ cwd: dir, argv: ['bash', gone], pin: { path: gone, sha256: pin.sha256 } }, reach)).toEqual({
      refused: `${gone} is missing`
    })
    expect(await prepare({ cwd: dir, argv: ['bash', 'other.sh'], pin }, reach)).toEqual({ refused: expect.stringContaining("isn't one of the arguments") })
  })
})

describe('run', () => {
  it('spawns a matching pin once, in cwd, without the agent variables', async () => {
    const id = fresh()
    const spec = { cwd: dir, argv: ['bash', script], pin: { path: script, sha256: sha(SCRIPT) } }
    expect(await run(id, spec, 80, 24, send, reach)).toEqual({ replay: '' })
    expect(spawned).toHaveLength(1)
    expect(spawned[0].file).toBe('/bin/bash')
    expect(spawned[0].args.slice(5)).toEqual(['bash', '-c', SCRIPT, script])
    expect(spawned[0].opts.cwd).toBe(dir)
    expect(Object.keys(spawned[0].opts.env).filter((k) => k.startsWith('CUCKCODE_'))).toEqual([])
    // Mounting again reattaches.
    await run(id, spec, 80, 24, send, reach)
    expect(spawned).toHaveLength(1)
    spawned[0].exit({ exitCode: 3 })
    expect(sends).toContainEqual(['pty:exit', id, { code: 3 }])
    // Ended: shown again, never rerun.
    expect(await run(id, spec, 80, 24, send, reach)).toEqual({ replay: '', exit: { code: 3 } })
    expect(spawned).toHaveLength(1)
  })

  it('refuses a mismatch or a missing file without spawning, and keeps the refusal', async () => {
    const id = fresh()
    const spec = { cwd: dir, argv: ['bash', script], pin: { path: script, sha256: sha('something else') } }
    expect(await run(id, spec, 80, 24, send, reach)).toEqual({ replay: '', exit: { code: null, refused: 'file changed since shown' } })
    spec.pin.sha256 = sha(SCRIPT)
    expect((await run(id, spec, 80, 24, send, reach)).exit?.refused).toBe('file changed since shown')
    const gone = join(dir, 'gone.sh')
    const missing = await run(fresh(), { cwd: dir, argv: ['bash', gone], pin: { path: gone, sha256: sha(SCRIPT) } }, 80, 24, send, reach)
    expect(missing.exit).toEqual({ code: null, refused: `${gone} is missing` })
    expect(spawned).toHaveLength(0)
  })

  it('starts once when two mounts race', async () => {
    const id = fresh()
    const spec = { cwd: dir, argv: ['true'] }
    await Promise.all([run(id, spec, 80, 24, send, reach), run(id, spec, 80, 24, send, reach)])
    expect(spawned).toHaveLength(1)
  })

  it('stops with code null, and takes only run ids', async () => {
    const id = fresh()
    await run(id, { cwd: dir, argv: ['sleep', '9'] }, 80, 24, send, reach)
    stop(id)
    expect(spawned[0].killed).toBe(true)
    expect(sends).toContainEqual(['pty:exit', id, { code: null }])
    await expect(run('shell:/tmp', { cwd: dir, argv: ['true'] }, 80, 24, send, reach)).rejects.toThrow('Not a run')
  })
})
