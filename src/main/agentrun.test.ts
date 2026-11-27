import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { RUN_COMMAND } from '../shared/agents'
import type { AgentRun, AgentRunEnd, AgentRunEvent } from '../shared/types'
import { AT_ONCE, events, seconds, start, stop, stopAll, TIMEOUT, TIMEOUT_MAX } from './agentrun'
import { projectReach } from './repos'

const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'cuckcode-agentrun-')))
const projects = join(tmp, 'projects')
const project = join(projects, 'game')
const outside = join(tmp, 'elsewhere')
const bin = join(tmp, 'bin')
for (const d of [join(project, '.claude', 'profiles'), outside, bin]) mkdirSync(d, { recursive: true })
const PROFILE = { model: 'haiku', permissions: { allow: ['Read'] } }
writeFileSync(join(project, '.claude', 'profiles', 'helper.json'), JSON.stringify(PROFILE, null, 2))
writeFileSync(join(outside, 'evil.json'), '{"permissions":{"allow":["Bash"]}}')
symlinkSync(join(outside, 'evil.json'), join(project, '.claude', 'profiles', 'linked.json'))
writeFileSync(join(project, '.claude', 'profiles', 'list.json'), '[1]')

// A stand-in claude: prints an init line and a result line, as stream-json does, with what it was
// given. Its session is the one it resumes, else a new one.
writeFileSync(
  join(bin, 'claude'),
  `#!${process.execPath}
const args = process.argv.slice(2)
let input = ''
process.stdin.on('data', (d) => (input += d)).on('end', () => {
  const r = args.indexOf('--resume')
  const session = r >= 0 ? args[r + 1] : 'sess-' + process.pid
  console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: session }))
  console.log('not json')
  console.log(JSON.stringify({ type: 'result', result: 'answer', session_id: session, args, input,
    usage: { input_tokens: 3, output_tokens: 5, server_tool_use: {} }, total_cost_usd: 0.01 }))
})
`
)
chmodSync(join(bin, 'claude'), 0o755)
const path = process.env.PATH
process.env.PATH = `${bin}:${path}`
afterAll(() => {
  process.env.PATH = path
  rmSync(tmp, { recursive: true, force: true })
})
afterEach(() => stopAll())

const reach = (dir: string): boolean => projectReach(dir, [], projects)

// Starts a run and collects what it sends, up to its end.
async function go(run: Partial<AgentRun>, command = RUN_COMMAND, plugin = 'p'): Promise<{ id: string; lines: unknown[]; end: Promise<AgentRunEnd>; sent: AgentRunEvent[] }> {
  const sent: AgentRunEvent[] = []
  let done: (end: AgentRunEnd) => void = () => {}
  const end = new Promise<AgentRunEnd>((resolve) => (done = resolve))
  const lines: unknown[] = []
  const started = await start(plugin, { project, prompt: 'hello', profile: 'helper', ...run } as AgentRun, {
    command,
    reach,
    send: (_id, e) => {
      sent.push(e)
      if ('end' in e) done(e.end)
      else lines.push(...e.lines)
    }
  })
  if ('refused' in started) throw new Error(started.refused)
  return { id: started.id, lines, end, sent }
}

const refusal = async (run: Partial<AgentRun>, command = 'touch ran'): Promise<string> => {
  const r = await start('p', { project, prompt: 'hello', profile: 'helper', ...run } as AgentRun, { command, reach, send: () => {} })
  expect(existsSync(join(project, 'ran'))).toBe(false)
  return 'refused' in r ? r.refused : `started ${r.id}`
}

type Said = { args: string[]; input: string }
const said = (lines: unknown[]): Said => lines.find((l) => (l as { type?: string }).type === 'result') as Said

describe('runAgent', () => {
  it('spawns the command in the project, the prompt on stdin, and parses its lines', async () => {
    const run = await go({ prompt: 'two\nlines' }, `printf '{"type":"x","cwd":"%s"}\\n' "$PWD"; cat; echo; echo '{"type":"result","result":"done","usage":{"input_tokens":1}}'`)
    const end = await run.end
    expect(run.lines).toEqual([{ type: 'x', cwd: project }, 'two', 'lines', { type: 'result', result: 'done', usage: { input_tokens: 1 } }])
    expect(end).toEqual({ code: 0, result: 'done', usage: { input_tokens: 1 } })
    // A plain run reports no session, even when the agent names one.
    expect(run.id).toMatch(/^p\.[\w-]+$/)
    // What a late listener gets: everything, in order, ending with the end.
    expect(events('p', run.id)).toEqual(run.sent)
    expect(events('q', run.id)).toEqual([])
  })

  it("gives the profile's checked text, not just its path", async () => {
    const run = await go({}, 'printf "%s\\n%s\\n" "$CUCKCODE_RUN_PROFILE" "$CUCKCODE_RUN_PROFILE_PATH"')
    await run.end
    expect(run.lines).toEqual([PROFILE, join(project, '.claude', 'profiles', 'helper.json')])
  })

  it('runs a plain run with no session kept, and reports usage and cost', async () => {
    const run = await go({})
    const end = await run.end
    const { args, input } = said(run.lines)
    expect(input).toBe('hello')
    expect(args).toContain('--no-session-persistence')
    expect(args).not.toContain('--resume')
    expect(args.slice(args.indexOf('--settings'), args.indexOf('--settings') + 2)).toEqual(['--settings', JSON.stringify(PROFILE)])
    expect(args).toEqual(expect.arrayContaining(['-p', '--output-format', 'stream-json', '--verbose', '--strict-mcp-config']))
    expect(end).toEqual({ code: 0, result: 'answer', usage: { input_tokens: 3, output_tokens: 5 }, cost: 0.01 })
  })

  it("keeps a thread's session, and resume takes the id it ended with", async () => {
    const thread = await go({ thread: true })
    const first = await thread.end
    expect(said(thread.lines).args).not.toContain('--no-session-persistence')
    expect(first.session).toMatch(/^sess-\d+$/)

    const resumed = await go({ resume: first.session, thread: false })
    const again = await resumed.end
    const { args } = said(resumed.lines)
    expect(args.slice(args.indexOf('--resume'), args.indexOf('--resume') + 2)).toEqual(['--resume', first.session])
    expect(args).not.toContain('--no-session-persistence')
    expect(again.session).toBe(first.session)
  })

  it('sets one kind variable per run', async () => {
    const cmd = 'echo "${CUCKCODE_RUN_PLAIN:-}|${CUCKCODE_RUN_THREAD:-}|${CUCKCODE_RUN_RESUME:-}"'
    const kinds = await Promise.all([go({}, cmd), go({ thread: true }, cmd), go({ resume: 'abc-1' }, cmd)])
    await Promise.all(kinds.map((k) => k.end))
    expect(kinds.map((k) => k.lines[0])).toEqual(['1||', '|1|', '||abc-1'])
  })

  it('refuses a missing profile, and runs nothing', async () => {
    expect(await refusal({ profile: 'nope' })).toMatch(/no profile "nope".*nothing ran/)
  })

  it('refuses a profile name that is a path', async () => {
    for (const profile of ['../x', 'a/b', '..', '.', '', '/etc/passwd', 'helper.json']) expect(await refusal({ profile })).toMatch(/plain name/)
    expect(await refusal({ profile: 5 as unknown as string })).toMatch(/plain name/)
  })

  it('refuses a profile reached through a symlink, or not an object', async () => {
    expect(await refusal({ profile: 'linked' })).toMatch(/symlink/)
    const linked = join(projects, 'linked')
    mkdirSync(linked)
    symlinkSync(join(outside), join(linked, '.claude'))
    try {
      expect(await refusal({ project: linked, profile: 'evil' })).toMatch(/symlink/)
    } finally {
      rmSync(linked, { recursive: true })
    }
    expect(await refusal({ profile: 'list' })).toMatch(/isn't a JSON object/)
  })

  it('refuses a folder that is not a project', async () => {
    expect(await refusal({ project: outside })).toMatch(/isn't an open project/)
    expect(await refusal({ project: join(project, '.claude') })).toMatch(/isn't an open project/)
    expect(await refusal({ project: `${projects}/../elsewhere` })).toMatch(/isn't an open project/)
    expect(await refusal({ project: join(projects, 'missing') })).toMatch(/isn't a folder/)
    expect(await refusal({}, ' ')).toMatch(/no run command/)
    expect(await refusal({ prompt: '  ' })).toMatch(/no prompt/)
    expect(await refusal({ resume: '--settings x' })).toMatch(/not a session id/)
  })

  it('stops a run that runs past its timeout', async () => {
    const run = await go({ timeout: 0.2 }, 'echo started; sleep 30')
    const end = await run.end
    expect(end).toEqual({ code: null, stopped: 'timeout', error: 'timed out after 0.2 s' })
    expect(run.lines).toEqual(['started'])
    expect(seconds(undefined)).toBe(TIMEOUT)
    expect(seconds(-1)).toBe(TIMEOUT)
    expect(seconds(1e9)).toBe(TIMEOUT_MAX)
  })

  it('stops a run, and what it started, on Stop; only its own plugin can', async () => {
    const marker = join(tmp, 'child-alive')
    // A child of the command that outlives a plain kill of sh would touch the marker.
    const run = await go({}, `(sleep 1; touch '${marker}') & echo up; wait`)
    await new Promise((resolve) => setTimeout(resolve, 100))
    stop('q', run.id)
    stop('p', run.id)
    expect(await run.end).toEqual({ code: null, stopped: 'stop' })
    await new Promise((resolve) => setTimeout(resolve, 1300))
    expect(existsSync(marker)).toBe(false)
  })

  it(`runs ${AT_ONCE} at once, and refuses another`, async () => {
    const runs = await Promise.all(Array.from({ length: AT_ONCE }, () => go({}, 'sleep 30')))
    expect(await refusal({}, 'sleep 30')).toMatch(/already going/)
    await stopAll()
    for (const r of runs) expect((await r.end).stopped).toBe('stop')
  })

  it('reports a failing command with its stderr', async () => {
    const run = await go({}, 'echo oops >&2; exit 3')
    expect(await run.end).toEqual({ code: 3, error: 'oops' })
    const bad = await go({}, `echo '{"type":"result","is_error":true,"subtype":"error_max_turns"}'`)
    expect(await bad.end).toEqual({ code: 0, error: 'error_max_turns' })
  })
})

describe('projectReach', () => {
  it('takes an open project or a folder right in the projects folder', () => {
    expect(projectReach('/a/open', ['/a/open'], '')).toBe(true)
    expect(projectReach('/code/x', [], '/code')).toBe(true)
    expect(projectReach('/code/x', [], '/code/')).toBe(true)
    expect(projectReach('/code/x/y', [], '/code')).toBe(false)
    expect(projectReach('/a/open/sub', ['/a/open'], '')).toBe(false)
    expect(projectReach('/code/.hidden', [], '/code')).toBe(false)
    expect(projectReach('/code/../etc', [], '/code')).toBe(false)
    expect(projectReach('code/x', [], 'code')).toBe(false)
    expect(projectReach('/code', [], '/code')).toBe(false)
  })
})
