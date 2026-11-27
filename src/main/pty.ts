import * as pty from 'node-pty'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { RunExit, RunSpec, Settings } from '../shared/types'
import { SHELL_ID } from '../shared/types'
import * as agentrequest from './agentrequest'
import * as awake from './awake'
import { shellEnv } from './env'
import * as playground from './playground'

// Up to one PTY per (agent, project), keyed `${agent id}:${project path}`, plus plugins' runs
// (see run()). Sessions outlive renderer reloads: a reattaching terminal gets the recent output
// tail replayed.

const FLUSH_MS = 4
const TAIL_CHARS = 256 * 1024

interface Session {
  proc: pty.IPty
  tail: string[]
  tailLength: number
  pending: string
  timer?: NodeJS.Timeout
}

type Sink = (channel: 'pty:data' | 'pty:exit', id: string, data?: string | RunExit) => void
type Config = () => Settings

const sessions = new Map<string, Session>()

// Login+interactive so the user's PATH and config load, then the agent; when it exits you
// land in a normal shell in the same directory. The command comes from the environment, which
// spares quoting it in.
const RUN = 'eval "$CUCKCODE_COMMAND"; exec "$SHELL" -l'

// Any agent's hooks can run it to notify (see notify.sh). The repo sits beside the build, as for the kit.
const NOTIFY = join(__dirname, '../../src/agent/notify.sh')
// Any agent's hooks can run it to have a plugin answer them (see hook.sh and agentrequest.ts).
const HOOK = join(__dirname, '../../src/agent/hook.sh')

const shell = (): string => process.env.SHELL || '/bin/zsh'

// Starts file in a PTY under id, batching its output to send. onExit runs when it exits on
// its own or by a signal, not when kill() dropped or replaced it.
function open(
  id: string,
  file: string,
  args: string[],
  opts: { cwd: string; env: Record<string, string>; cols: number; rows: number },
  send: Sink,
  onExit: (s: Session, e: { exitCode: number; signal?: number }) => void,
  keepAwake = false
): Session {
  const proc = pty.spawn(file, args, { name: 'xterm-256color', ...opts })
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
    if (keepAwake) awake.poke()
    s.pending += data
    s.timer ??= setTimeout(flush, FLUSH_MS)
  })
  proc.onExit((e) => {
    if (sessions.get(id) !== s) return
    if (s.timer) {
      clearTimeout(s.timer)
      flush()
    }
    sessions.delete(id)
    onExit(s, e)
  })
  sessions.set(id, s)
  return s
}

function spawn(id: string, cols: number, rows: number, send: Sink, config: Config): Session {
  const sep = id.indexOf(':')
  const agentId = id.slice(0, sep)
  const cwd = id.slice(sep + 1)
  const env = shellEnv()
  let args = ['-l', '-i']
  const agent = agentId === SHELL_ID ? null : config().agents.find((a) => a.id === agentId)
  if (agentId !== SHELL_ID && !agent) throw new Error(`No agent ${agentId}`)
  if (agent) {
    const slots = config().playgrounds
    if (agent.playground && slots.length) {
      env.CUCKCODE_PLAYGROUND = playground.prompt(cwd, slots)
      playground.exclude(cwd)
    }
    env.CUCKCODE_NOTIFY = NOTIFY
    env.CUCKCODE_HOOK = HOOK
    env.CUCKCODE_SESSION = id
    const sock = agentrequest.socket()
    if (sock) env.CUCKCODE_SOCKET = sock
    env.CUCKCODE_COMMAND = agent.command
    args = [...args, '-c', RUN]
  }
  return open(id, shell(), args, { cwd, env, cols, rows }, send, () => send('pty:exit', id), !!agent?.awake)
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

// Whether id is a running agent's PTY (not a shell's or a run's).
export function isAgent(id: string): boolean {
  return sessions.has(id) && !RUN_ID.test(id) && !id.startsWith(`${SHELL_ID}:`)
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

// A plugin's runs (RendererHost.Run): one command each, in a PTY of its own, with the login
// shell's environment and none of the agents' variables. The id is `run.<plugin>.<name>`, which
// no agent id can be (those are [\w-]+). A run happens once: after it ends, its output and exit
// stay here, so its terminal shows them again when it's back on screen, and running it again
// takes a new name (a new click).
const RUN_ID = /^run\.[\w-]+\.[\w-]+$/
// Ended runs that keep their output; older ones keep only their exit, so they still never rerun.
const KEPT = 20
// The pinned script goes in as one argument, and macOS allows about 1 MB of them in all.
const PIN_MAX = 256 * 1024

const ended = new Map<string, { tail: string; exit: RunExit }>()

function end(id: string, tail: string, exit: RunExit): void {
  ended.set(id, { tail, exit })
  let older = ended.size - KEPT
  for (const e of ended.values()) {
    if (older-- <= 0) break
    e.tail = ''
  }
}

const refuse = (refused: string): { refused: string } => ({ refused })

// What to spawn for spec, or why not. The login shell execs argv itself, so nothing in it is
// read as shell code, and tools on the user's PATH are found as they are in a terminal. A pinned
// file is read once, here, and once its sha256 matches, its bytes are what runs: argv's path
// argument becomes `-c <bytes> <path>`, a shell's own way of running a script it's handed ($0 is
// still the path). So a change to the file after it was shown can't slip in, even mid-run.
export async function prepare(spec: RunSpec, reach: (dir: string) => boolean): Promise<{ file: string; args: string[] } | { refused: string }> {
  const { cwd, argv, pin } = spec ?? {}
  if (!Array.isArray(argv) || !argv[0] || !argv.every((a) => typeof a === 'string')) return refuse('nothing to run')
  if (typeof cwd !== 'string' || !reach(cwd)) return refuse(`${cwd} isn't an open project or in the projects folder`)
  if (!(await stat(cwd).then((s) => s.isDirectory(), () => false))) return refuse(`${cwd} isn't a folder`)
  let args = argv
  if (pin) {
    const at = typeof pin.path === 'string' && isAbsolute(pin.path) ? argv.indexOf(pin.path, 1) : -1
    if (at < 1) return refuse(`the pinned file isn't one of the arguments`)
    let bytes: Buffer
    try {
      bytes = await readFile(pin.path)
    } catch (err) {
      return refuse((err as NodeJS.ErrnoException).code === 'ENOENT' ? `${pin.path} is missing` : String(err))
    }
    if (createHash('sha256').update(bytes).digest('hex') !== String(pin.sha256).toLowerCase()) return refuse('file changed since shown')
    if (bytes.length > PIN_MAX) return refuse(`${pin.path} is too big to pin`)
    const text = bytes.toString('utf8')
    // An argument can't hold a NUL, and bytes that aren't UTF-8 wouldn't survive as one.
    if (bytes.includes(0) || !Buffer.from(text, 'utf8').equals(bytes)) return refuse(`${pin.path} isn't a text script`)
    args = [...argv.slice(0, at), '-c', text, ...argv.slice(at)]
  }
  return { file: shell(), args: ['-l', '-i', '-c', 'exec "$@"', 'run', ...args] }
}

// Starts the run, or reattaches to it: replay is its output so far. exit is set when it has
// already ended or was refused; a refusal counts as its run, so it isn't retried either.
export async function run(
  id: string,
  spec: RunSpec,
  cols: number,
  rows: number,
  send: Sink,
  reach: (dir: string) => boolean
): Promise<{ replay: string; exit?: RunExit }> {
  if (!RUN_ID.test(id)) throw new Error(`Not a run: ${id}`)
  const live = sessions.get(id)
  if (live) {
    fit(live.proc, cols, rows)
    return { replay: live.tail.join('') }
  }
  const done = ended.get(id)
  if (done) return { replay: done.tail, exit: done.exit }
  const ready = await prepare(spec, reach)
  // A second start for the same run (its terminal remounting) can get here first.
  if (sessions.has(id) || ended.has(id)) return run(id, spec, cols, rows, send, reach)
  const refused = (reason: string): { replay: string; exit: RunExit } => {
    const exit = { code: null, refused: reason }
    end(id, '', exit)
    return { replay: '', exit }
  }
  if ('refused' in ready) return refused(ready.refused)
  try {
    open(id, ready.file, ready.args, { cwd: spec.cwd, env: shellEnv(), cols, rows }, send, (s, e) => {
      const exit = { code: e.signal ? null : e.exitCode }
      end(id, s.tail.join(''), exit)
      send('pty:exit', id, exit)
    })
  } catch (err) {
    return refused(String(err))
  }
  return { replay: '' }
}

// Unlike kill(), the run's exit is still recorded and sent.
export function stop(id: string): void {
  if (!RUN_ID.test(id)) return
  try {
    sessions.get(id)?.proc.kill()
  } catch {
    // Already gone.
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
