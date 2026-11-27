import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LoadedPlugin, RendererHost } from '../../shared/plugin'
import type { AgentRequest, AgentRunEvent } from '../../shared/types'

// The renderer's plugin registry across reloads, with window.api and the DOM stood in for: what a
// plugin registered goes, its new version's comes in once, and nothing reaches a terminal.

const m = vi.hoisted(() => ({ rules: { light: [] as unknown[], dark: [] as unknown[] }, play: new Set<(slot: number, project: string) => void>() }))
vi.mock('./monaco', () => ({
  monaco: {},
  addThemeRules: (light: unknown[], dark: unknown[]) => {
    m.rules.light.push(...light)
    m.rules.dark.push(...dark)
    return () => {
      m.rules.light = m.rules.light.filter((r) => !light.includes(r))
      m.rules.dark = m.rules.dark.filter((r) => !dark.includes(r))
    }
  }
}))
vi.mock('./play', () => ({
  onPlayChange: (fn: (slot: number, project: string) => void) => {
    m.play.add(fn)
    return () => m.play.delete(fn)
  }
}))
vi.mock('./components/Toasts', () => ({ toast: () => {} }))
vi.mock('./components/Playground', () => ({ EmbeddedPlayground: () => null }))
vi.mock('./components/Run', () => ({ default: () => null }))
vi.mock('./components/Scratch', () => ({ default: () => null }))

type Registry = typeof import('./plugins')
let r: Registry

const log: string[] = []
;(globalThis as { __log?: string[] }).__log = log

// A renderer bundle that registers one of everything, each saying its version.
const bundle = (id: string, v: number, requires: string[] = []): LoadedPlugin => ({
  id,
  name: id,
  path: `/plugins/${id}`,
  requires,
  commands: [],
  style: `.${id} { --v: ${v} }`,
  renderer: `const log = globalThis.__log
exports.activate = (host) => {
  log.push('${id}${v} up')
  host.provide({ v: ${v} })
  host.projectData({ load: async () => ({ v: ${v} }) })
  host.view({ command: 'show', title: '${id} view v${v}', icon: null, render: () => null })
  host.panel({ id: 'side', command: 'side', title: '${id} panel v${v}', icon: null, render: () => null })
  host.onCommand('go', () => log.push('${id}${v} go'))
  host.onEditor((editor) => {
    editor.hooks.push('${id}${v}')
    return { dispose: () => editor.hooks.splice(editor.hooks.indexOf('${id}${v}'), 1) }
  })
  host.addThemeRules([{ token: '${id}${v}' }], [{ token: '${id}${v}' }])
  host.onAgentRequest((req) => log.push('${id}${v} request ' + req.id))
  host.onAgentRequestEnd((id) => log.push('${id}${v} end ' + id))
  host.onAgentRun('run-1', { output: (line) => log.push('${id}${v} run ' + line) })
  host.onPlayground((slot) => log.push('${id}${v} play ' + slot))
  host.agentBar(() => null)
  host.agentPreset({ name: '${id} preset v${v}', command: 'x' })
}
exports.deactivate = () => log.push('${id}${v} down')
`
})

let version = 1
let fresh: (path: string | null) => LoadedPlugin[]
const calls: string[] = []
const answers: [string, unknown][] = []
let request: (req: AgentRequest) => void = () => {}
let requestEnd: (id: string) => void = () => {}
const runSubs = new Set<(e: AgentRunEvent) => void>()
const head: { textContent: string; remove: () => void }[] = []

const api = {
  pluginRenderers: async () => [bundle('a', version), bundle('b', version, ['a']), bundle('c', 1)],
  pluginReload: async (path: string | null) => fresh(path),
  onAgentRequest: (cb: (req: AgentRequest) => void) => ((request = cb), () => {}),
  onAgentRequestEnd: (cb: (id: string) => void) => ((requestEnd = cb), () => {}),
  agentTaken: () => {},
  agentAnswer: async (id: string, output: unknown) => (answers.push([id, output]), true),
  onAgentRunEvent: (_id: string, cb: (e: AgentRunEvent) => void) => (runSubs.add(cb), () => runSubs.delete(cb)),
  agentRunEvents: async () => []
}

beforeEach(async () => {
  vi.resetModules()
  version = 1
  log.length = 0
  calls.length = 0
  answers.length = 0
  runSubs.clear()
  head.length = 0
  m.rules.light = []
  m.rules.dark = []
  m.play.clear()
  // Every call is recorded, so the test can say none went to a terminal.
  ;(globalThis as { window?: unknown }).window = {
    api: new Proxy(api, {
      get: (t, k: string) => {
        calls.push(k)
        if (!(k in t)) throw new Error(`unexpected window.api.${k}`)
        return t[k as keyof typeof api]
      }
    })
  }
  ;(globalThis as { document?: unknown }).document = {
    createElement: () => {
      const el = { dataset: {}, textContent: '', remove: () => void head.splice(head.indexOf(el), 1) }
      return el
    },
    head: { append: (el: (typeof head)[number]) => void head.push(el) }
  }
  r = await import('./plugins')
  await r.loadPlugins()
})

const editor = { hooks: [] as string[] }
const titles = (): string[] => registry().flatMap((p) => [...p.views.map((v) => v.title), ...p.panels.map((x) => x.title)])
// The registry as App reads it (usePlugins needs React; pluginNow reads the same list).
const registry = (): NonNullable<ReturnType<Registry['pluginNow']>>[] => ['a', 'b', 'c'].map((id) => r.pluginNow(id)).filter((p) => !!p)

describe('reloading a plugin', () => {
  it('shows the edit, with what requires it reloaded in order, and never touches a terminal', async () => {
    const off = r.addEditor(editor as never)
    expect(editor.hooks).toEqual(['a1', 'b1', 'c1'])
    request({ id: 'q1', session: 'claude:/p', agent: 'claude', project: '/p', payload: {} })
    log.length = 0

    version = 2
    fresh = () => [bundle('a', 2), bundle('b', 2, ['a'])]
    expect(await r.reloadPlugins('/plugins/a')).toBe(2)
    expect(log).toEqual(['b1 down', 'a1 down', 'a2 up', 'b2 up'])
    expect(titles()).toEqual(['a view v2', 'a panel v2', 'b view v2', 'b panel v2', 'c view v1', 'c panel v1'])
    // Each plugin keeps its place in the list.
    expect(registry().map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect(editor.hooks.sort()).toEqual(['a2', 'b2', 'c1'])
    expect(head.map((s) => s.textContent)).toEqual(['.c { --v: 1 }', '.a { --v: 2 }', '.b { --v: 2 }'])
    expect(m.rules.dark).toEqual([{ token: 'c1' }, { token: 'a2' }, { token: 'b2' }])
    // c heard q1 too, so it's still c's to answer.
    expect(answers).toEqual([])

    log.length = 0
    r.runCommand('a', 'go')
    request({ id: 'q2', session: 'claude:/p', agent: 'claude', project: '/p', payload: {} })
    requestEnd('q2')
    for (const fn of runSubs) fn({ seq: 0, lines: ['hi'] })
    for (const fn of m.play) fn(1, '/p')
    expect(log.filter((l) => !l.startsWith('c'))).toEqual(['a2 go', 'a2 request q2', 'b2 request q2', 'a2 end q2', 'b2 end q2', 'a2 run hi', 'b2 run hi', 'a2 play 1', 'b2 play 1'])

    // Nothing went to an agent's terminal, a shell or a plugin's Run: no PTY was killed,
    // restarted, started or written to.
    expect(calls.filter((c) => /^(pty|run|agentRunStop)/.test(c))).toEqual([])
    off()
    expect(editor.hooks).toEqual([])
  })

  it('leaves no duplicate views, panels, styles or handlers after reloading twice', async () => {
    r.addEditor(editor as never)
    for (const v of [2, 3]) {
      version = v
      fresh = () => [bundle('a', v), bundle('b', v, ['a'])]
      await r.reloadPlugins('/plugins/a')
    }
    expect(titles()).toEqual(['a view v3', 'a panel v3', 'b view v3', 'b panel v3', 'c view v1', 'c panel v1'])
    expect(registry().map((p) => [p.id, p.presets.length, p.bar.length, p.commands.size])).toEqual([
      ['a', 1, 1, 1],
      ['b', 1, 1, 1],
      ['c', 1, 1, 1]
    ])
    expect(editor.hooks.sort()).toEqual(['a3', 'b3', 'c1'])
    expect(head).toHaveLength(3)
    expect(m.rules.light).toHaveLength(3)
    expect(m.play.size).toBe(3)
    expect(runSubs.size).toBe(3)
    log.length = 0
    request({ id: 'q', session: 'claude:/p', agent: 'claude', project: '/p', payload: {} })
    expect(log.sort()).toEqual(['a3 request q', 'b3 request q', 'c1 request q'])
    expect(calls.filter((c) => /^(pty|run|agentRunStop)/.test(c))).toEqual([])
  })

  it('hands a request only the reloaded plugins heard back to the terminal', async () => {
    fresh = () => [bundle('a', 2), bundle('b', 2, ['a']), bundle('c', 2)]
    request({ id: 'q1', session: 'claude:/p', agent: 'claude', project: '/p', payload: {} })
    await r.reloadPlugins(null)
    expect(answers).toEqual([['q1', null]])
    expect(registry().map((p) => p.key)).toEqual([4, 5, 6])
  })
})

describe('an unloaded version', () => {
  it("can't reach main or an agent, nor register anything", async () => {
    // A bundle that keeps its host, as a timer or callback would.
    const keeper: LoadedPlugin = { ...bundle('a', 1), renderer: 'exports.activate = (host) => { globalThis.__kept = host }' }
    fresh = () => [keeper]
    await r.reloadPlugins('/plugins/a')
    const old = (globalThis as { __kept?: RendererHost }).__kept!
    fresh = () => [bundle('a', 2)]
    await r.reloadPlugins('/plugins/a')
    await expect(old.invoke('v')).rejects.toThrow('a was unloaded')
    expect(await old.sendToAgent('hi')).toBe(false)
    old.view({ command: 'late', title: 'late', icon: null, render: () => null })
    expect(titles()).not.toContain('late')
    expect(calls).not.toContain('pluginInvoke')
  })

  it('comes back when main refuses the reload', async () => {
    fresh = () => {
      throw new Error('/plugins/a isn\'t one of your plugins')
    }
    await expect(r.reloadPlugins('/plugins/a')).rejects.toThrow("isn't one of your plugins")
    expect(registry().map((p) => p.id).sort()).toEqual(['a', 'b', 'c'])
    expect(head).toHaveLength(3)
  })
})
