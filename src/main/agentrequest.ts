import { randomUUID } from 'node:crypto'
import { chmod, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:net'
import { StringDecoder } from 'node:string_decoder'
import type { AgentRequest } from '../shared/types'

// An agent's hook asking a plugin to answer for it (a permission, a question), through
// $CUCKCODE_HOOK (src/agent/hook.sh). The script sends two lines over a Unix socket: its session
// (the PTY key) and the hook's stdin in base64; then it waits and prints whatever comes back.
// nc shuts its sending side as soon as that input ends, so the server is half-open: the hook's
// 'end' only means its input is done, and the reply still goes out on the open half.
// Each request is held here under a fresh random id until a plugin answers it, or the renderer
// says no plugin is listening, or WAIT_MS passes, or its agent exits, or the socket fails. An
// empty reply is the script's "no decision": the agent asks in its own terminal, as with no hook
// at all. Core never reads the payload; what it means and what to answer is between the plugin
// and the agent.

export const WAIT_MS = 5 * 60_000
// How long the renderer has to say whether any plugin is listening (it answers at once unless
// it's loading or hung).
export const TAKE_MS = 2000
const MAX_BYTES = 4 * 1024 * 1024

// The part of a socket this needs, so tests can hand in their own.
export interface Conn {
  on(event: 'data', fn: (chunk: Buffer) => void): unknown
  on(event: 'end' | 'close' | 'error', fn: () => void): unknown
  end(data: string): unknown
  destroy(): unknown
}

interface Pending {
  conn: Conn
  session: string
  timer: NodeJS.Timeout
}

interface Hooks {
  send: (channel: 'agent:request' | 'agent:requestEnd', arg: AgentRequest | string) => void
  // Whether session is a running agent's PTY.
  live: (session: string) => boolean
}

const pending = new Map<string, Pending>()
let hooks: Hooks | null = null
let server: Server | null = null
let path: string | null = null

export function setUp(h: Hooks): void {
  hooks = h
}

// Ends the request: the reply goes to the script (nothing when output is undefined or null), and
// every plugin hears it's over. A second end for the same id does nothing.
function finish(id: string, output?: unknown): void {
  const p = pending.get(id)
  if (!p) return
  pending.delete(id)
  clearTimeout(p.timer)
  const text = output == null ? '' : typeof output === 'string' ? output : (JSON.stringify(output) ?? '')
  try {
    p.conn.end(text)
  } catch {
    // The hook is already gone.
  }
  hooks?.send('agent:requestEnd', id)
}

function ask(conn: Conn, session: string, raw: string): void {
  const sep = session.indexOf(':')
  if (!hooks || sep < 1 || !hooks.live(session)) {
    conn.end('')
    return
  }
  let payload: unknown = raw
  try {
    payload = JSON.parse(raw)
  } catch {
    // Not JSON: handed on as the text it is.
  }
  const id = randomUUID()
  pending.set(id, { conn, session, timer: setTimeout(() => finish(id), TAKE_MS) })
  conn.on('close', () => finish(id))
  conn.on('error', () => finish(id))
  hooks.send('agent:request', { id, session, agent: session.slice(0, sep), project: session.slice(sep + 1), payload })
}

// One hook's connection: reads its two lines, then asks.
export function handle(conn: Conn): void {
  let buf = ''
  let asked = false
  // The session line holds the project's path, which can be split mid-character across chunks.
  const utf8 = new StringDecoder('utf8')
  conn.on('error', () => conn.destroy())
  // The hook's input is done: before both lines it's a broken request, after them it's nc's
  // half-close, and the request waits on.
  conn.on('end', () => {
    if (!asked) conn.end('')
  })
  conn.on('data', (chunk) => {
    if (asked) return
    buf += utf8.write(chunk)
    const first = buf.indexOf('\n')
    const second = first < 0 ? -1 : buf.indexOf('\n', first + 1)
    if (second < 0) {
      if (buf.length > MAX_BYTES) conn.destroy()
      return
    }
    asked = true
    ask(conn, buf.slice(0, first), Buffer.from(buf.slice(first + 1, second), 'base64').toString('utf8'))
  })
}

// The renderer's word on a request it was sent: taken (a plugin is listening) gives the plugins
// WAIT_MS to answer; not taken ends it at once.
export function taken(id: string, yes: boolean): void {
  const p = pending.get(id)
  if (!p) return
  if (!yes) return finish(id)
  clearTimeout(p.timer)
  p.timer = setTimeout(() => finish(id), WAIT_MS)
}

// A plugin's answer: output goes to the hook as its stdout (a string as is, anything else as
// JSON); null lets the agent ask in its terminal. False when id isn't pending (answered, timed
// out, or gone), and then nothing is sent anywhere.
export function answer(id: string, output: unknown): boolean {
  if (!pending.has(id)) return false
  finish(id, output)
  return true
}

// An agent's PTY ended: a hook killed with it can't be seen on the socket (its half was already
// shut), so its requests end here.
export function drop(session: string): void {
  for (const [id, p] of pending) if (p.session === session) finish(id)
}

// Every pending request goes back to its terminal: the page that was told about them is gone.
export function releaseAll(): void {
  for (const id of [...pending.keys()]) finish(id)
}

// The socket the script connects to, once it's listening; null before, or if it couldn't.
export const socket = (): string | null => path

// Only the user can connect: the socket is 0600 (and userData is theirs alone anyway).
export async function listen(at: string): Promise<void> {
  await rm(at, { force: true })
  const s = createServer({ allowHalfOpen: true }, handle)
  try {
    await new Promise<void>((resolve, reject) => {
      s.once('error', reject)
      s.listen(at, resolve)
    })
    await chmod(at, 0o600)
  } catch (err) {
    console.error('agent requests: no socket at', at, err)
    s.close()
    return
  }
  s.on('error', (err) => console.error('agent requests:', err))
  server = s
  path = at
}

export async function close(): Promise<void> {
  releaseAll()
  const at = path
  path = null
  server?.close()
  server = null
  if (at) await rm(at, { force: true }).catch(() => {})
}
