import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FolderOpen, X } from 'lucide-react'
import changelog from '../../../CHANGELOG.md?raw'
import type { ChangedFile, Config, GitStatus, MenuCommand, PaneDir, SavedLayout, Theme } from '../../shared/types'
import { SHELL_ID } from '../../shared/types'
import AgentMenu from './components/AgentMenu'
import CodePane, { saveAll, selection, type Reveal } from './components/CodePane'
import FileTree from './components/FileTree'
import GitPanel, { type GitTab } from './components/GitPanel'
import Folders from './components/Folders'
import Header, { projectName, tildify } from './components/Header'
import Playground from './components/Playground'
import Plugins from './components/Plugins'
import ProjectPicker from './components/ProjectPicker'
import QuickOpen from './components/QuickOpen'
import Readme from './components/Readme'
import Scratch, { flushScratch } from './components/Scratch'
import Search from './components/Search'
import Settings from './components/Settings'
import Terminal, { pasteInto } from './components/Terminal'
import Toasts, { toast } from './components/Toasts'
import UsageBar, { JunieBar, useJunieBalance, useUsage } from './components/UsageBar'
import WebPage from './components/WebPage'
import { apply, hosts, mount, PRESETS, SECTIONS, type Section } from './layout'
import { loadPlugins, runCommand, setCurrent, setOpenFile, usePlugins, type Registered } from './plugins'

// What's shown: the README over the code pane, or a playground slot (from 1) or a plugin's
// view (`plugin:<id>`) over the whole workspace.
type View = number | 'readme' | `plugin:${string}`

export default function App(): React.JSX.Element {
  const [loaded, setLoaded] = useState(false)
  const [projects, setProjects] = useState<string[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [theme, setTheme] = useState<Theme>('light')
  const [selected, setSelected] = useState<Record<string, ChangedFile>>({})
  const [done, setDone] = useState<Set<string>>(new Set())
  const [tick, setTick] = useState(0)
  const [reveal, setReveal] = useState<Reveal | null>(null)
  const [searchFocus, setSearchFocus] = useState(0)
  const [newFile, setNewFile] = useState(0)
  const [quickOpen, setQuickOpen] = useState(0)
  const [picking, setPicking] = useState(0)
  const [config, setConfig] = useState<Config>(EMPTY)
  const { agents } = config
  // Per project: the agent in front, by id. Unset (or since removed): the first agent.
  const [terms, setTerms] = useState<Record<string, string>>({})
  const [gitTab, setGitTab] = useState<GitTab>('commit')
  const agentOf = (path: string): string => {
    const id = terms[path]
    return id && agents.some((a) => a.id === id) ? id : (agents[0]?.id ?? '')
  }
  const top = agents.find((a) => a.id === (active ? agentOf(active) : ''))
  // Agents after the first start the first time they're picked, not for every project at launch.
  const [started, setStarted] = useState<Set<string>>(new Set())
  useEffect(() => {
    const ids = Object.entries(terms).map(([path, agent]) => `${agent}:${path}`)
    setStarted((s) => (ids.every((id) => s.has(id)) ? s : new Set([...s, ...ids])))
  }, [terms])
  const usage = useUsage(config.meters && top?.type === 'claude')
  const junie = useJunieBalance(config.meters && top?.type === 'junie' ? (top.license ?? null) : null)
  // The dock layout as last left, saved with the session (sizes included), and the named ones.
  const layoutRef = useRef<unknown>(null)
  const [layoutSaves, bumpLayout] = useReducer((n: number) => n + 1, 0)
  const [layouts, setLayouts] = useState<SavedLayout[]>([])
  const dockEl = useRef<HTMLDivElement>(null)
  // Per project: what's shown over the code pane or workspace. Per `${slot}:${path}`: the
  // playground page's version, and whether it changed since last shown.
  const [view, setView] = useState<Record<string, View | undefined>>({})
  const [playVersions, setPlayVersions] = useState<Record<string, number | null>>({})
  const [playUnseen, setPlayUnseen] = useState<Set<string>>(new Set())
  // The full-window view over the layout, if any: a web page by index, folders, or settings.
  // Pages and folders stay mounted once opened, so hiding a page doesn't reload it or drop its
  // live socket, and folders keep their place.
  const [overlay, setOverlay] = useState<number | 'folders' | 'settings' | 'plugins' | null>(null)
  // Web pages opened so far, by URL: editing a page's URL in settings gives it a fresh frame.
  const [webOpened, setWebOpened] = useState<Set<string>>(new Set())
  const [foldersOpened, setFoldersOpened] = useState(false)
  const [recent, setRecent] = useState<string[]>([])
  const activeRef = useRef(active)
  activeRef.current = active
  const projectsRef = useRef(projects)
  projectsRef.current = projects
  const viewRef = useRef(view)
  viewRef.current = view
  const playVersionsRef = useRef(playVersions)
  playVersionsRef.current = playVersions
  const slotsRef = useRef(config.playgrounds.length)
  slotsRef.current = config.playgrounds.length

  useEffect(() => {
    window.api.init().then((s) => {
      setProjects(s.projects)
      setActive(s.active)
      setTheme(s.theme)
      setConfig(pickConfig(s))
      setRecent(s.recent)
      layoutRef.current = s.layout
      setLayouts(s.layouts)
      // Restored as clean; if it's still changed, the fresh status entry takes over.
      setSelected(mapValues(s.files, (path): ChangedFile => ({ path, code: 'M' })))
      setLoaded(true)
    })
  }, [])

  useEffect(() => {
    if (loaded) {
      // A commit's file isn't restored: it'd come back as the working copy.
      const files = Object.fromEntries(Object.entries(selected).flatMap(([p, f]) => (f.commit ? [] : [[p, f.path]])))
      window.api.save({ ...config, projects, active, theme, files, recent, layout: layoutRef.current, layouts })
    }
  }, [loaded, projects, active, theme, selected, config, recent, layoutSaves, layouts])

  // The dock, once the saved layout is known. Dragging a divider changes the layout every frame;
  // it's saved once that settles.
  useEffect(() => {
    if (!loaded || !dockEl.current) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const unmount = mount(dockEl.current, layoutRef.current, (layout) => {
      layoutRef.current = layout
      clearTimeout(timer)
      timer = setTimeout(bumpLayout, 300)
    })
    return () => {
      clearTimeout(timer)
      unmount()
    }
  }, [loaded])

  useEffect(() => window.api.watch(projects), [projects])

  // Once per new version, say what changed. Waits for a project: toasts live in the workspace.
  useEffect(() => {
    if (!active) return
    let last: string | null
    try {
      last = localStorage.getItem('version')
      localStorage.setItem('version', __VERSION__)
    } catch {
      return
    }
    if (last !== __VERSION__) toast(true, `Updated to cuckcode ${__VERSION__}`, changesSince(last ?? ''))
  }, [active])

  useEffect(() => window.api.onFlush(() => Promise.all([saveAll(), flushScratch()]).then(() => {})), [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  // Git status per project, kept so a tab switch paints from the last one in the same frame
  // while the fresh one loads. Overlapping requests collapse into one rerun.
  const statuses = useRef(new Map<string, GitStatus | null>())
  const [, statusChanged] = useReducer((n: number) => n + 1, 0)
  const status = (active && statuses.current.get(active)) || null
  const inflight = useRef({ running: false, again: false })
  const refresh = useCallback(async () => {
    const f = inflight.current
    if (f.running) {
      f.again = true
      return
    }
    f.running = true
    do {
      f.again = false
      const cwd = activeRef.current
      const s = cwd ? await window.api.status(cwd).catch(() => null) : null
      if (cwd) statuses.current.set(cwd, s)
      if (cwd === activeRef.current) statusChanged()
    } while (f.again)
    f.running = false
  }, [])

  // Plugins' per-project data, by `${plugin}:${path}`: null where a plugin has nothing for the
  // project, which hides its view. Overlapping loads collapse into one rerun.
  const plugins = usePlugins()
  const pluginsRef = useRef(plugins)
  pluginsRef.current = plugins
  useEffect(() => void loadPlugins(), [])
  const [data, setData] = useState<Record<string, unknown>>({})
  const dataRef = useRef(data)
  dataRef.current = data
  const loading = useRef(new Map<string, boolean>())
  const loadData = useCallback(async (p: Registered, path: string) => {
    const key = `${p.id}:${path}`
    if (loading.current.has(key)) return void loading.current.set(key, true)
    do {
      loading.current.set(key, false)
      const r = await Promise.resolve()
        .then(() => p.source!.load(path))
        .catch(() => null)
      // Unchanged data keeps its identity, so views (a laid-out graph) don't redo their work.
      setData((x) => (key in x && JSON.stringify(x[key]) === JSON.stringify(r) ? x : { ...x, [key]: r }))
    } while (loading.current.get(key))
    loading.current.delete(key)
  }, [])
  const dataOf = (id: string): unknown => (active ? (data[`${id}:${active}`] ?? null) : null)
  useEffect(() => {
    for (const p of plugins) setCurrent(p.id, dataOf(p.id))
  })

  // The first look at a slot only sets the baseline, so a page left from last time isn't news.
  const checkPlay = useCallback(async (path: string) => {
    const slots = Array.from({ length: slotsRef.current }, (_, i) => i + 1)
    const versions = await Promise.all(slots.map((slot) => window.api.playVersion(path, slot).catch(() => null)))
    slots.forEach((slot, i) => {
      const key = `${slot}:${path}`
      const v = versions[i]
      const seen = key in playVersionsRef.current
      if (seen && v === playVersionsRef.current[key]) return
      setPlayVersions((r) => ({ ...r, [key]: v }))
      if (seen && v !== null && viewRef.current[path] !== slot) setPlayUnseen((s) => new Set(s).add(key))
    })
  }, [])

  useEffect(() => {
    refresh()
  }, [active, refresh])

  useEffect(() => {
    if (active) for (const p of plugins) if (p.source) loadData(p, active)
  }, [active, plugins, loadData])

  useEffect(() => {
    if (active) checkPlay(active)
  }, [active, checkPlay, config.playgrounds.length])

  useEffect(
    () =>
      window.api.onFsChange((dir, paths) => {
        if (dir !== activeRef.current) return
        refresh()
        checkPlay(dir)
        // A project a plugin has nothing for is rechecked when its tab is next opened, not on
        // every change; otherwise only for changes the plugin says could matter.
        for (const p of pluginsRef.current) {
          if (p.source && dataRef.current[`${p.id}:${dir}`] !== null && (p.source.relevant?.(paths) ?? true)) loadData(p, dir)
        }
        setTick((t) => t + 1)
      }),
    [refresh, checkPlay, loadData]
  )

  const togglePlay = (slot: number): void => {
    if (!active || slot > config.playgrounds.length) return
    const key = `${slot}:${active}`
    setView((v) => ({ ...v, [active]: v[active] === slot ? undefined : slot }))
    setPlayUnseen((s) => {
      if (!s.has(key)) return s
      const next = new Set(s)
      next.delete(key)
      return next
    })
  }
  const shown = active ? view[active] : undefined
  // A slot since removed in settings just stops showing.
  const playing = typeof shown === 'number' && shown <= config.playgrounds.length ? shown : null

  const toggleReadme = (): void => {
    if (active && config.readme) setView((v) => ({ ...v, [active]: v[active] === 'readme' ? undefined : 'readme' }))
  }
  const reading = config.readme && shown === 'readme'

  // A plugin's view shows while it has data for the project (or keeps none at all).
  const viewable = plugins.filter((p) => p.view && (!p.source || dataOf(p.id) !== null))
  const togglePluginView = (id: string): void => {
    const key = `plugin:${id}` as const
    if (active && viewable.some((p) => p.id === id)) setView((v) => ({ ...v, [active]: v[active] === key ? undefined : key }))
  }
  const pluginView = viewable.find((p) => shown === `plugin:${p.id}`) ?? null
  const onPluginCommand = (plugin: string, command: string): void => {
    if (plugins.find((p) => p.id === plugin)?.view?.command === command) togglePluginView(plugin)
    else runCommand(plugin, command)
  }

  const toggleWeb = (i: number): void => {
    const page = config.webPages[i]
    if (!page) return
    setOverlay(overlay === i ? null : i)
    setWebOpened((o) => (o.has(page.url) ? o : new Set(o).add(page.url)))
  }
  const showingWeb = typeof overlay === 'number' && config.webPages[overlay] ? overlay : null
  const toggleFolders = (): void => {
    if (!config.folders.enabled) return
    setOverlay(browsing ? null : 'folders')
    setFoldersOpened(true)
  }
  const browsing = config.folders.enabled && overlay === 'folders'
  const configuring = overlay === 'settings'
  const toggleSettings = (): void => setOverlay(configuring ? null : 'settings')
  const togglePlugins = (): void => setOverlay(overlay === 'plugins' ? null : 'plugins')

  // Agents removed in settings take their terminals with them.
  const changeConfig = (next: Config): void => {
    const gone = config.agents.filter((a) => !next.agents.some((b) => b.id === a.id))
    for (const a of gone) for (const path of projects) window.api.ptyKill(`${a.id}:${path}`)
    if (gone.length) setStarted((s) => new Set([...s].filter((id) => !gone.some((a) => id.startsWith(`${a.id}:`)))))
    setConfig(next)
  }

  // Settings back to a fresh install's, except the installed plugins: dropping them would orphan their folders.
  const resetAll = async (): Promise<void> => {
    const d = await window.api.defaults()
    changeConfig({ ...pickConfig(d), plugins: config.plugins })
    setTheme(d.theme)
    setLayouts(d.layouts)
    apply(PRESETS[0])
    setOverlay(null)
  }

  const clearDone = (path: string): void =>
    setDone((d) => {
      if (!d.has(path)) return d
      const next = new Set(d)
      next.delete(path)
      return next
    })

  const select = (path: string): void => {
    setActive(path)
    clearDone(path)
  }

  // The active tab lights up too while the window is in the background; coming back clears it.
  useEffect(() => {
    const onFocus = (): void => {
      if (activeRef.current) clearDone(activeRef.current)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const touchRecent = (paths: string[]): void =>
    setRecent((r) => [...paths, ...r.filter((p) => !paths.includes(p))].slice(0, RECENT_MAX))

  // No paths: pick from the projects folder.
  const open = (picked?: string[]): void => {
    if (!picked) return setPicking((n) => n + 1)
    if (!picked.length) return
    setProjects((ps) => [...ps, ...picked.filter((p) => !ps.includes(p))])
    touchRecent(picked)
    select(picked[0])
  }

  const close = (path: string): void => {
    void saveAll()
    for (const id of [...agents.map((a) => a.id), SHELL_ID]) window.api.ptyKill(`${id}:${path}`)
    statuses.current.delete(path)
    // Its views, playground versions, plugin data and notification state go too: reopened, it starts fresh.
    lastNotified.current.delete(path)
    clearDone(path)
    setView(({ [path]: _, ...v }) => v)
    setPlayVersions((r) => withoutPath(r, path))
    setPlayUnseen((s) => new Set([...s].filter((k) => pathOf(k) !== path)))
    setData((x) => withoutPath(x, path))
    // Reopening it later starts fresh on the first agent, without respawning the agents just killed.
    setTerms(({ [path]: _, ...t }) => t)
    setStarted((s) => new Set([...s].filter((id) => id.slice(id.indexOf(':') + 1) !== path)))
    touchRecent([path])
    const i = projects.indexOf(path)
    const next = projects.filter((p) => p !== path)
    setProjects(next)
    if (path === active) setActive(next[Math.max(0, i - 1)] ?? null)
  }

  const move = (from: number, to: number): void =>
    setProjects((ps) => {
      const next = [...ps]
      next.splice(to, 0, ...next.splice(from, 1))
      return next
    })

  const toggleTheme = (): void => setTheme((t) => (t === 'light' ? 'dark' : 'light'))

  const closeFile = (): void => {
    if (active) setSelected(({ [active]: _, ...rest }) => rest)
  }

  const onMenu = useRef<(cmd: MenuCommand) => void>(() => {})
  onMenu.current = (cmd) => {
    if (cmd.type === 'open') open()
    else if (cmd.type === 'close' && active) close(active)
    else if (cmd.type === 'closeFile') closeFile()
    else if (cmd.type === 'newFile') setNewFile((n) => n + 1)
    else if (cmd.type === 'quickOpen') setQuickOpen((n) => n + 1)
    else if (cmd.type === 'sendSelection') sendSelection()
    else if (cmd.type === 'tab' && projects[cmd.index]) select(projects[cmd.index])
    else if (cmd.type === 'search') setSearchFocus((n) => n + 1)
    else if (cmd.type === 'playground') togglePlay(cmd.slot)
    else if (cmd.type === 'readme') toggleReadme()
    else if (cmd.type === 'plugin') onPluginCommand(cmd.plugin, cmd.command)
    else if (cmd.type === 'web') toggleWeb(cmd.index)
    else if (cmd.type === 'folders') toggleFolders()
    else if (cmd.type === 'settings') toggleSettings()
    else if (cmd.type === 'plugins') togglePlugins()
    else if (cmd.type === 'pane') focusPane(cmd.dir)
    else if (cmd.type === 'cycle' && active && projects.length > 1) {
      const n = projects.length
      select(projects[(projects.indexOf(active) + cmd.step + n) % n])
    }
  }
  useEffect(() => window.api.onMenu((cmd) => onMenu.current(cmd)), [])

  const lastNotified = useRef(new Map<string, number>())
  const notify = (path: string, message: string): void => {
    const now = Date.now()
    if (now - (lastNotified.current.get(path) ?? 0) < 2000) return
    if (path === activeRef.current && document.hasFocus()) return
    lastNotified.current.set(path, now)
    setDone((d) => new Set(d).add(path))
    const n = new Notification(projectName(path), { body: message || 'Your agent is waiting for you' })
    n.onclick = () => {
      window.api.focus()
      // The tab may have been closed since; selecting it would bring back a project that isn't open.
      if (projectsRef.current.includes(path)) select(path)
    }
  }

  const topTabs = (
    <div className="mr-3 flex min-w-0 flex-1 items-center gap-4">
      <AgentMenu agents={agents} value={top?.id ?? ''} onChange={(id) => active && setTerms((t) => ({ ...t, [active]: id }))} />
      <div className="ml-auto min-w-0">
        {config.meters && top?.type === 'claude' && <UsageBar usage={usage} />}
        {config.meters && top?.type === 'junie' && <JunieBar balance={junie} />}
      </div>
    </div>
  )

  // Prefer the fresh status entry so the change code stays current; keep the old
  // one after a commit so the file stays open. A past commit's file stays as picked.
  const picked = active ? selected[active] : undefined
  const fresh = picked && !picked.commit ? status?.files.find((f) => f.path === picked.path) : undefined
  const file = fresh ?? picked ?? null
  const workPath = file && !file.commit ? file.path : null

  const openAt = (path: string, line: number, col: number, len: number): void => {
    if (!active) return
    const f = status?.files.find((c) => c.path === path) ?? { path, code: 'M' as const }
    setSelected((s) => ({ ...s, [active]: f }))
    setReveal((r) => ({ path, line, col, len, n: (r?.n ?? 0) + 1 }))
  }

  // An absolute path (from a plugin: a view, a ⌘-clicked definition) at a line, if it's in this repo.
  const openFile = (abs: string, line: number): void => {
    const root = status?.root ?? ''
    if (!active || !root || !abs.startsWith(`${root}/`)) return
    setView((v) => ({ ...v, [active]: undefined }))
    openAt(abs.slice(root.length + 1), line, 1, 0)
  }
  useEffect(() => setOpenFile(openFile))

  // Types @path#L12-20 into the project's claude prompt (the first claude agent), the mention
  // Claude Code's IDE integrations use. No selection: just the file.
  const sendSelection = (): void => {
    const sel = selection()
    const claude = agents.find((a) => a.type === 'claude')
    if (!active || !sel || !claude) return
    const path = sel.abs.startsWith(`${active}/`) ? sel.abs.slice(active.length + 1) : sel.abs
    const [start, end] = sel.lines ?? []
    const lines = start === undefined ? '' : start === end ? `#L${start}` : `#L${start}-${end}`
    setTerms((t) => ({ ...t, [active]: claude.id }))
    setStarted((s) => (s.has(`${claude.id}:${active}`) ? s : new Set(s).add(`${claude.id}:${active}`)))
    // A terminal started just now isn't there yet: wait for it to mount.
    requestAnimationFrame(() => pasteInto(`${claude.id}:${active}`, `@${path}${lines} `))
  }

  return (
    <div className="flex h-full flex-col">
      <Header
        projects={projects}
        active={active}
        done={done}
        onSelect={select}
        onClose={close}
        onMove={move}
        onOpen={() => open()}
        playgrounds={config.playgrounds}
        playing={playing}
        playUnseen={(slot) => !!active && playUnseen.has(`${slot}:${active}`)}
        onPlay={togglePlay}
        readme={config.readme}
        reading={reading}
        onReadme={toggleReadme}
        pluginViews={active ? viewable.map((p) => ({ id: p.id, title: p.view!.title, icon: p.view!.icon, shortcut: p.shortcut(p.view!.command) })) : []}
        pluginView={pluginView?.id ?? null}
        onPluginView={togglePluginView}
        webPages={config.webPages}
        showingWeb={showingWeb}
        onWeb={toggleWeb}
        folders={config.folders.enabled}
        browsing={browsing}
        onFolders={toggleFolders}
        configuring={configuring}
        onSettings={toggleSettings}
      />
      <div className="relative flex min-h-0 flex-1">
        {/* Always there, under the welcome screen too: the dock is made once per launch. */}
        <main ref={dockEl} className="min-h-0 min-w-0 flex-1" />
        {active && (
          <>
            {createPortal(
              <FileTree
                status={status}
                selected={workPath}
                tick={tick}
                newFile={newFile}
                onSelect={(f) => setSelected((s) => ({ ...s, [active]: f }))}
              />,
              hosts.files
            )}
            {/* Always mounted: status is briefly null on tab switch, and the query should survive it. */}
            {createPortal(<Search root={status?.root ?? ''} tick={tick} focus={searchFocus} onOpen={openAt} />, hosts.search)}
            {createPortal(
              <>
                {/* Hidden, not unmounted, under the readme: the editor is created once. */}
                <div className={`h-full ${reading ? 'invisible' : ''}`}>
                  <CodePane
                    root={status?.root ?? ''}
                    file={file}
                    theme={theme}
                    tick={tick}
                    reveal={reveal}
                    onSaved={refresh}
                    onClose={closeFile}
                    onOpen={openFile}
                  />
                </div>
                {reading && (
                  <div className="absolute inset-0">
                    <Readme project={active} root={status?.root ?? ''} tick={tick} />
                  </div>
                )}
              </>,
              hosts.editor
            )}
            {createPortal(
              projects.map((path) => (
                <Terminal key={path} project={path} agent={SHELL_ID} name="terminal" active={path === active} theme={theme} />
              )),
              hosts.terminal
            )}
            {createPortal(
              <>
                {/* Flat, so keys hold: nested arrays match by index, and moving or closing a
                    tab would rebuild these terminals (and shrink hidden PTYs to 80×24). */}
                {projects.flatMap((path) =>
                  agents
                    .filter((a, i) => i === 0 || a.id === agentOf(path) || started.has(`${a.id}:${path}`))
                    .map((a) => (
                      <Terminal
                        key={`${a.id}:${path}`}
                        project={path}
                        agent={a.id}
                        name={a.name}
                        claude={a.type === 'claude'}
                        active={path === active && a.id === agentOf(path)}
                        theme={theme}
                        title={topTabs}
                        onNotify={a.type === 'claude' ? (message) => notify(path, message) : undefined}
                      />
                    ))
                )}
                {!agents.length && (
                  <div className="flex h-full items-center justify-center text-xs text-muted">No agents. Add one in Settings (⌘,).</div>
                )}
              </>,
              hosts.agents
            )}
            {createPortal(
              <GitPanel
                key={active}
                cwd={active}
                projects={projects}
                status={status}
                selected={file}
                tab={gitTab}
                onTab={setGitTab}
                onSelect={(f) => setSelected((s) => ({ ...s, [active]: f }))}
                onChanged={refresh}
                onDiscarded={(path) => workPath === path && closeFile()}
              />,
              hosts.git
            )}
            {createPortal(<Scratch />, hosts.scratch)}
            <QuickOpen
              root={status?.root ?? ''}
              status={status}
              open={quickOpen}
              onPick={(f) => {
                setSelected((s) => ({ ...s, [active]: f }))
                setView((v) => ({ ...v, [active]: undefined }))
                focusSoon('editor')
              }}
            />
            {/* Over the whole workspace, not just the code pane: they want the room.
                Everything underneath stays mounted. */}
            {playing && (
              <div className="absolute inset-0 z-30">
                <Playground
                  project={active}
                  slot={playing}
                  name={config.playgrounds[playing - 1].name || `playground ${playing}`}
                  version={playVersions[`${playing}:${active}`] ?? null}
                />
              </div>
            )}
            {pluginView && (
              <div className="absolute inset-0 z-30">
                {pluginView.view!.render({ data: dataOf(pluginView.id), openFile })}
              </div>
            )}
            <Toasts />
          </>
        )}
        {!active && (
          <main className="absolute inset-0 z-20 flex items-center justify-center overflow-hidden bg-bg">
            {loaded && (
              <>
                <div className="relative text-center">
                  <h1 className="text-5xl font-bold tracking-tight">cuckcode</h1>
                  <button className="btn mx-auto mt-8 text-muted" onClick={() => open()}>
                    <FolderOpen className="h-4 w-4" /> Open project ⌘T
                  </button>
                  {recent.length > 0 && (
                    <div className="mx-auto mt-6 w-[420px] max-w-[90vw] text-left">
                      <div className="flex items-center px-2 pb-1 text-xs text-muted">
                        <span>Recent</span>
                        {recent.length > 1 && (
                          <button className="ml-auto hover:text-fg" onClick={() => open(recent)}>
                            Open all
                          </button>
                        )}
                      </div>
                      <ul className="max-h-[40vh] overflow-y-auto">
                        {recent.map((path) => (
                          <li key={path} className="group flex items-center rounded-sm hover:bg-hover">
                            <button
                              className="flex min-w-0 flex-1 items-baseline gap-2 px-2 py-1 text-left"
                              onClick={() => open([path])}
                            >
                              <span className="shrink-0 text-sm">{projectName(path)}</span>
                              <span className="truncate text-xs text-muted">{tildify(path)}</span>
                            </button>
                            <button
                              className="invisible mr-1 rounded-sm p-0.5 text-muted hover:text-fg group-hover:visible"
                              title="Remove from recent"
                              onClick={() => setRecent((r) => r.filter((p) => p !== path))}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                <span className="absolute bottom-3 right-4 text-xs text-muted">v{__VERSION__}</span>
              </>
            )}
          </main>
        )}
        {config.webPages.map(
          ({ url }, i) =>
            webOpened.has(url) &&
            // The first page with a URL owns its frame; a duplicate shares it.
            config.webPages.findIndex((p) => p.url === url) === i && (
              <div key={url} className={`absolute inset-0 z-30 ${config.webPages[showingWeb ?? -1]?.url === url ? '' : 'invisible'}`}>
                <WebPage url={url} />
              </div>
            )
        )}
        {foldersOpened && config.folders.enabled && (
          <div className={`absolute inset-0 z-30 ${browsing ? '' : 'invisible'}`}>
            <Folders
              dirs={config.folders.dirs}
              shown={browsing}
              onDirs={(dirs) => setConfig((c) => ({ ...c, folders: { ...c.folders, dirs } }))}
            />
          </div>
        )}
        {configuring && (
          <div className="absolute inset-0 z-40">
            <Settings
              config={config}
              theme={theme}
              onTheme={toggleTheme}
              layouts={layouts}
              onLayouts={setLayouts}
              onChange={changeConfig}
              onClose={toggleSettings}
              onPlugins={togglePlugins}
              onReset={resetAll}
            />
          </div>
        )}
        {overlay === 'plugins' && (
          <div className="absolute inset-0 z-40">
            <Plugins plugins={config.plugins} onChange={(plugins) => setConfig((c) => ({ ...c, plugins }))} onClose={() => setOverlay(null)} />
          </div>
        )}
        <ProjectPicker
          open={picking}
          dir={config.projectsDir}
          onDir={(projectsDir) => setConfig((c) => ({ ...c, projectsDir }))}
          exclude={projects}
          onPick={(path) => open([path])}
        />
      </div>
    </div>
  )
}

const RECENT_MAX = 12

// Until init answers; never saved (saving waits for init).
const EMPTY: Config = {
  projectsDir: '',
  meters: false,
  readme: false,
  folders: { enabled: false, dirs: [] },
  playgrounds: [],
  webPages: [],
  agents: [],
  plugins: []
}

const pickConfig = (s: Config): Config => ({
  projectsDir: s.projectsDir,
  meters: s.meters,
  readme: s.readme,
  folders: s.folders,
  playgrounds: s.playgrounds,
  webPages: s.webPages,
  agents: s.agents,
  plugins: s.plugins
})

// Per-project keys are `${slot or plugin id}:${path}`; neither part before the path has a colon.
const pathOf = (key: string): string => key.slice(key.indexOf(':') + 1)
const withoutPath = <T,>(r: Record<string, T>, path: string): Record<string, T> =>
  Object.fromEntries(Object.entries(r).filter(([k]) => pathOf(k) !== path))

const mapValues = <A, B>(r: Record<string, A>, f: (a: A) => B): Record<string, B> =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [k, f(v)]))

// What takes focus in each section; terminals and editors via their hidden textarea.
const TARGET: Record<Section, string> = {
  files: '[tabindex="-1"]',
  search: 'input',
  editor: 'textarea',
  agents: 'textarea',
  terminal: 'textarea',
  git: '[tabindex="-1"]',
  scratch: 'textarea'
}

function focusIn(pane: Section): boolean {
  const all = document.querySelectorAll<HTMLElement>(`[data-pane="${pane}"] ${TARGET[pane]}`)
  // Monaco forces visibility: visible inside itself, so the hidden editor host (and a
  // diff's read-only side) has to be ruled out by class.
  const el = [...all].find((e) => e.checkVisibility() && !e.closest('.invisible, .editor.original'))
  el?.focus()
  return !!el
}

// For a pane that's about to show something focusable (a file that's still loading): retries
// each frame for about half a second.
function focusSoon(pane: Section, frames = 30): void {
  if (!focusIn(pane) && frames > 0) requestAnimationFrame(() => focusSoon(pane, frames - 1))
}

// ⌘⌥+arrows: the nearest section on screen in that direction, among those showing (a tab in
// front) with something to focus. Distance is measured from the focused section's center.
function focusPane(dir: PaneDir): void {
  const from = document.activeElement?.closest<HTMLElement>('[data-pane]')
  const shown = SECTIONS.map((s) => ({ s, r: hosts[s].getBoundingClientRect() })).filter(({ r }) => r.width > 0 && r.height > 0)
  const at = from?.getBoundingClientRect() ?? shown.find(({ s }) => s === 'agents')?.r
  if (!at) return
  const cx = at.left + at.width / 2
  const cy = at.top + at.height / 2
  const ahead = (r: DOMRect): boolean =>
    dir === 'left' ? r.right <= at.left + 1 : dir === 'right' ? r.left >= at.right - 1 : dir === 'up' ? r.bottom <= at.top + 1 : r.top >= at.bottom - 1
  const overlap = (r: DOMRect): number =>
    dir === 'left' || dir === 'right' ? Math.min(r.bottom, at.bottom) - Math.max(r.top, at.top) : Math.min(r.right, at.right) - Math.max(r.left, at.left)
  const candidates = shown
    .filter(({ s, r }) => s !== from?.dataset.pane && ahead(r))
    // Prefer what lines up with the current section; then what's closest.
    .sort((a, b) => Number(overlap(b.r) > 0) - Number(overlap(a.r) > 0) || dist(a.r) - dist(b.r))
  for (const { s } of candidates) if (focusIn(s)) return

  function dist(r: DOMRect): number {
    return Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy)
  }
}

// The changelog's entries for every version newer than `last` (just the newest if `last` isn't listed).
function changesSince(last: string): string {
  const sections = changelog.split(/^## /m).slice(1)
  const seen = sections.findIndex((s) => s.startsWith(`${last} `))
  return sections
    .slice(0, seen < 0 ? 1 : seen)
    .map((s) => s.slice(s.indexOf('\n') + 1).trim())
    .join('\n')
}
