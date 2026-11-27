import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentRequest } from '../shared/types'
import { answer, handle, releaseAll, setUp, taken, TAKE_MS, WAIT_MS, type Conn } from './agentrequest'

// A stand-in for the hook's socket: what it was sent back, and whether it was closed.
class Fake extends EventEmitter implements Conn {
  reply: string | null = null
  destroyed = false
  end(data: string): void {
    this.reply = data
    this.emit('close')
  }
  destroy(): void {
    this.destroyed = true
    this.emit('close')
  }
}

const SESSION = 'claude-1:/work/demo'
const requests: AgentRequest[] = []
const ended: string[] = []
let live = new Set([SESSION])

setUp({
  send: (channel, arg) => (channel === 'agent:request' ? requests.push(arg as AgentRequest) : ended.push(arg as string)),
  live: (s) => live.has(s)
})

// What hook.sh sends: the session, then stdin in base64, a line each.
function hook(payload: string, session = SESSION, chunks = 1): Fake {
  const conn = new Fake()
  handle(conn)
  const wire = `${session}\n${Buffer.from(payload).toString('base64')}\n`
  const size = Math.ceil(wire.length / chunks)
  for (let i = 0; i < wire.length; i += size) conn.emit('data', Buffer.from(wire.slice(i, i + size)))
  return conn
}

const last = (): AgentRequest => requests[requests.length - 1]

beforeEach(() => {
  vi.useFakeTimers()
  requests.length = 0
  ended.length = 0
  live = new Set([SESSION])
})

afterEach(() => {
  releaseAll()
  vi.useRealTimers()
})

describe('agent requests', () => {
  it('hands the hook its answer, matched by id', async () => {
    const a = hook('{"tool_name":"Bash","n":1}')
    const b = hook('{"tool_name":"Edit","n":2}', SESSION, 7)
    const [ra, rb] = requests
    expect(ra).toEqual({ id: expect.any(String), session: SESSION, agent: 'claude-1', project: '/work/demo', payload: { tool_name: 'Bash', n: 1 } })
    expect(rb.payload).toEqual({ tool_name: 'Edit', n: 2 })
    expect(ra.id).not.toBe(rb.id)
    taken(ra.id, true)
    taken(rb.id, true)
    expect(answer(rb.id, { decision: 'allow' })).toBe(true)
    expect(b.reply).toBe('{"decision":"allow"}')
    expect(a.reply).toBeNull()
    expect(answer(ra.id, 'as is\n')).toBe(true)
    expect(a.reply).toBe('as is\n')
    expect(ended).toEqual([rb.id, ra.id])
  })

  it('passes a payload that is not JSON on as text', () => {
    hook('not json ü')
    expect(last().payload).toBe('not json ü')
  })

  it('refuses a stale answer and sends nothing', () => {
    const conn = hook('{}')
    const { id } = last()
    taken(id, true)
    expect(answer(id, { first: true })).toBe(true)
    expect(answer(id, { second: true })).toBe(false)
    expect(conn.reply).toBe('{"first":true}')
    expect(answer('no-such-id', {})).toBe(false)
    expect(ended).toEqual([id])
  })

  it('null leaves it to the terminal: an empty reply', () => {
    const conn = hook('{}')
    taken(last().id, true)
    expect(answer(last().id, null)).toBe(true)
    expect(conn.reply).toBe('')
  })

  it('times out to an empty reply, after which an answer is stale', () => {
    const conn = hook('{}')
    const { id } = last()
    taken(id, true)
    vi.advanceTimersByTime(WAIT_MS - 1)
    expect(conn.reply).toBeNull()
    vi.advanceTimersByTime(1)
    expect(conn.reply).toBe('')
    expect(ended).toEqual([id])
    expect(answer(id, { late: true })).toBe(false)
    expect(conn.reply).toBe('')
  })

  it('with no plugin subscribed, replies empty at once', () => {
    const conn = hook('{}')
    taken(last().id, false)
    expect(conn.reply).toBe('')
    expect(answer(last().id, {})).toBe(false)
  })

  it('replies empty when the page never says whether anyone took it', () => {
    const conn = hook('{}')
    vi.advanceTimersByTime(TAKE_MS)
    expect(conn.reply).toBe('')
  })

  it('ends a request whose hook went away', () => {
    const conn = hook('{}')
    const { id } = last()
    taken(id, true)
    conn.emit('close')
    expect(ended).toEqual([id])
    expect(answer(id, {})).toBe(false)
  })

  it("asks nothing for a session that isn't a running agent", () => {
    const conn = hook('{}', 'claude-2:/work/demo')
    expect(requests).toEqual([])
    expect(conn.reply).toBe('')
  })

  it('releases every pending request (the page reloaded)', () => {
    const a = hook('{}')
    const b = hook('{}')
    taken(requests[0].id, true)
    releaseAll()
    expect([a.reply, b.reply]).toEqual(['', ''])
    expect(ended).toHaveLength(2)
  })
})

describe('hook.sh', () => {
  const script = join(__dirname, '../agent/hook.sh')
  const run = (env: Record<string, string>): Promise<{ stdout: string }> =>
    promisify(execFile)(script, [], { env: { PATH: process.env.PATH ?? '', ...env }, timeout: 5000 })

  it('exits at once with no output when there is no socket', async () => {
    vi.useRealTimers()
    const t = Date.now()
    expect((await run({ CUCKCODE_SESSION: SESSION, CUCKCODE_SOCKET: join(__dirname, 'no-such.sock') })).stdout).toBe('')
    expect((await run({})).stdout).toBe('')
    expect(Date.now() - t).toBeLessThan(2000)
  })
})
