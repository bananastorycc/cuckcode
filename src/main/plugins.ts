import { execFile } from 'node:child_process'
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { Disposable, LoadedPlugin, MainHost, MainPlugin, PluginInfo, PluginManifest, PluginStatus, PluginStore } from '../shared/plugin'
import { folderName, MANIFEST } from '../shared/plugin'
import type { PluginRef } from '../shared/types'
import { shellEnv } from './env'
import { run as git } from './git'
import { pluginStore } from './pluginstore'
import { syncToUpstream } from './pluginsync'

// Plugins are git repos. Installing clones one into cuckcode's own plugins folder (`dir`, set by
// index.ts); a folder you cloned yourself works too. Once per launch: clone the ones a config
// sync brought in, pull (fast-forward only, clean trees only; a clone of ours whose upstream was
// force-pushed is realigned when none of its commits would be lost: pluginsync.ts), build if stale,
// then activate main sides in dependency order. Everything is async; a broken plugin only reports its error.
// A reload (reload()) does the same for one plugin and what requires it, or for all, without the pull.

interface Plugin {
  dir: string
  manifest: PluginManifest
  handlers: Map<string, (...args: never[]) => unknown>
  status: PluginStatus
  module?: MainPlugin
  // Unloaded: its host refuses what the old code still tries to register.
  dead?: boolean
}

let statuses: PluginStatus[] = []
let loaded: Plugin[] = []
const apis = new Map<string, unknown>()
// `${plugin}:${command}` whose accelerator the menu dropped, so the renderer doesn't show it as a hint.
const dropped = new Set<string>()
let ready: Promise<void> = new Promise(() => {}) // until start
// Reloads, one at a time, after the launch's load.
let queue: Promise<unknown> = ready
let refsOf: () => PluginRef[] = () => []
let dir = ''
// Where plugins keep their stores, a folder per id.
let dataDir = ''
// How long a deactivate gets before the reload goes on without it.
export const DEACTIVATE_MS = 5000

export const setDir = (d: string): void => void (dir = d)
export const setDataDir = (d: string): void => void (dataDir = d)
// Installed by cuckcode, so removing it deletes the clone (to the Trash).
export const managed = (path: string): boolean => !!dir && path.startsWith(`${dir}/`)

const requireFrom = createRequire(__filename)

// Rejects with the output's tail as the message, and all of it as `output`.
function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { cwd, env: shellEnv(), timeout: 600_000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) return resolve()
      const output = (stderr || stdout || err.message).trim()
      reject(Object.assign(new Error(`${cmd} ${args.join(' ')}: ${output.slice(-2000)}`), { output }))
    })
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

// What a build reads besides src/: the package and its lockfile, a build script and the TypeScript
// config at the root, and (through its .package-lock.json, which every install rewrites) what's installed.
const BUILD_INPUTS = /^(package(-lock)?\.json|build\.[cm]?[jt]s|tsconfig(\..+)?\.json)$/
const INSTALLED = join('node_modules', '.package-lock.json')

// Whether a bundle is missing or older than anything its build reads.
export async function stale(dir: string, m: PluginManifest): Promise<boolean> {
  const outputs = [m.main, m.renderer, m.style].filter((f): f is string => !!f).map((f) => join(dir, f))
  const built = Math.min(...(await Promise.all(outputs.map(mtime))))
  const root = (await readdir(dir).catch(() => [])).filter((f) => BUILD_INPUTS.test(f))
  const inputs = await Promise.all(['src', MANIFEST, INSTALLED, ...root].map((f) => newestIn(join(dir, f))))
  return Math.max(...inputs) > built
}

// Like boot/index.js does for cuckcode itself. Resolves to a note when the install had to work
// around the plugin's lockfile.
async function build(dir: string, m: PluginManifest): Promise<string> {
  const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8').catch(() => '{}'))
  if (!pkg.scripts?.build) return ''
  const note = await installDeps(dir, pkg, managed(dir))
  if (await stale(dir, m)) await run('npm', ['run', 'build'], dir)
  return note
}

const NPM = ['--no-audit', '--no-fund']

// Installed when package.json or the lockfile is newer than the last install, or never installed
// at all; every way leaves node_modules/.package-lock.json for the next launch to compare. A clone of ours must stay clean, or launches stop pulling it: npm
// install would rewrite a lockfile that disagrees with package.json, so it gets npm ci, and when
// that refuses, an install that writes no lockfile. A folder of your own gets a plain npm install.
export async function installDeps(dir: string, pkg: { dependencies?: object; devDependencies?: object }, clean: boolean): Promise<string> {
  if (Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length === 0) return ''
  const installed = await mtime(join(dir, INSTALLED))
  const locked = await mtime(join(dir, 'package-lock.json'))
  if (installed && Math.max(locked, await mtime(join(dir, 'package.json'))) <= installed) return ''
  if (!clean) {
    await run('npm', ['install', ...NPM], dir)
    return ''
  }
  const loose = (): Promise<void> => run('npm', ['install', '--no-save', '--package-lock=false', ...NPM], dir)
  if (!locked) {
    await loose()
    return ''
  }
  try {
    await run('npm', ['ci', ...NPM], dir)
    return ''
  } catch (err) {
    // npm's words for a lockfile that disagrees with package.json; anything else is a real failure.
    if (!/\bin sync\b/.test((err as { output?: string }).output ?? '')) throw err
  }
  await loose()
  return "Installed without its lockfile: package-lock.json is out of date with package.json in the plugin's repo"
}

async function manifest(dir: string): Promise<PluginManifest> {
  const m = JSON.parse(await readFile(join(dir, MANIFEST), 'utf8')) as PluginManifest
  if (typeof m.id !== 'string' || !/^[\w-]+$/.test(m.id)) throw new Error(`${MANIFEST}: bad id`)
  return { ...m, name: typeof m.name === 'string' ? m.name : m.id, requires: m.requires ?? [], commands: m.commands ?? [] }
}

// Loads once `after` settles (the launch's config sync, which can bring new plugins), reading
// the refs then.
export function start(after: Promise<unknown>, refs: () => PluginRef[]): Promise<void> {
  refsOf = refs
  ready = after.then(() => load(refs(), true))
  queue = ready
  return ready
}

const exists = (p: string): Promise<boolean> => stat(p).then(() => true, () => false)

// Loads refs; the plugins already loaded stay as they are, and count for requires. pull: the
// launch's, which a reload skips. notes: what unloading each folder's old version had to say.
async function load(refs: PluginRef[], pull: boolean, notes = new Map<string, string>()): Promise<void> {
  const statusOf = new Map(refs.map((ref) => [ref, { path: ref.path, enabled: ref.enabled, ...(notes.get(ref.path) ? { note: notes.get(ref.path) } : {}) } as PluginStatus]))
  for (const s of statusOf.values()) {
    const i = statuses.findIndex((x) => x.path === s.path)
    if (i < 0) statuses.push(s)
    else statuses[i] = s
  }
  // Installed on another machine: cloned here first, all at once.
  await Promise.all(
    refs
      .filter((ref) => ref.enabled && ref.url)
      .map(async (ref) => {
        if (await exists(ref.path)) return
        await clone(ref.url!, ref.path).then(
          () => (statusOf.get(ref)!.note = 'Installed from your synced config'),
          (err: Error) => (statusOf.get(ref)!.error = err.message)
        )
      })
  )
  const found: Plugin[] = []
  for (const ref of refs) {
    const status = statusOf.get(ref)!
    if (!ref.enabled || status.error) continue
    try {
      const m = await manifest(ref.path)
      Object.assign(status, { id: m.id, name: m.name })
      if ([...found, ...loaded].some((p) => p.manifest.id === m.id)) throw new Error(`Another plugin is already ${m.id}`)
      found.push({ dir: ref.path, manifest: m, handlers: new Map(), status })
    } catch (err) {
      status.error = (err as Error).message
    }
  }
  await Promise.all(
    found.map(async (p) => {
      const pulled = pull ? await pullQuietly(p.dir) : ''
      p.status.note = pulled || p.status.note
      // A pull can change the manifest (new bundles, commands, requirements).
      if (pulled) p.manifest = await manifest(p.dir).catch(() => p.manifest)
      await build(p.dir, p.manifest).then(
        (note) => note && (p.status.note = p.status.note ? `${p.status.note}. ${note}` : note),
        (err: Error) => (p.status.error = `Build failed: ${err.message}`)
      )
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
      // What it registered before it threw goes with it.
      next.dead = true
      next.handlers.clear()
      apis.delete(next.manifest.id)
    }
  }
  for (const p of left) p.status.error ??= `Needs ${p.manifest.requires!.filter((r) => !loaded.some((l) => l.manifest.id === r)).join(', ')}`
}

// Undoes something once; a dead plugin's registrations do nothing.
function disposable(p: Plugin, register: () => () => void): Disposable {
  let undo: (() => void) | null = p.dead ? null : register()
  return () => {
    undo?.()
    undo = null
  }
}

async function activate(p: Plugin): Promise<void> {
  if (!p.manifest.main) return
  const file = join(p.dir, p.manifest.main)
  // A reload reads the bundle again.
  delete requireFrom.cache[requireFrom.resolve(file)]
  const mod = requireFrom(file) as MainPlugin
  p.module = mod
  const id = p.manifest.id
  const host: MainHost = {
    handle: (name, fn) =>
      disposable(p, () => {
        p.handlers.set(name, fn)
        return () => void (p.handlers.get(name) === fn && p.handlers.delete(name))
      }),
    provide: (api) =>
      disposable(p, () => {
        apis.set(id, api)
        return () => void (apis.get(id) === api && apis.delete(id))
      }),
    use: <T>(id: string) => apis.get(id) as T | undefined,
    shellEnv,
    store: pluginStore(join(dataDir, id), () => !!p.dead)
  }
  await mod.activate(host)
}

// Runs p's deactivate, then drops what it registered. Resolves to what went wrong, or ''.
async function unload(p: Plugin): Promise<string> {
  loaded = loaded.filter((x) => x !== p)
  p.dead = true
  let note = ''
  let timer: NodeJS.Timeout | undefined
  try {
    const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`didn't finish in ${DEACTIVATE_MS / 1000} s`)), DEACTIVATE_MS)))
    await Promise.race([Promise.resolve().then(() => p.module?.deactivate?.()), late])
  } catch (err) {
    note = `Its old version's deactivate failed: ${(err as Error)?.message ?? err}`
  } finally {
    clearTimeout(timer)
  }
  p.handlers.clear()
  apis.delete(p.manifest.id)
  for (const c of p.manifest.commands ?? []) dropped.delete(`${p.manifest.id}:${c.id}`)
  return note
}

// Reloads the plugin in folder path, and the loaded ones that require it (and those that require
// them), or with path null every plugin, as the settings now list them (so it also applies
// plugins enabled, disabled, added or removed since). The ones it touches unload last-activated
// first, then load as at launch, without the pull. Resolves to the ids it loaded, in activation order.
export function reload(path: string | null): Promise<string[]> {
  const run = queue.then(() => reloadNow(path))
  queue = run.catch(() => {})
  return run
}

async function reloadNow(path: string | null): Promise<string[]> {
  const refs = refsOf()
  let targets = refs
  if (path !== null) {
    const ref = refs.find((r) => r.path === path)
    if (!ref) throw new Error(`${path} isn't one of your plugins`)
    const ids = new Set([loaded.find((p) => p.dir === path)?.manifest.id ?? statuses.find((s) => s.path === path)?.id].filter((x): x is string => !!x))
    for (let grew = true; grew; ) {
      grew = false
      for (const p of loaded)
        if (!ids.has(p.manifest.id) && p.manifest.requires!.some((r) => ids.has(r))) {
          ids.add(p.manifest.id)
          grew = true
        }
    }
    const dependent = (r: PluginRef): boolean => loaded.some((p) => p.dir === r.path && ids.has(p.manifest.id))
    // One that couldn't load for want of another may load now.
    const waiting = (r: PluginRef): boolean => r.enabled && !loaded.some((p) => p.dir === r.path) && !!statuses.find((s) => s.path === r.path)?.error?.startsWith('Needs ')
    targets = refs.filter((r) => r === ref || dependent(r) || waiting(r))
  }
  const paths = new Set(targets.map((r) => r.path))
  const going = loaded.filter((p) => path === null || paths.has(p.dir)).reverse()
  const notes = new Map<string, string>()
  for (const p of going) notes.set(p.dir, await unload(p))
  if (path === null) statuses = []
  const before = new Set(loaded)
  await load(targets, false, notes)
  return loaded.filter((p) => !before.has(p)).map((p) => p.manifest.id)
}

export async function list(): Promise<PluginStatus[]> {
  await queue
  return statuses
}

// The renderer sides of the plugins whose main side loaded (only ids', with ids), in activation order.
export async function renderers(ids?: string[]): Promise<LoadedPlugin[]> {
  await ready
  const read = (dir: string, f?: string): Promise<string | null> => (f ? readFile(join(dir, f), 'utf8').catch(() => null) : Promise.resolve(null))
  return Promise.all(
    loaded
      .filter((p) => !ids || ids.includes(p.manifest.id))
      .map(async (p) => ({
        id: p.manifest.id,
        name: p.manifest.name,
        path: p.dir,
        requires: p.manifest.requires ?? [],
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
  const find = (): ((...args: never[]) => unknown) | undefined => loaded.find((p) => p.manifest.id === id)?.handlers.get(name)
  // While id reloads, its new version may be on its way.
  let fn = find()
  if (!fn) {
    await queue
    fn = find()
  }
  if (!fn) throw new Error(`${id} has no ${name}`)
  return (fn as (...a: unknown[]) => unknown)(...args)
}

// The renderer side's store (RendererHost.store): a loaded plugin's, so the id names a real folder.
export async function store(id: string, op: keyof PluginStore, key: string, value?: unknown): Promise<unknown> {
  await ready
  if (!loaded.some((p) => p.manifest.id === id)) throw new Error(`store: ${id} isn't loaded`)
  const s = pluginStore(join(dataDir, id))
  return op === 'get' ? s.get(key) : op === 'set' ? s.set(key, value) : op === 'delete' ? s.delete(key) : Promise.reject(new Error(`store: no ${op}`))
}

// --- git ---

// Clones url into target and checks it is a plugin.
async function clone(url: string, target: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  try {
    await git(dir, ['clone', '-q', '--', url, target], 600_000)
    await manifest(target)
  } catch (err) {
    // A half-made clone would block the retry with "already installed".
    await rm(target, { recursive: true, force: true })
    throw new Error((err as Error).message.includes(MANIFEST) ? `Not a cuckcode plugin: no valid ${MANIFEST}` : (err as Error).message)
  }
}

// Clones into the plugins folder. Resolves to the folder. A clone of the same URL already there
// (left by a removal synced from another machine) is reused.
export async function install(url: string): Promise<string> {
  url = url.trim()
  const name = folderName(url)
  if (!name || name.startsWith('.')) throw new Error(`Can't tell a folder name from ${url}`)
  const target = join(dir, name)
  if (await exists(target)) {
    const origin = await git(target, ['remote', 'get-url', 'origin']).then((r) => r.trim(), () => '')
    if (origin !== url) throw new Error(`${name} is already installed`)
    await manifest(target)
    return target
  }
  await clone(url, target)
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

export async function update(path: string): Promise<string> {
  return (await syncToUpstream(path, managed(path), 120_000)) || 'Already up to date.'
}

// At launch: what changed, or why it didn't; '' when there was nothing to do.
async function pullQuietly(path: string): Promise<string> {
  const i = await info(path, false)
  if (!i?.remote) return ''
  // Nothing to pull from: a folder you work on yourself, on a branch that isn't pushed.
  if (!(await git(path, ['rev-parse', '--abbrev-ref', '@{u}']).then(() => true, () => false))) return ''
  if (i.dirty) return 'Not updated: it has local changes'
  try {
    return await syncToUpstream(path, managed(path))
  } catch (err) {
    return `Not updated: ${(err as Error).message.split('\n')[0]}`
  }
}
