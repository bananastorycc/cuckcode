import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, protocol, screen, shell } from 'electron'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Worker } from 'node:worker_threads'
import type { Agent, Bounds, GitOp, MenuCommand, PaneDir, Settings, ChangedFile, SearchQuery, SearchResult } from '../shared/types'
import { MAX_SLOTS, SHELL_ID } from '../shared/types'
import { CLAUDE, COMMIT_COMMAND, fromPreset } from '../shared/agents'
import { writeAtomic } from './atomic'
import * as configfile from './configfile'
import * as configsync from './configsync'
import * as git from './git'
import { browse, mediaResponse } from './media'
import * as playground from './playground'
import * as plugins from './plugins'
import * as pty from './pty'
import { readme } from './readme'
import * as repos from './repos'
import * as search from './search'
import createSearchWorker from './searchWorker?nodeWorker'
import { closeAll, setWatched } from './watch'

// Apps launched from Finder get a bare PATH; make git, brew tools and agent CLIs resolvable.
const extraPath = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', join(homedir(), '.local/bin')]
const path = (process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin').split(':')
process.env.PATH = [...extraPath.filter((p) => !path.includes(p)), ...path].join(':')

// When launched from the installed app, boot/index.js already registered this before 'ready'.
if (!app.isReady()) {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }
  ])
}

const settingsFile = join(app.getPath('userData'), 'cuckcode-settings.json')
// One scratchpad shared by every project; it lives with the settings, never in a repo.
const scratchFile = join(app.getPath('userData'), 'cuckcode-scratch.txt')
const pluginsDir = join(app.getPath('userData'), 'plugins')
// A fresh install: the Claude Code preset and one playground, nothing else configured.
const DEFAULTS: Settings = {
  projects: [],
  active: null,
  theme: 'auto',
  files: {},
  agent: {},
  recent: [],
  projectsDir: '', // unset: ⌘T asks for it the first time
  notifications: true,
  commitCommand: COMMIT_COMMAND,
  confirmAllRepos: true,
  readme: true,
  folders: { enabled: true, dirs: [] },
  playgrounds: [{ name: 'playground' }],
  webPages: [],
  agents: [fromPreset(CLAUDE, 'claude')],
  plugins: [],
  configRepo: '',
  layout: null,
  layouts: []
}
let settings: Settings = DEFAULTS
// The scratchpad's text, kept here so the config file can carry it.
let scratch = ''
let win: BrowserWindow | null = null

/* eslint-disable @typescript-eslint/no-explicit-any */
const isStr = (v: unknown): v is string => typeof v === 'string'
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isStr) : [])
// Parsed JSON, so any.
const list = <T>(v: unknown, f: (x: any) => T | null, max = Infinity): T[] =>
  (Array.isArray(v) ? v.map((x) => (x && typeof x === 'object' ? f(x) : null)).filter((x): x is T => x !== null) : []).slice(0, max)

const flag = (v: unknown): boolean => v === true

function agent(a: any): Agent | null {
  if (!isStr(a.id) || !/^[\w-]+$/.test(a.id) || a.id === SHELL_ID || !isStr(a.name) || !isStr(a.command)) return null
  return {
    id: a.id,
    name: a.name,
    command: a.command,
    notify: flag(a.notify),
    awake: flag(a.awake),
    mentions: flag(a.mentions),
    newline: flag(a.newline),
    playground: flag(a.playground)
  }
}

// Anything missing or malformed takes its default; nothing older is read.
function parse(raw: any): Settings {
  const d = DEFAULTS
  const projects = strings(raw.projects)
  // Only open projects keep theirs.
  const files: Settings['files'] = {}
  const agentIn: Settings['agent'] = {}
  for (const p of projects) {
    if (isStr(raw.files?.[p])) files[p] = raw.files[p]
    if (isStr(raw.agent?.[p])) agentIn[p] = raw.agent[p]
  }
  const agents = list(raw.agents, agent).filter((a, i, all) => all.findIndex((b) => b.id === a.id) === i)
  return {
    projects,
    active: projects.includes(raw.active) ? raw.active : (projects[0] ?? null),
    theme: raw.theme === 'light' || raw.theme === 'dark' ? raw.theme : 'auto',
    files,
    agent: agentIn,
    recent: strings(raw.recent),
    window: ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(raw.window?.[k])) ? raw.window : undefined,
    projectsDir: isStr(raw.projectsDir) && raw.projectsDir.startsWith('/') ? raw.projectsDir : d.projectsDir,
    commitCommand: isStr(raw.commitCommand) ? raw.commitCommand : d.commitCommand,
    confirmAllRepos: typeof raw.confirmAllRepos === 'boolean' ? raw.confirmAllRepos : d.confirmAllRepos,
    notifications: typeof raw.notifications === 'boolean' ? raw.notifications : d.notifications,
    readme: typeof raw.readme === 'boolean' ? raw.readme : d.readme,
    folders: {
      enabled: typeof raw.folders?.enabled === 'boolean' ? raw.folders.enabled : d.folders.enabled,
      dirs: strings(raw.folders?.dirs)
    },
    playgrounds: Array.isArray(raw.playgrounds)
      ? list(raw.playgrounds, (p) => (isStr(p.name) ? { name: p.name } : null), MAX_SLOTS)
      : d.playgrounds,
    webPages: list(raw.webPages, (p) => (isStr(p.name) && isStr(p.url) ? { name: p.name, url: p.url } : null), MAX_SLOTS),
    agents: Array.isArray(raw.agents) ? agents : d.agents,
    plugins: list(raw.plugins, (p) => (isStr(p.path) ? { path: p.path, ...(isStr(p.url) ? { url: p.url } : {}), enabled: p.enabled !== false } : null)),
    configRepo: isStr(raw.configRepo) ? raw.configRepo.trim() : d.configRepo,
    layout: raw.layout && typeof raw.layout === 'object' ? raw.layout : null,
    layouts: list(raw.layouts, (l) => (isStr(l.name) && l.layout && typeof l.layout === 'object' ? { name: l.name, layout: l.layout } : null))
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// What imports and syncs replaced, until the window's saves show it has caught up with them.
let unshown: Record<string, string>[] = []

// Atomic, like settings: dying mid-write must not empty the notes.
function saveScratch(text: string): Promise<void> {
  scratch = text
  configsync.changed()
  return writeAtomic(scratchFile, text)
}

// Settings and the scratchpad from a config file, which the window is then sent. Throws on a
// file that isn't one, before changing anything.
function adopt(text: string): void {
  const raw = JSON.parse(text)
  const next = parse(configfile.fromFile(raw, settings, pluginsDir))
  const notes = configfile.scratchOf(raw)
  // The scratchpad first, so the settings save finds the file in step with the repo.
  if (notes !== null && notes !== scratch) {
    saveScratch(notes).catch(() => {})
    send('scratch:remote', notes)
  }
  const old = configfile.travelling(settings)
  saveSettings(next)
  unshown.push(old)
}

async function loadSettings(): Promise<void> {
  try {
    settings = parse(JSON.parse(await readFile(settingsFile, 'utf8')))
  } catch {
    // First launch.
  }
}

// Saves arrive on every click (the open file is part of it), so a write already waiting in
// line just picks up the latest settings instead of queueing another.
let saving = Promise.resolve()
let saveQueued = false
function saveSettings(next: Settings): void {
  const menuWas = menuKey(settings)
  const repoWas = settings.configRepo
  settings = next
  if (menuKey(next) !== menuWas) buildMenu()
  if (next.configRepo !== repoWas) void configsync.connect(next.configRepo)
  else configsync.changed()
  if (saveQueued) return
  saveQueued = true
  // Atomic: dying mid-write must not leave an empty file (and no projects).
  saving = saving
    .then(() => {
      saveQueued = false
      return writeAtomic(settingsFile, JSON.stringify(settings, null, 2))
    })
    .catch(() => {})
}

function send(channel: string, ...args: unknown[]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}

const menu = (cmd: MenuCommand) => (): void => send('menu', cmd)

// The menu shows only what's configured, so it's rebuilt when that changes.
const menuKey = (s: Settings): string =>
  JSON.stringify([s.readme, s.folders.enabled, s.playgrounds.map((p) => p.name), s.webPages.map((p) => p.name)])

// Accelerators compare regardless of modifier order and case.
const normal = (a: string): string => a.toLowerCase().replace('cmdorctrl', 'cmd').replace('command', 'cmd').split('+').sort().join('+')

// ⌃⌘1–9 then ⌃⌘0 for the tenth.
const digit = (i: number): string => String((i + 1) % 10)

function buildMenu(): void {
  const tabs = Array.from({ length: 9 }, (_, i) => ({
    label: `Project ${i + 1}`,
    accelerator: `Cmd+${i + 1}`,
    click: menu({ type: 'tab', index: i })
  }))
  const panes = (['Left', 'Right', 'Up', 'Down'] as const).map((d) => ({
    label: `Focus Pane ${d}`,
    accelerator: `Cmd+Ctrl+${d}`,
    // Shown for reference only: the renderer handles these before the page's editors can.
    registerAccelerator: false,
    click: menu({ type: 'pane', dir: d.toLowerCase() as PaneDir })
  }))
  const webPages = settings.webPages.map((p, i) => ({
    label: `Toggle ${p.name || `Web Page ${i + 1}`}`,
    accelerator: `Cmd+Ctrl+${digit(i)}`,
    click: menu({ type: 'web', index: i })
  }))
  const playgrounds = settings.playgrounds.map((p, i) => ({
    label: `Toggle ${p.name || `Playground ${i + 1}`}`,
    accelerator: `Cmd+Alt+${digit(i)}`,
    click: menu({ type: 'playground', slot: i + 1 })
  }))
  const sep = { type: 'separator' as const }
  // Plugins get what's left: a shortcut cuckcode (or an earlier plugin) has is dropped. That
  // includes the role items' keys (a plugin on ⌘C would break copy).
  const roles = ['Cmd+Z', 'Cmd+Shift+Z', 'Cmd+X', 'Cmd+C', 'Cmd+V', 'Cmd+Alt+Shift+V', 'Cmd+A', 'Cmd+M', 'Cmd+Alt+H', 'Cmd+Alt+I', 'Cmd+R', 'Cmd+Ctrl+F']
  const moves = ['Cmd+Shift+[', 'Cmd+Shift+]', 'Cmd+Shift+{', 'Cmd+Shift+}', ...panes.map((p) => p.accelerator)]
  const taken = new Set(
    ['Cmd+N', 'Cmd+T', 'Cmd+O', 'Cmd+Shift+W', 'Cmd+W', 'Cmd+Shift+F', 'Cmd+Alt+K', 'Cmd+E', 'Cmd+B', 'Cmd+,', 'Cmd+Q', 'Cmd+H', 'Cmd+K', 'Cmd+S']
      .concat(roles, moves)
      .concat(Array.from({ length: 10 }, (_, i) => [`Cmd+${i}`, `Cmd+Ctrl+${i}`, `Cmd+Alt+${i}`]).flat())
      .map(normal)
  )
  const pluginItems = plugins.commands().map((c) => {
    let accelerator = c.accelerator
    if (accelerator && taken.has(normal(accelerator))) {
      plugins.dropShortcut(c.plugin, c.id, `${accelerator} is taken, so ${c.title} has no shortcut`)
      accelerator = undefined
    }
    if (accelerator) taken.add(normal(accelerator))
    return { label: c.title, accelerator, click: menu({ type: 'plugin', plugin: c.plugin, command: c.id }) }
  })
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        role: 'appMenu',
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { label: 'Settings…', accelerator: 'Cmd+,', click: menu({ type: 'settings' }) },
          { label: 'Plugins…', click: menu({ type: 'plugins' }) },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      {
        label: 'File',
        submenu: [
          { label: 'New File…', accelerator: 'Cmd+N', click: menu({ type: 'newFile' }) },
          { label: 'Open Project…', accelerator: 'Cmd+T', click: menu({ type: 'open' }) },
          { label: 'Go to File…', accelerator: 'Cmd+O', click: menu({ type: 'quickOpen' }) },
          { type: 'separator' },
          { label: 'Close File', accelerator: 'Cmd+W', click: menu({ type: 'closeFile' }) },
          { label: 'Close Project…', accelerator: 'Cmd+Shift+W', click: menu({ type: 'close' }) }
        ]
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'pasteAndMatchStyle' },
          { role: 'delete' },
          { role: 'selectAll' },
          { type: 'separator' },
          { label: 'Find in Files', accelerator: 'Cmd+Shift+F', click: menu({ type: 'search' }) },
          { label: 'Send Selection to Agent', accelerator: 'Cmd+Alt+K', click: menu({ type: 'sendSelection' }) }
        ]
      },
      {
        label: 'View',
        submenu: [
          ...(settings.readme ? [{ label: 'Toggle README', accelerator: 'Cmd+E', click: menu({ type: 'readme' }) }] : []),
          ...(settings.folders.enabled ? [{ label: 'Toggle Folders', accelerator: 'Cmd+B', click: menu({ type: 'folders' }) }] : []),
          ...(playgrounds.length ? [sep, ...playgrounds] : []),
          ...(webPages.length ? [sep, ...webPages] : []),
          ...(pluginItems.length ? [sep, ...pluginItems] : []),
          { type: 'separator' },
          ...tabs,
          // Shown for reference only: the renderer handles these.
          { label: 'Previous Project', accelerator: 'Cmd+Shift+[', registerAccelerator: false, click: menu({ type: 'cycle', step: -1 }) },
          { label: 'Next Project', accelerator: 'Cmd+Shift+]', registerAccelerator: false, click: menu({ type: 'cycle', step: 1 }) },
          { type: 'separator' },
          ...panes,
          { type: 'separator' },
          ...(app.isPackaged ? [] : [{ role: 'reload' as const }]),
          { role: 'toggleDevTools' }
        ]
      },
      { role: 'windowMenu' }
    ])
  )
}

// The saved bounds, unless the display they were on is gone: then the default size, centered.
function savedBounds(): Partial<Bounds> {
  const b = settings.window
  const on = (a: Bounds): boolean => b!.x < a.x + a.width && a.x < b!.x + b!.width && b!.y < a.y + a.height && a.y < b!.y + b!.height
  return b && screen.getAllDisplays().some((d) => on(d.workArea)) ? b : { width: 1440, height: 900 }
}

function keepBounds(): void {
  if (!win || win.isDestroyed()) return
  settings = { ...settings, window: win.getNormalBounds() }
  saveSettings(settings)
}

function createWindow(): void {
  win = new BrowserWindow({
    ...savedBounds(),
    minWidth: 900,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 13 },
    backgroundColor: settings.theme === 'light' || (settings.theme === 'auto' && !nativeTheme.shouldUseDarkColors) ? '#ffffff' : '#0d1117',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true }
  })
  win.once('ready-to-show', () => win?.show())
  // Kept once a drag or resize settles, not on every frame of it.
  let boundsTimer: ReturnType<typeof setTimeout> | undefined
  const onBounds = (): void => {
    clearTimeout(boundsTimer)
    boundsTimer = setTimeout(keepBounds, 500)
  }
  win.on('resize', onBounds)
  win.on('move', onBounds)
  // Closing the window quits, by the same path as ⌘Q: unsaved edits saved, no questions.
  win.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    app.quit()
  })
  // Web links only: a page (a playground, a web page) could otherwise hand openExternal a
  // file:// app or a custom scheme.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  // A crashed page leaves a blank window, but the PTYs live on in main, so a reload brings
  // everything back (terminals replay their tail). Once per 10s, so a crash loop can't spin.
  let crashedAt = 0
  win.webContents.on('render-process-gone', (_e, { reason }) => {
    if (reason === 'clean-exit' || quitting || Date.now() - crashedAt < 10_000) return
    crashedAt = Date.now()
    win?.webContents.reload()
  })
  // A file dropped anywhere nothing handles it would navigate the whole app to that file.
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win?.webContents.getURL()) e.preventDefault()
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

// Search and replace run their regexes in a worker: one that backtracks forever is killed
// there instead of freezing the main process.
const WORKER_MS = 15_000

function inWorker<T>(data: object, fail: (error: string) => T): { worker: Worker; result: Promise<T> } {
  const worker = createSearchWorker({ workerData: data })
  const result = new Promise<T>((resolve) => {
    const done = (r: T): void => {
      clearTimeout(timer)
      void worker.terminate()
      resolve(r)
    }
    const timer = setTimeout(() => done(fail('timed out')), WORKER_MS)
    worker.once('message', done)
    worker.once('error', (err) => done(fail(err.message)))
    worker.once('exit', () => done(fail('stopped')))
  })
  return { worker, result }
}

// A newer search supersedes the running one.
let searching: Worker | null = null

function find(root: string, q: SearchQuery): Promise<SearchResult> {
  void searching?.terminate()
  const { worker, result } = inWorker<SearchResult>({ root, q }, (error) => ({ files: [], truncated: false, error: `Search ${error}` }))
  searching = worker
  return result.finally(() => {
    if (searching === worker) searching = null
  })
}

// Never superseded: the worker only computes the new text, and main writes it once it's all there.
async function replaceAll(root: string, q: SearchQuery, replacement: string, paths: string[]): Promise<number> {
  const r = await inWorker<search.Replaced | Error>({ root, q, replacement, paths }, (error) => new Error(`Replace ${error}`)).result
  if (r instanceof Error) throw r
  return search.write(root, r)
}

function registerIpc(): void {
  const ptySink = (channel: string, id: string, data?: string): void => send(channel, id, data)

  ipcMain.handle('app:init', () => settings)
  ipcMain.handle('app:defaults', () => DEFAULTS)
  ipcMain.on('app:save', (_e, next: Settings) => {
    const save = { ...next, window: settings.window }
    const merged = unshown.length ? configfile.overStale(save, settings, unshown) : null
    if (!merged) unshown = []
    saveSettings(merged ?? save)
  })
  ipcMain.on('app:focus', () => {
    win?.show()
    app.focus({ steal: true })
  })
  ipcMain.handle('app:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('repos:list', (_e, dir: string) => (dir.startsWith('/') ? repos.list(dir) : []))
  ipcMain.handle('repos:setUp', (_e, dir: string, remote: string, name: string) => {
    if (!dir.startsWith('/')) throw new Error('No projects folder set.')
    return repos.setUp(dir, remote, name)
  })
  ipcMain.on('app:watch', (_e, projects: string[]) => setWatched(projects, (dir, paths) => send('fs:change', dir, paths)))

  ipcMain.handle('pty:start', (_e, id: string, cols: number, rows: number) => pty.start(id, cols, rows, ptySink, () => settings))
  ipcMain.handle('pty:restart', (_e, id: string, cols: number, rows: number) => pty.restart(id, cols, rows, ptySink, () => settings))
  ipcMain.on('pty:write', (_e, id: string, data: string) => pty.write(id, data))
  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) => pty.resize(id, cols, rows))
  ipcMain.on('pty:kill', (_e, id: string) => pty.kill(id))

  ipcMain.handle('git:status', (_e, cwd: string) => git.status(cwd))
  ipcMain.handle('git:files', (_e, root: string) => git.listFiles(root))
  ipcMain.handle('git:snapshot', (_e, root: string, file: ChangedFile) => git.snapshot(root, file))
  ipcMain.handle('git:branches', (_e, cwd: string) => git.branches(cwd))
  ipcMain.handle('git:log', (_e, cwd: string, skip: number) => git.log(cwd, skip))
  ipcMain.handle('git:commitFiles', (_e, root: string, sha: string) => git.commitFiles(root, sha))
  ipcMain.handle('git:op', (_e, cwd: string, op: GitOp, arg?: string) => git.op(cwd, op, arg, settings.commitCommand))
  ipcMain.handle('git:setRemote', (_e, cwd: string, name: string, url: string) => git.setRemote(cwd, name, url))
  // The renderer has asked first (tracked changes are gone for good); new files go to the Trash.
  ipcMain.handle('git:discard', (_e, root: string, file: ChangedFile) => git.discard(root, file, (abs) => shell.trashItem(abs)))
  ipcMain.handle('search:find', (_e, root: string, q: SearchQuery) => find(root, q))
  ipcMain.handle('search:replace', (_e, root: string, q: SearchQuery, replacement: string, paths: string[]) =>
    replaceAll(root, q, replacement, paths)
  )
  // Atomic, so a crash mid-save can't leave the file half written.
  ipcMain.handle('fs:write', (_e, path: string, content: string) => writeAtomic(path, content))
  ipcMain.handle('fs:create', async (_e, path: string) => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, '', { flag: 'wx' })
  })
  ipcMain.handle('fs:rename', async (_e, from: string, to: string) => {
    // rename() silently replaces an existing file. On a case-insensitive disk a case-only
    // rename (readme.md → README.md) finds `to` already there as `from` itself.
    const [a, b] = await Promise.all([stat(from), stat(to).catch(() => null)])
    if (b && (a.ino !== b.ino || a.dev !== b.dev)) throw new Error(`${to} already exists`)
    await mkdir(dirname(to), { recursive: true })
    await rename(from, to)
  })
  // To the Trash, so a misclick is recoverable.
  ipcMain.handle('fs:trash', (_e, path: string) => shell.trashItem(path))
  ipcMain.handle('play:version', (_e, project: string, slot: number) => playground.version(project, slot))
  // The project comes from the page's own URL, so only open ones are written to.
  ipcMain.handle('play:save', (_e, project: string, slot: number, name: string, text: string) =>
    settings.projects.includes(project) ? playground.save(project, slot, name, text) : Promise.reject(new Error('Not an open project.'))
  )
  ipcMain.handle('readme', (_e, dir: string) => readme(dir))
  ipcMain.handle('browse:list', (_e, dir: string) => browse(dir))
  ipcMain.handle('plugins:list', () => plugins.list())
  ipcMain.handle('plugins:renderers', () => plugins.renderers())
  ipcMain.handle('plugin:invoke', (_e, id: string, name: string, args: unknown[]) => plugins.invoke(id, name, args))
  ipcMain.handle('plugin:install', (_e, url: string) => plugins.install(url))
  ipcMain.handle('plugin:info', (_e, path: string, fetch: boolean) => plugins.info(path, fetch))
  ipcMain.handle('plugin:update', (_e, path: string) => plugins.update(path))
  ipcMain.handle('plugin:uninstall', async (_e, path: string) => {
    if (plugins.managed(path)) await shell.trashItem(path)
  })
  ipcMain.on('app:relaunch', () => {
    relaunching = true
    app.quit()
  })
  ipcMain.handle('config:export', async () => {
    const r = await dialog.showSaveDialog(win!, { defaultPath: join(app.getPath('documents'), 'cuckcode-config.json') })
    if (r.canceled || !r.filePath) return false
    await writeAtomic(r.filePath, configfile.toFile(settings, scratch))
    return true
  })
  ipcMain.handle('config:import', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: [{ name: 'cuckcode config', extensions: ['json'] }] })
    if (r.canceled) return null
    adopt(await readFile(r.filePaths[0], 'utf8'))
    return settings
  })
  ipcMain.on('config:syncNow', () => configsync.now())
  ipcMain.handle('config:syncStatus', () => configsync.current())
  ipcMain.on('app:reveal', (_e, path: string) => shell.showItemInFolder(path))
  ipcMain.handle('scratch:read', () => scratch)
  ipcMain.handle('scratch:write', (_e, text: string) => saveScratch(text))
}

app.whenReady().then(async () => {
  // The installed bundle's own version froze when `npm run app` last ran; the repo's is the real one.
  app.setAboutPanelOptions({ applicationVersion: __VERSION__, version: `Electron ${process.versions.electron}` })
  await loadSettings()
  scratch = await readFile(scratchFile, 'utf8').catch(() => '')
  configsync.setUp(join(app.getPath('userData'), 'config-repo'), {
    local: () => configfile.toFile(settings, scratch),
    // Main takes it too, so a page that hasn't loaded yet starts with it.
    onRemote: (text) => {
      adopt(text)
      send('config:remote', settings)
    },
    onStatus: (status) => send('config:status', status)
  })
  const synced = configsync.connect(settings.configRepo)
  protocol.handle('media', mediaResponse)
  registerIpc()
  buildMenu()
  // After the launch's sync, so plugins installed on another machine load here too, but never
  // held up long by a slow network. Their menu items arrive once they've loaded.
  plugins.setDir(pluginsDir)
  plugins.start(Promise.race([synced, new Promise((resolve) => setTimeout(resolve, 10_000))]), () => settings.plugins).then(buildMenu)
  createWindow()
})

// Single-window tool: closing the window quits, so no PTY is ever left orphaned.
app.on('window-all-closed', () => app.quit())

// Asks the renderer something and waits for its reply on `reply`, or `fallback` after ms
// (a hung or crashed page must not hold up the quit).
function request<T>(channel: string, reply: string, fallback: T, ms: number, ...args: unknown[]): Promise<T> {
  if (!win || win.isDestroyed()) return Promise.resolve(fallback)
  return new Promise((resolve) => {
    const answer = (_e: unknown, v: T): void => {
      clearTimeout(timer)
      resolve(v)
    }
    const timer = setTimeout(() => {
      ipcMain.removeListener(reply, answer)
      resolve(fallback)
    }, ms)
    ipcMain.once(reply, answer)
    send(channel, ...args)
  })
}

// Save unsaved edits, reap every shell and exit. Nothing goes to the network and nothing asks,
// so the app is gone within a few seconds at most; never left running in the background.
let quitting = false
let relaunching = false
app.on('before-quit', (e) => {
  if (quitting) return
  quitting = true
  e.preventDefault()
  keepBounds()
  if (win && !win.isDestroyed()) win.hide()
  // Reopening the app meanwhile (Dock, Spotlight) only reaches this windowless instance, so
  // come back up once done rather than leave the click unanswered. Not in dev: no server to load.
  let relaunch = relaunching
  if (app.isPackaged) {
    app.removeAllListeners('second-instance')
    app.on('second-instance', () => (relaunch = true))
    app.on('activate', () => (relaunch = true))
  }
  closeAll()
  const cap = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
  // The config commit waits for the window's last saves (a scratchpad edit still on its timer),
  // or it would commit without them and the next launch's pull would put the old ones back.
  const flushed = request('app:flush', 'app:flushed', undefined, 3000)
  Promise.all([
    flushed,
    Promise.race([pty.killAll(), cap(3000)]),
    flushed.then(() => Promise.race([configsync.flush(), cap(3000)])),
    flushed.then(() => saving)
  ]).finally(() => {
    if (relaunch) app.relaunch()
    app.exit(0)
  })
})
