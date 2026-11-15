import * as pty from 'node-pty'
import type { Settings } from '../shared/types'
import { SHELL_ID } from '../shared/types'
import * as awake from './awake'
import { shellEnv } from './env'
import * as playground from './playground'

// Up to one PTY per (agent, project), keyed `${agent id}:${project path}`. Sessions outlive renderer reloads:
// a reattaching terminal gets the recent output tail replayed.

const FLUSH_MS = 4
const TAIL_CHARS = 256 * 1024

interface Session {
  proc: pty.IPty
  tail: string[]
  tailLength: number
  pending: string
  timer?: NodeJS.Timeout
}

type Sink = (channel: 'pty:data' | 'pty:exit', id: string, data?: string) => void
type Config = () => Settings

const sessions = new Map<string, Session>()

// Login+interactive so the user's PATH and config load, then the agent; when it exits you
// land in a normal shell in the same directory. Everything configured reaches the command
// through the environment, which spares quoting it in.
const RUN = {
  claude: 'claude --settings "$CUCKCODE_HOOKS" --append-system-prompt "$CUCKCODE_PLAYGROUND"',
  junie: 'junie --auth-license="$CUCKCODE_LICENSE"',
  command: 'eval "$CUCKCODE_COMMAND"'
}

// Claude only signals "done" or "needs input" in terminals it recognizes (or with
// preferredNotifChannel set), and it doesn't know this one. These hooks signal it themselves: an
// OSC 777 notification, which Terminal.tsx turns into the tab dot and a macOS notification. Hooks
// run detached, without /dev/tty, so they write to the terminal of their parent, claude.
const osc = (body: string): string =>
  `t=$(ps -o tty= -p $PPID | tr -d ' ') && printf '\\033]777;notify;Claude;${body}\\007' 2>/dev/null > "/dev/$t" || true`
const HOOKS = JSON.stringify({
  hooks: {
    Stop: [{ hooks: [{ type: 'command', command: osc('Claude is done') }] }],
    // Not idle_prompt: that's a reminder a minute after Stop already said so.
    Notification: [{ matcher: 'permission_prompt|elicitation_dialog', hooks: [{ type: 'command', command: osc('Claude needs your input') }] }]
  }
})

function spawn(id: string, cols: number, rows: number, send: Sink, config: Config): Session {
  const shell = process.env.SHELL || '/bin/zsh'
  const sep = id.indexOf(':')
  const agentId = id.slice(0, sep)
  const cwd = id.slice(sep + 1)
  const env = shellEnv()
  let args = ['-l', '-i']
  const agent = agentId === SHELL_ID ? null : config().agents.find((a) => a.id === agentId)
  if (agentId !== SHELL_ID && !agent) throw new Error(`No agent ${agentId}`)
  if (agent) {
    const slots = config().playgrounds
    if (agent.type === 'claude' && slots.length) {
      env.CUCKCODE_PLAYGROUND = playground.prompt(cwd, slots)
      playground.exclude(cwd)
    }
    if (agent.type === 'claude') env.CUCKCODE_HOOKS = HOOKS
    if (agent.type === 'junie') env.CUCKCODE_LICENSE = agent.license ?? ''
    if (agent.type === 'command') env.CUCKCODE_COMMAND = agent.command ?? ''
    args = [...args, '-c', `${RUN[agent.type]}; exec "$SHELL" -l`]
  }
  const claude = agent?.type === 'claude'
  const proc = pty.spawn(shell, args, { name: 'xterm-256color', cols, rows, cwd, env })
  const s: Session = { proc, tail: [], tailLength: 0, pending: '' }

  const flush = (): void => {
    s.timer = undefined
    const data = s.pending
    s.pending = ''
    s.tail.push(data)
    s.tailLength += data.length
    while (s.tailLength > TAIL_CHARS && s.tail.length > 1) s.tailLength -= s.tail.shift()!.length
    send('pty:data', id, data)
  }

  proc.onData((data) => {
    // A killed shell can still print on its way out; after a restart that would land in
    // the new session's terminal, which shares the id.
    if (sessions.get(id) !== s) return
    if (claude) awake.poke()
    s.pending += data
    s.timer ??= setTimeout(flush, FLUSH_MS)
  })
  proc.onExit(() => {
    if (sessions.get(id) !== s) return
    if (s.timer) {
      clearTimeout(s.timer)
      flush()
    }
    sessions.delete(id)
    send('pty:exit', id)
  })
  sessions.set(id, s)
  return s
}

// node-pty resizes with an ioctl on the master fd, which closes a moment before onExit
// fires; a resize in that gap throws (EBADF) straight into the main process.
function fit(proc: pty.IPty, cols: number, rows: number): void {
  try {
    proc.resize(cols, rows)
  } catch {
    // Exiting; onExit follows.
  }
}

export function start(id: string, cols: number, rows: number, send: Sink, config: Config): string {
  const existing = sessions.get(id)
  if (existing) {
    fit(existing.proc, cols, rows)
    // Not `pending`: the terminal is already subscribed, so that arrives with the next flush.
    return existing.tail.join('')
  }
  spawn(id, cols, rows, send, config)
  return ''
}

export function restart(id: string, cols: number, rows: number, send: Sink, config: Config): void {
  kill(id)
  spawn(id, cols, rows, send, config)
}

export function write(id: string, data: string): void {
  sessions.get(id)?.proc.write(data)
}

export function resize(id: string, cols: number, rows: number): void {
  const s = sessions.get(id)
  if (s && cols > 0 && rows > 0) fit(s.proc, cols, rows)
}

export function kill(id: string): void {
  const s = sessions.get(id)
  if (!s) return
  sessions.delete(id)
  clearTimeout(s.timer)
  try {
    s.proc.kill()
  } catch {
    // Already gone (ESRCH).
  }
}

// Resolves once every shell has exited. node-pty's exit callback must land before Node's
// environment is torn down, or it throws into a dead env and the whole app aborts.
export function killAll(): Promise<void> {
  const procs = [...sessions.values()].map((s) => s.proc)
  const exited = procs.map((p) => new Promise<void>((resolve) => p.onExit(() => resolve())))
  for (const id of [...sessions.keys()]) kill(id)
  // Anything that shrugs off SIGHUP gets SIGKILL.
  const stragglers = setTimeout(() => {
    for (const p of procs) {
      try {
        p.kill('SIGKILL')
      } catch {
        // Already gone.
      }
    }
  }, 1000)
  return Promise.all(exited).then(() => clearTimeout(stragglers))
}
