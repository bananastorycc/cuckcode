import { execFile } from 'node:child_process'
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { LoadedPlugin, MainHost, MainPlugin, PluginInfo, PluginManifest, PluginStatus } from '../shared/plugin'
import { MANIFEST } from '../shared/plugin'
import type { PluginRef } from '../shared/types'
import { shellEnv } from './env'
import { run as git } from './git'

// Plugins are git repos. Installing clones one into cuckcode's own plugins folder (`dir`, set by
// index.ts); a folder you cloned yourself works too. Once per launch: pull (fast-forward only,
// clean trees only), build if stale, then activate main sides in dependency order. Everything is
// async; a broken plugin only reports its error.

interface Plugin {
  dir: string
  manifest: PluginManifest
  handlers: Map<string, (...args: never[]) => unknown>
}

const statuses: PluginStatus[] = []
const loaded: Plugin[] = []
const apis = new Map<string, unknown>()
// `${plugin}:${command}` whose accelerator the menu dropped, so the renderer doesn't show it as a hint.
const dropped = new Set<string>()
let ready: Promise<void> = Promise.resolve()
let dir = ''

export const setDir = (d: string): void => void (dir = d)
// Installed by cuckcode, so removing it deletes the clone (to the Trash).
export const managed = (path: string): boolean => !!dir && path.startsWith(`${dir}/`)

const load = createRequire(__filename)

function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { cwd, env: shellEnv(), timeout: 600_000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(new Error(`${cmd} ${args.join(' ')}: ${(stderr || stdout || err.message).trim().slice(-2000)}`)) : resolve()
    )
  )
}

const mtime = (p: string): Promise<number> => stat(p).then((s) => s.mtimeMs, () => 0)

// The newest mtime under p, skipping node_modules and dot folders.
async function newestIn(p: string): Promise<number> {
  const s = await stat(p).catch(() => null)
  if (!s) return 0
  if (!s.isDirectory()) return s.mtimeMs
  const entries = await readdir(p).catch(() => [])
  const times = await Promise.all(entries.filter((e) => e !== 'node_modules' && !e.startsWith('.')).map((e) => newestIn(join(p, e))))
  return Math.max(s.mtimeMs, ...times)
}

// Same rule as boot/index.js uses for cuckcode itself.
async function build(dir: string, m: PluginManifest): Promise<void> {
  const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8').catch(() => '{}'))
  if (!pkg.scripts?.build) return
  if ((await mtime(join(dir, 'package-lock.json'))) > (await mtime(join(dir, 'node_modules/.package-lock.json')))) {
    await run('npm', ['install', '--no-audit', '--no-fund'], dir)
  }
  const outputs = [m.main, m.renderer, m.style].filter((f): f is string => !!f).map((f) => join(dir, f))
  const built = Math.min(...(await Promise.all(outputs.map(mtime))))
  const inputs = await Promise.all(['src', 'package.json', MANIFEST].map((f) => newestIn(join(dir, f))))
  if (Math.max(...inputs) > built) await run('npm', ['run', 'build'], dir)
}

async function manifest(dir: string): Promise<PluginManifest> {
  const m = JSON.parse(await readFile(join(dir, MANIFEST), 'utf8')) as PluginManifest
  if (typeof m.id !== 'string' || !/^[\w-]+$/.test(m.id)) throw new Error(`${MANIFEST}: bad id`)
  return { ...m, name: typeof m.name === 'string' ? m.name : m.id, requires: m.requires ?? [], commands: m.commands ?? [] }
}

export function start(refs: PluginRef[]): Promise<void> {
  ready = loadAll(refs)
  return ready
}

async function loadAll(refs: PluginRef[]): Promise<void> {
  const found: (Plugin & { status: PluginStatus })[] = []
  for (const ref of refs) {
    const status: PluginStatus = { path: ref.path, enabled: ref.enabled }
    statuses.push(status)
    if (!ref.enabled) continue
    try {
      const m = await manifest(ref.path)
      Object.assign(status, { id: m.id, name: m.name })
      if (found.some((p) => p.manifest.id === m.id)) throw new Error(`Another plugin is already ${m.id}`)
      found.push({ dir: ref.path, manifest: m, handlers: new Map(), status })
    } catch (err) {
      status.error = (err as Error).message
    }
  }
  await Promise.all(
    found.map(async (p) => {
      p.status.note = await pullQuietly(p.dir)
      // A pull can change the manifest (new bundles, commands, requirements).
      if (p.status.note) p.manifest = await manifest(p.dir).catch(() => p.manifest)
      await build(p.dir, p.manifest).catch((err: Error) => {
        p.status.error = `Build failed: ${err.message}`
      })
    })
  )
  // In dependency order: each round activates what has all it needs.
  let left = found.filter((p) => !p.status.error)
  for (;;) {
    const next = left.find((p) => p.manifest.requires!.every((r) => loaded.some((l) => l.manifest.id === r)))
    if (!next) break
    left = left.filter((p) => p !== next)
    try {
      await activate(next)
      loaded.push(next)
    } catch (err) {
      next.status.error = (err as Error).message
    }
  }
  for (const p of left) p.status.error ??= `Needs ${p.manifest.requires!.filter((r) => !loaded.some((l) => l.manifest.id === r)).join(', ')}`
}

async function activate(p: Plugin): Promise<void> {
  if (!p.manifest.main) return
  const file = join(p.dir, p.manifest.main)
  delete load.cache[load.resolve(file)]
  const mod = load(file) as MainPlugin
  const host: MainHost = {
    handle: (name, fn) => p.handlers.set(name, fn),
    provide: (api) => apis.set(p.manifest.id, api),
    use: <T>(id: string) => apis.get(id) as T | undefined,
    shellEnv
  }
  await mod.activate(host)
}

export async function list(): Promise<PluginStatus[]> {
  await ready
  return statuses
}

// The renderer sides of the plugins whose main side loaded, in activation order.
export async function renderers(): Promise<LoadedPlugin[]> {
  await ready
  const read = (dir: string, f?: string): Promise<string | null> => (f ? readFile(join(dir, f), 'utf8').catch(() => null) : Promise.resolve(null))
  return Promise.all(
    loaded.map(async (p) => ({
      id: p.manifest.id,
      name: p.manifest.name,
      commands: (p.manifest.commands ?? []).map((c) => (dropped.has(`${p.manifest.id}:${c.id}`) ? { ...c, accelerator: undefined } : c)),
      renderer: await read(p.dir, p.manifest.renderer),
      style: await read(p.dir, p.manifest.style)
    }))
  )
}

export function commands(): { plugin: string; id: string; title: string; accelerator?: string }[] {
  return loaded.flatMap((p) => (p.manifest.commands ?? []).map((c) => ({ ...c, plugin: p.manifest.id })))
}

// Menu rebuilds report the same clash again; it's kept once.
export function dropShortcut(plugin: string, command: string, message: string): void {
  dropped.add(`${plugin}:${command}`)
  const s = statuses.find((x) => x.id === plugin)
  if (s && !s.error?.includes(message)) s.error = s.error ? `${s.error}; ${message}` : message
}

export async function invoke(id: string, name: string, args: unknown[]): Promise<unknown> {
  await ready
  const fn = loaded.find((p) => p.manifest.id === id)?.handlers.get(name)
  if (!fn) throw new Error(`${id} has no ${name}`)
  return (fn as (...a: unknown[]) => unknown)(...args)
}

// --- git ---

// git@host:me/cuckcode-thing.git -> cuckcode-thing
const nameOf = (url: string): string =>
  url.replace(/\/+$/, '').replace(/\.git$/, '').split(/[/:]/).pop()?.replace(/[^\w.-]/g, '-') ?? ''

// Clones into the plugins folder and checks it is a plugin. Resolves to the new folder.
export async function install(url: string): Promise<string> {
  const name = nameOf(url.trim())
  if (!name || name.startsWith('.')) throw new Error(`Can't tell a folder name from ${url}`)
  const target = join(dir, name)
  if (await stat(target).then(() => true, () => false)) throw new Error(`${name} is already installed`)
  await mkdir(dir, { recursive: true })
  try {
    await git(dir, ['clone', '-q', '--', url.trim(), name], 600_000)
    await manifest(target)
  } catch (err) {
    // A half-made clone would block the retry with "already installed".
    await rm(target, { recursive: true, force: true })
    throw new Error((err as Error).message.includes(MANIFEST) ? `Not a cuckcode plugin: no valid ${MANIFEST}` : (err as Error).message)
  }
  return target
}

// Where a plugin's clone stands; with fetch, also how far behind its upstream it is.
export async function info(path: string, fetch: boolean): Promise<PluginInfo | null> {
  try {
    const [head, remote, dirty] = await Promise.all([
      git(path, ['log', '-1', '--format=%h%x00%s%x00%ct']),
      git(path, ['remote', 'get-url', 'origin']).then((r) => r.trim(), () => null),
      git(path, ['status', '--porcelain', '--untracked-files=no']).then((r) => r.trim() !== '')
    ])
    const [commit, subject, date] = head.trim().split('\0')
    let behind: number | null = null
    if (fetch && remote) {
      await git(path, ['fetch', '-q'], 30_000).catch(() => {})
      behind = await git(path, ['rev-list', '--count', 'HEAD..@{u}']).then((n) => Number(n.trim()), () => null)
    }
    return { remote, commit, subject, date: Number(date), dirty, behind, managed: managed(path) }
  } catch {
    return null
  }
}

export function update(path: string): Promise<string> {
  return git(path, ['pull', '--ff-only'], 120_000)
}

// At launch: what changed, or why it didn't; '' when there was nothing to do.
async function pullQuietly(path: string): Promise<string> {
  const i = await info(path, false)
  if (!i?.remote) return ''
  // Nothing to pull from: a folder you work on yourself, on a branch that isn't pushed.
  if (!(await git(path, ['rev-parse', '--abbrev-ref', '@{u}']).then(() => true, () => false))) return ''
  if (i.dirty) return 'Not updated: it has local changes'
  try {
    const out = await git(path, ['pull', '--ff-only', '-q'], 30_000)
    const after = await info(path, false)
    return after && after.commit !== i.commit ? `Updated to ${after.commit} ${after.subject}` : out.trim()
  } catch (err) {
    return `Not updated: ${(err as Error).message.split('\n')[0]}`
  }
}
