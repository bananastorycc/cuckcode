import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lstat, readFile, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentRun, AgentRunEnd, AgentRunEvent } from '../shared/types'
import { shellEnv } from './env'

// Plugins' helper runs (RendererHost.runAgent): the configured run command (Settings › Agents),
// headless, in a project, on one prompt. What the run may do comes from a profile the project
// keeps in .claude/profiles/, never from the plugin: a plugin names the profile and gives the
// prompt, nothing else. Output goes to the page as JSON lines; the end carries the exit code and
// what the last result line said (session, usage, cost).

export const PROFILES = join('.claude', 'profiles')
export const TIMEOUT = 600 // seconds, when the plugin gives none
export const TIMEOUT_MAX = 3600
export const AT_ONCE = 6

const PROMPT_MAX = 1024 * 1024
const PROFILE_MAX = 64 * 1024
// A line held back waiting for its newline; past this it goes out as it is.
const LINE_MAX = 4 * 1024 * 1024
// What a run keeps for a page that starts listening late; past it, lines still go out live.
const KEPT_CHARS = 4 * 1024 * 1024
const STDERR_TAIL = 8 * 1024
// Ended runs that keep their output; older ones keep only their end, so a late listener still hears it.
const KEPT_RUNS = 20
const ENDS_MAX = 500
// After SIGTERM, before SIGKILL.
const GRACE_MS = 3000

type Send = (id: string, event: AgentRunEvent) => void

interface Live {
  child: ChildProcess
  events: AgentRunEvent[]
  kept: number // chars of output in events
  stopped?: AgentRunEnd['stopped']
  timer: NodeJS.Timeout
  done: Promise<void>
}

const live = new Map<string, Live>()
const ended = new Map<string, AgentRunEvent[]>()

const refuse = (refused: string): { refused: string } => ({ refused })

// The profile's checked text: a plain name, a regular file inside the project reached through no
// symlink, holding a JSON object. Its text (not its path) is what the run gets, so a change made
// after the check can't slip in.
export async function profile(project: string, name: unknown): Promise<{ path: string; json: string } | { refused: string }> {
  if (typeof name !== 'string' || !/^[\w-]+$/.test(name)) return refuse(`a profile is a plain name (letters, digits, _ and -): ${JSON.stringify(name)}`)
  const path = join(project, PROFILES, `${name}.json`)
  const steps = [join(project, '.claude'), join(project, PROFILES), path]
  for (const step of steps) {
    const s = await lstat(step).catch(() => null)
    if (!s) return refuse(`no profile "${name}" in this project (${path} is missing), so nothing ran`)
    if (s.isSymbolicLink()) return refuse(`${step} is a symlink: a profile must be the project's own file`)
    if (step === path ? !s.isFile() : !s.isDirectory()) return refuse(`${step} isn't a ${step === path ? 'file' : 'folder'}`)
  }
  // The project folder itself may be a link (to a checkout elsewhere), but the file must be in it.
  const [root, real] = await Promise.all([realpath(project), realpath(path)]).catch(() => ['', ''])
  if (!root || !real.startsWith(`${root}/`)) return refuse(`${path} isn't inside the project`)
  const bytes = await readFile(path).catch(() => null)
  if (!bytes) return refuse(`can't read ${path}`)
  if (bytes.length > PROFILE_MAX) return refuse(`${path} is too big for a profile`)
  let parsed: unknown
  try {
    parsed = JSON.parse(bytes.toString('utf8'))
  } catch (err) {
    return refuse(`${path} isn't JSON: ${(err as Error).message}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return refuse(`${path} isn't a JSON object`)
  return { path, json: JSON.stringify(parsed) }
}

// What the command gets for this kind of run. Only one of PLAIN, THREAD and RESUME is ever set,
// so a template picks its flags with ${VAR:+…}.
export function runEnv(run: { thread?: boolean; resume?: string }, prof: { path: string; json: string }): Record<string, string> {
  const kind: Record<string, string> = run.resume ? { CUCKCODE_RUN_RESUME: run.resume } : run.thread ? { CUCKCODE_RUN_THREAD: '1' } : { CUCKCODE_RUN_PLAIN: '1' }
  return { ...shellEnv(), CUCKCODE_RUN_PROFILE: prof.json, CUCKCODE_RUN_PROFILE_PATH: prof.path, ...kind }
}

export const seconds = (timeout: unknown): number =>
  typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0 ? Math.min(timeout, TIMEOUT_MAX) : TIMEOUT

export interface Context {
  command: string
  reach: (project: string) => boolean // an open project, or a folder right in the projects folder
  send: Send
}

// Starts a run for plugin, or says why not (then nothing ran).
export async function start(plugin: string, run: AgentRun, ctx: Context): Promise<{ id: string } | { refused: string }> {
  const { project, prompt, resume } = run ?? ({} as AgentRun)
  if (!ctx.command.trim()) return refuse('no run command set (Settings › Agents)')
  if (typeof project !== 'string' || !ctx.reach(project)) return refuse(`${project} isn't an open project or a folder in the projects folder`)
  if (!(await stat(project).then((s) => s.isDirectory(), () => false))) return refuse(`${project} isn't a folder`)
  if (typeof prompt !== 'string' || !prompt.trim()) return refuse('no prompt')
  if (prompt.length > PROMPT_MAX) return refuse('the prompt is too long')
  if (resume !== undefined && (typeof resume !== 'string' || !/^[\w-]{1,200}$/.test(resume))) return refuse(`not a session id: ${JSON.stringify(resume)}`)
  const prof = await profile(project, run.profile)
  if ('refused' in prof) return prof
  if (live.size >= AT_ONCE) return refuse(`${AT_ONCE} runs are already going, the most at once`)

  const id = `${plugin}.${randomUUID()}`
  const thread = !!resume || !!run.thread
  let child: ChildProcess
  try {
    // Its own process group, so stopping it stops what it started too (the agent's tools).
    child = spawn('/bin/sh', ['-c', ctx.command], { cwd: project, env: runEnv(run, prof), detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (err) {
    return refuse(String(err))
  }
  let seq = 0
  let line = ''
  let stderr = ''
  let last: Record<string, unknown> | null = null // the last result line
  let session: string | undefined
  let resolveDone = (): void => {}
  const r: Live = {
    child,
    events: [],
    kept: 0,
    timer: setTimeout(() => halt(id, 'timeout'), seconds(run.timeout) * 1000),
    done: new Promise((resolve) => (resolveDone = resolve))
  }
  live.set(id, r)
  const emit = (event: AgentRunEvent): void => {
    if ('end' in event || r.kept < KEPT_CHARS) r.events.push(event)
    ctx.send(id, event)
  }
  const parse = (text: string): unknown => {
    try {
      const v = JSON.parse(text)
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (typeof v.session_id === 'string') session = v.session_id
        if (v.type === 'result') last = v
        return v
      }
    } catch {
      // Not JSON: passed on as text.
    }
    return text
  }
  const out = (lines: string[]): void => {
    const kept = lines.filter((l) => l.trim())
    if (!kept.length) return
    r.kept += kept.reduce((n, l) => n + l.length, 0)
    emit({ seq: seq++, lines: kept.map(parse) })
  }
  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => {
    const parts = (line + chunk).split('\n')
    line = parts.pop() ?? ''
    if (line.length > LINE_MAX) {
      parts.push(line)
      line = ''
    }
    out(parts)
  })
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => (stderr = (stderr + chunk).slice(-STDERR_TAIL)))
  let finished = false
  const finish = (code: number | null, error?: string): void => {
    if (finished) return
    finished = true
    clearTimeout(r.timer)
    out([line])
    const res = last as { result?: unknown; usage?: unknown; total_cost_usd?: unknown; is_error?: unknown; subtype?: unknown } | null
    const end: AgentRunEnd = { code: r.stopped ? null : code }
    if (r.stopped) end.stopped = r.stopped
    if (thread && session) end.session = session
    if (typeof res?.result === 'string') end.result = res.result
    if (res?.usage && typeof res.usage === 'object') {
      const usage = Object.fromEntries(Object.entries(res.usage).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)))
      if (Object.keys(usage).length) end.usage = usage
    }
    if (typeof res?.total_cost_usd === 'number') end.cost = res.total_cost_usd
    const failed =
      error ??
      (r.stopped === 'timeout' ? `timed out after ${seconds(run.timeout)} s` : undefined) ??
      (res?.is_error === true ? String(res.result || res.subtype || 'the agent reported an error') : undefined) ??
      (code !== 0 && !r.stopped ? stderr.trim() || (code === null ? 'killed by a signal' : `exited with code ${code}`) : undefined)
    if (failed) end.error = failed
    emit({ seq: seq++, end })
    live.delete(id)
    ended.set(id, r.events)
    trim()
    resolveDone()
  }
  child.on('error', (err) => finish(null, String(err.message || err)))
  child.on('close', (code) => finish(code))
  // The command can exit (a bad flag) before reading the prompt; the EPIPE is reported by its exit.
  child.stdin?.on('error', () => {})
  child.stdin?.end(prompt)
  return { id }
}

function trim(): void {
  let older = ended.size - KEPT_RUNS
  for (const [id, events] of ended) {
    if (older-- <= 0) break
    if (events.length > 1) ended.set(id, events.slice(-1))
  }
  for (const id of ended.keys()) {
    if (ended.size <= ENDS_MAX) break
    ended.delete(id)
  }
}

const owns = (plugin: string, id: unknown): id is string => typeof id === 'string' && id.startsWith(`${plugin}.`)

// What a run sent so far (only its end, for an old one); [] for a run that isn't this plugin's.
export function events(plugin: string, id: string): AgentRunEvent[] {
  if (!owns(plugin, id)) return []
  return [...(live.get(id)?.events ?? ended.get(id) ?? [])]
}

function signal(r: Live, sig: NodeJS.Signals): void {
  try {
    if (r.child.pid) process.kill(-r.child.pid, sig)
  } catch {
    // Already gone.
  }
}

function halt(id: string, why: NonNullable<AgentRunEnd['stopped']>, grace = GRACE_MS): void {
  const r = live.get(id)
  if (!r || r.stopped) return
  r.stopped = why
  signal(r, 'SIGTERM')
  const hard = setTimeout(() => signal(r, 'SIGKILL'), grace)
  void r.done.then(() => clearTimeout(hard))
}

// Its end still arrives, with stopped 'stop'.
export function stop(plugin: string, id: string): void {
  if (owns(plugin, id)) halt(id, 'stop')
}

// Quitting: every run stops, quickly (quitting waits 3 s at most). Resolves once they've all exited.
export function stopAll(): Promise<void> {
  const runs = [...live.keys()]
  for (const id of runs) halt(id, 'stop', 1000)
  return Promise.all(runs.map((id) => live.get(id)?.done)).then(() => {})
}
