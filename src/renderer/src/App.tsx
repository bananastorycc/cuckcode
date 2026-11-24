import { Component, useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { FolderOpen, X } from 'lucide-react'
import { target } from '../../shared/agents'
import changelog from '../../../CHANGELOG.md?raw'
import type { ChangedFile, Config, GitStatus, MenuCommand, PaneDir, SavedLayout, Settings as AllSettings, Theme, ThemeChoice } from '../../shared/types'
import { SHELL_ID } from '../../shared/types'
import type { When } from '../../shared/plugin'
import AgentMenu from './components/AgentMenu'
import Confirm, { ask } from './components/Confirm'
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
import Terminal, { pasteInto, shellQuote, whenReady } from './components/Terminal'
import Toasts, { toast } from './components/Toasts'
import WebPage from './components/WebPage'
import { apply, closePanel, hosts, mount, openPanel, openPanels, panelHost, panelId, PRESETS, reveal as revealSection, SECTIONS, show as showSection, togglePanel, type Section } from './layout'
import { loadPlugins, runCommand, setCurrent, setOpenFile, setSendToAgent, setShow, usePlugins, type Registered } from './plugins'

// What's shown: the README over the code pane, or a playground slot (from 1) or a plugin's
// view (`plugin:<id>:<command>`) over the whole workspace.
type View = number | 'readme' | `plugin:${string}`

export default function App(): React.JSX.Element {
  const [loaded, setLoaded] = useState(false)
  const [projects, setProjects] = useState<string[]>([])
  const [shelved, setShelved] = useState<string[]>([])
  // The tab bar: open projects that aren't on the shelf. ⌘1–9 and ⇧⌘[ ] go by these.
  const bar = projects.filter((p) => !shelved.includes(p))
  const [active, setActive] = useState<string | null>(null)
  const [themeChoice, setTheme] = useState<ThemeChoice>('auto')
  const systemTheme = useSystemTheme()
  const theme: Theme = themeChoice === 'auto' ? systemTheme : themeChoice
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
  // Per project: the agent in front, by id, saved with the session. Unset (or since removed): the first agent.
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
  // The dock layout as last left, saved with the session (sizes included), and the named ones.
  const layoutRef = useRef<unknown>(null)
  const [layoutSaves, bumpLayout] = useReducer((n: number) => n + 1, 0)
  const [layouts, setLayouts] = useState<SavedLayout[]>([])
  const dockEl = useRef<HTMLDivElement>(null)
  // The minimized sections, joined, so a divider drag (a layout change every frame) doesn't rerender.
  const [minimized, setMinimized] = useState('')
  // The plugin panels in the dock, joined by newlines, for the same reason.
  const [panels, setPanels] = useState('')
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
  const configRef = useRef(config)
  configRef.current = config
  const slotsRef = useRef(config.playgrounds.length)
  slotsRef.current = config.playgrounds.length

  useEffect(() => {
    window.api.init().then((s) => {
      setProjects(s.projects)
      setShelved(s.shelved)
      setActive(s.active)
      setTheme(s.theme)
      setConfig(pickConfig(s))
      setTerms(s.agent)
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
      window.api.save({ ...config, projects, shelved, active, theme: themeChoice, files, agent: terms, recent, layout: layoutRef.current, layouts })
    }
  }, [loaded, projects, shelved, active, themeChoice, selected, terms, config, recent, layoutSaves, layouts])

  // The dock, once the saved layout is known. Dragging a divider changes the layout every frame;
  // it's saved once that settles.
  useEffect(() => {
    if (!loaded || !dockEl.current) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const unmount = mount(dockEl.current, layoutRef.current, (layout, minimized) => {
      layoutRef.current = layout
      setMinimized(minimized.join())
      setPanels(openPanels(layout).join('\n'))
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

  // Whether a plugin's view or panel is offered: by its when, else while a project is open and has
  // the plugin's data (or the plugin keeps none). A when that throws offers nothing.
  const offered = (p: Registered, when: When<unknown> | undefined): boolean => {
    if (!when) return !!active && (!p.source || dataOf(p.id) !== null)
    try {
      return !!when(dataOf(p.id), active)
    } catch (err) {
      console.error(`plugin ${p.id}:`, err)
      return false
    }
  }
  // A plugin can have several views, one per command. They can show over the home screen too, so
  // which one is showing is kept per project, and under '' with none open.
  const here = active ?? ''
  const viewKey = (plugin: string, command: string) => `plugin:${plugin}:${command}` as const
  const views = plugins.flatMap((p) => p.views.filter((v) => offered(p, v.when)).map((v) => ({ key: viewKey(p.id, v.command), plugin: p, view: v })))
  const togglePluginView = (key: string): void => {
    const found = views.find((v) => v.key === key)
    if (found) setView((v) => ({ ...v, [here]: v[here] === found.key ? undefined : found.key }))
  }
  const hidePluginView = (key: string): void => setView((v) => (v[here] === key ? { ...v, [here]: undefined } : v))
  const pluginView = views.find((v) => view[here] === v.key) ?? null
  // Panels live in the workspace, so they're offered only with a project open.
  const paneled = active
    ? plugins.flatMap((p) => p.panels.filter((x) => offered(p, x.when)).map((panel) => ({ id: panelId(p.id, panel.id), plugin: p, panel })))
    : []
  const openPanelIds = panels ? panels.split('\n') : []
  const onPluginCommand = (plugin: string, command: string): void => {
    const p = plugins.find((x) => x.id === plugin)
    const v = views.find((x) => x.plugin === p && x.view.command === command)
    const panel = paneled.find((x) => x.plugin === p && x.panel.command === command)
    if (v) togglePluginView(v.key)
    else if (panel) togglePanel(panel.id, panel.panel.title, panel.panel.dock)
    // A view's or panel's command does nothing while it isn't offered.
    else if (!p?.views.some((x) => x.command === command) && !p?.panels.some((x) => x.command === command)) runCommand(plugin, command)
  }
  // A plugin's show() and hide(): like its button, but only ever opening (on) or closing.
  const showPlugin = (plugin: string, command: string, on: boolean): boolean => {
    const key = viewKey(plugin, command)
    const panel = plugins.find((x) => x.id === plugin)?.panels.find((x) => x.command === command)
    if (!on) {
      hidePluginView(key)
      if (panel) closePanel(panelId(plugin, panel.id))
      return true
    }
    if (views.some((v) => v.key === key)) {
      setView((v) => ({ ...v, [here]: key }))
      return true
    }
    const offer = paneled.find((x) => x.plugin.id === plugin && x.panel.command === command)
    if (offer) openPanel(offer.id, offer.panel.title, offer.panel.dock)
    return !!offer
  }
  useEffect(() => setShow(showPlugin))
  // What a plugin panel's tab shows: the plugin's content, or why there's none.
  const panelContent = (id: string): ReactNode => {
    const p = plugins.find((x) => id.startsWith(`plugin:${x.id}:`))
    const panel = p?.panels.find((x) => panelId(p.id, x.id) === id)
    const note = (text: string): ReactNode => <div className="p-3 text-xs text-muted">{text}</div>
    if (!p || !panel) return note("This panel's plugin isn't loaded.")
    if (!offered(p, panel.when)) return note(`${p.name} has nothing for this project.`)
    return (
      <Quiet what={`${p.id} panel`} reset={active} fallback={note(`${panel.title} hit an error (see the console).`)}>
        {panel.render({ data: dataOf(p.id), root: active, openFile, close: () => closePanel(id) })}
      </Quiet>
    )
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

  // Settings from an imported file or the config repo. The session (projects, files, the dock) is untouched.
  const applySettings = (s: AllSettings): void => {
    changeConfig(pickConfig(s))
    setTheme(s.theme)
    setLayouts(s.layouts)
  }
  const applyRef = useRef(applySettings)
  applyRef.current = applySettings
  useEffect(() => window.api.onRemoteConfig((s) => applyRef.current(s)), [])

  // Settings back to a fresh install's, except what's wired to this machine: the installed
  // plugins (dropping them would orphan their folders) and the config repo.
  const resetAll = async (): Promise<void> => {
    const d = await window.api.defaults()
    changeConfig({ ...pickConfig(d), plugins: config.plugins, configRepo: config.configRepo })
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

  // Selecting a shelved project (from the shelf or its notification) puts it back on the bar.
  const select = (path: string): void => {
    setActive(path)
    clearDone(path)
    setShelved((s) => (s.includes(path) ? s.filter((p) => p !== path) : s))
  }

  // The bar neighbour that takes over when the active tab leaves it.
  const neighbour = (path: string): string | null => {
    const i = bar.indexOf(path)
    const next = bar.filter((p) => p !== path)
    return next[Math.max(0, i - 1)] ?? null
  }

  // The bar never empties while projects are open: with no active project the workspace
  // unmounts, taking every terminal (and the shelved agents' notifications) with it.
  const shelve = (path: string): void => {
    if (bar.length < 2) return
    setShelved((s) => [...s, path])
    if (path === active) setActive(neighbour(path))
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
    setProjects(projects.filter((p) => p !== path))
    setShelved((s) => s.filter((p) => p !== path))
    // The last tab on the bar: the first shelved project comes back in its place.
    if (path === active) {
      const next = neighbour(path)
      if (!next && shelved.length) select(shelved[0])
      else setActive(next)
    }
  }

  // From and to are bar positions; shelved projects keep their places in between.
  const move = (from: number, to: number): void =>
    setProjects((ps) => {
      const next = [...ps]
      next.splice(ps.indexOf(bar[to]), 0, ...next.splice(ps.indexOf(bar[from]), 1))
      return next
    })

  const closeFile = (): void => {
    if (active) setSelected(({ [active]: _, ...rest }) => rest)
  }

  const onMenu = useRef<(cmd: MenuCommand) => void>(() => {})
  onMenu.current = (cmd) => {
    if (cmd.type === 'open') open()
    // Kills the project's terminals, so the shortcut asks first; the tab's × is deliberate enough.
    else if (cmd.type === 'close' && active) {
      const path = active
      ask({ title: `Close ${projectName(path)}?`, detail: 'Its terminals and agents are stopped.', action: 'Close project', danger: true }).then(
        (yes) => yes && close(path)
      )
    }
    else if (cmd.type === 'closeFile') closeFile()
    else if (cmd.type === 'newFile') setNewFile((n) => n + 1)
    else if (cmd.type === 'quickOpen') setQuickOpen((n) => n + 1)
    else if (cmd.type === 'sendSelection') sendSelection()
    else if (cmd.type === 'tab' && bar[cmd.index]) select(bar[cmd.index])
    else if (cmd.type === 'search') {
      revealSection('search')
      setSearchFocus((n) => n + 1)
    }
    else if (cmd.type === 'playground') togglePlay(cmd.slot)
    else if (cmd.type === 'readme') toggleReadme()
    else if (cmd.type === 'plugin') onPluginCommand(cmd.plugin, cmd.command)
    else if (cmd.type === 'web') toggleWeb(cmd.index)
    else if (cmd.type === 'folders') toggleFolders()
    else if (cmd.type === 'settings') toggleSettings()
    else if (cmd.type === 'plugins') togglePlugins()
    else if (cmd.type === 'pane') focusPane(cmd.dir)
    else if (cmd.type === 'cycle' && active && bar.length > 1) {
      const n = bar.length
      select(bar[(bar.indexOf(active) + cmd.step + n) % n])
    }
  }
  useEffect(() => window.api.onMenu((cmd) => onMenu.current(cmd)), [])
  // Pane moves (⌃⇧arrows) and project moves (⇧⌘[ ]) are handled here, before Monaco and xterm
  // take them (⇧⌘[ folds in Monaco, ⌃⇧←/→ grow and shrink its selection). Left unhandled they'd
  // go back to macOS, which can't match them to their menu items (⇧[ arrives as '{', arrows
  // carry the fn flag) and beeps.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.altKey || !e.shiftKey) return
      const dir = e.ctrlKey && !e.metaKey ? ARROWS[e.key] : undefined
      // By physical key, since ⌘⇧[ reports key '{'.
      const step = e.metaKey && !e.ctrlKey ? BRACKETS[e.code] : undefined
      if (dir) onMenu.current({ type: 'pane', dir })
      else if (step) onMenu.current({ type: 'cycle', step })
      else return
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const lastNotified = useRef(new Map<string, number>())
  const notify = (path: string, message: string): void => {
    const now = Date.now()
    if (now - (lastNotified.current.get(path) ?? 0) < 2000) return
    if (path === activeRef.current && document.hasFocus()) return
    lastNotified.current.set(path, now)
    setDone((d) => new Set(d).add(path))
    // Off in settings: the tab still lights up.
    if (!configRef.current.notifications) return
    const n = new Notification(projectName(path), { body: message || 'Your agent is waiting for you' })
    n.onclick = () => {
      window.api.focus()
      // The tab may have been closed since; selecting it would bring back a project that isn't open.
      if (projectsRef.current.includes(path)) select(path)
    }
  }

  const topTabs = (
    <div className="mr-2 flex min-w-0 flex-1 items-center gap-2">
      <AgentMenu agents={agents} value={top?.id ?? ''} onChange={(id) => active && setTerms((t) => ({ ...t, [active]: id }))} />
      <div className="flex min-w-0 flex-1 justify-end">
        {top &&
          plugins.flatMap((p) =>
            p.bar.map((Item, i) => (
              <Quiet key={`${p.id}:${i}`}>
                <Item agent={top} />
              </Quiet>
            ))
          )}
      </div>
    </div>
  )

  // Prefer the fresh status entry so the change code stays current; keep the old
  // one after a commit so the file stays open. A past commit's file stays as picked.
  const picked = active ? selected[active] : undefined
  const fresh = picked && !picked.commit ? status?.files.find((f) => f.path === picked.path) : undefined
  const file = fresh ?? picked ?? null
  const workPath = file && !file.commit ? file.path : null

  // A file to show, brought to the front if the editor is minimized or behind another tab.
  const pick = (f: ChangedFile): void => {
    if (!active) return
    setSelected((s) => ({ ...s, [active]: f }))
    revealSection('editor')
  }

  const openAt = (path: string, line: number, col: number, len: number): void => {
    if (!active) return
    pick(status?.files.find((c) => c.path === path) ?? { path, code: 'M' as const })
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

  // Shows an agent (starting it if it wasn't running) and resolves once its prompt is up.
  const wake = (path: string, agentId: string): Promise<boolean> => {
    const id = `${agentId}:${path}`
    revealSection('agents')
    setTerms((t) => ({ ...t, [path]: agentId }))
    setStarted((s) => (s.has(id) ? s : new Set(s).add(id)))
    return whenReady(id)
  }

  // Types the selection into an agent, as @path#L12-20 (the mention Claude Code's IDE
  // integrations use) for one with mentions on, else as a quoted path. No selection: just the file.
  const sendSelection = (): void => {
    const sel = selection()
    if (!active || !sel) return
    const to = target(agents, agentOf(active), (a) => a.mentions) ?? top
    if (!to) return toast(false, 'Send Selection', 'No agent to send it to. Add one in Settings › Agents.')
    const path = sel.abs.startsWith(`${active}/`) ? sel.abs.slice(active.length + 1) : sel.abs
    const [start, end] = sel.lines ?? []
    const lines = start === undefined ? '' : start === end ? `#L${start}` : `#L${start}-${end}`
    const text = to.mentions ? `@${path}${lines} ` : `${shellQuote(path)}${lines && ` (lines ${lines.slice(2)})`} `
    const id = `${to.id}:${active}`
    void wake(active, to.id).then((ready) => ready && pasteInto(id, text))
  }

  // A playground page's Done: back to the workspace, and tell the agent that takes playground
  // answers (the one in front, else the first) to read them, as if typed there. The Enter goes
  // separately, after the paste, or the agent takes it as part of the pasted text.
  const playDone = (slot: number): void => {
    const name = config.playgrounds[slot - 1]?.name || `playground ${slot}`
    void tellAgent(`I'm done in the ${name}: read .cuckcode/playground/${slot}/data/answers.json and act on it.`, true, 'Playground')
  }

  // Back to the workspace, and type text into the agent that takes playground answers, as if
  // typed there; with submit, Enter follows. Playground Done and plugins (sendToAgent) use it.
  const tellAgent = async (text: string, submit: boolean, from: string): Promise<boolean> => {
    if (!active) return false
    const to = target(agents, agentOf(active), (a) => a.playground)
    if (!to) {
      toast(false, from, 'No agent takes playground answers. Turn Playground on for one in Settings › Agents.')
      return false
    }
    const id = `${to.id}:${active}`
    setView((v) => ({ ...v, [active]: undefined }))
    if (!(await wake(active, to.id)) || !pasteInto(id, text)) return false
    if (submit) setTimeout(() => window.api.ptyWrite(id, '\r'), 150)
    return true
  }
  useEffect(() => setSendToAgent(tellAgent))

  return (
    <div className="flex h-full flex-col">
      <Header
        projects={bar}
        shelved={shelved}
        active={active}
        done={done}
        onSelect={select}
        onClose={close}
        onShelve={shelve}
        onMove={move}
        onOpen={() => open()}
        playgrounds={config.playgrounds}
        playing={playing}
        playUnseen={(slot) => !!active && playUnseen.has(`${slot}:${active}`)}
        onPlay={togglePlay}
        readme={config.readme}
        reading={reading}
        onReadme={toggleReadme}
        pluginViews={views
          .filter((v) => v.view.button !== false)
          .map((v) => ({ id: v.key, title: v.view.title, icon: v.view.icon, shortcut: v.plugin.shortcut(v.view.command) }))}
        pluginView={pluginView?.key ?? null}
        onPluginView={togglePluginView}
        pluginPanels={paneled
          .filter((x) => x.panel.button !== false)
          .map((x) => ({ id: x.id, title: x.panel.title, icon: x.panel.icon, shortcut: x.plugin.shortcut(x.panel.command), open: openPanelIds.includes(x.id) }))}
        onPluginPanel={(id, title) => togglePanel(id, title, paneled.find((x) => x.id === id)?.panel.dock)}
        webPages={config.webPages}
        showingWeb={showingWeb}
        onWeb={toggleWeb}
        folders={config.folders.enabled}
        browsing={browsing}
        onFolders={toggleFolders}
        configuring={configuring}
        onSettings={toggleSettings}
        minimized={minimized ? (minimized.split(',') as Section[]) : []}
        onRestore={showSection}
      />
      <div className="relative flex min-h-0 flex-1">
        {/* Always there, under the welcome screen too: the dock is made once per launch.
            isolate keeps dockview's z-indexes (sashes 99, overlays 999) inside it, under the playground. */}
        <main ref={dockEl} className="isolate min-h-0 min-w-0 flex-1" />
        {active && (
          <>
            {createPortal(
              <FileTree
                status={status}
                selected={workPath}
                tick={tick}
                newFile={newFile}
                onSelect={pick}
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
                        mentions={a.mentions}
                        newline={a.newline}
                        active={path === active && a.id === agentOf(path)}
                        theme={theme}
                        title={topTabs}
                        onNotify={a.notify ? (message) => notify(path, message) : undefined}
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
                ai={!!config.commitCommand.trim()}
                confirmAllRepos={config.confirmAllRepos}
                onDontConfirm={() => setConfig((c) => ({ ...c, confirmAllRepos: false }))}
                status={status}
                selected={file}
                tab={gitTab}
                onTab={setGitTab}
                onSelect={pick}
                onChanged={refresh}
                onDiscarded={(path) => workPath === path && closeFile()}
              />,
              hosts.git
            )}
            {createPortal(<Scratch />, hosts.scratch)}
            {openPanelIds.map((id) => createPortal(panelContent(id), panelHost(id), id))}
            <QuickOpen
              root={status?.root ?? ''}
              status={status}
              open={quickOpen}
              onPick={(f) => {
                pick(f)
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
                  theme={theme}
                  onDone={() => playDone(playing)}
                  onClose={() => togglePlay(playing)}
                />
              </div>
            )}
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
        {/* Over the project's workspace, or the home screen for a view offered there. One that throws
            shows a note instead of taking the window down; another project gives it another try. */}
        {pluginView && (
          <div className="absolute inset-0 z-30">
            <Quiet
              key={pluginView.key}
              what={`${pluginView.plugin.id} view`}
              reset={active}
              fallback={<div className="h-full bg-bg p-3 text-xs text-muted">{pluginView.view.title} hit an error (see the console).</div>}
            >
              {pluginView.view.render({ data: dataOf(pluginView.plugin.id), root: active, openFile, close: () => hidePluginView(pluginView.key) })}
            </Quiet>
          </div>
        )}
        <Toasts />
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
              theme={themeChoice}
              onTheme={setTheme}
              layouts={layouts}
              onLayouts={setLayouts}
              onChange={changeConfig}
              onClose={toggleSettings}
              onPlugins={togglePlugins}
              onReset={resetAll}
              onImport={applySettings}
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
        <Confirm />
      </div>
    </div>
  )
}

const RECENT_MAX = 12

// Until init answers; never saved (saving waits for init).
const EMPTY: Config = {
  projectsDir: '',
  notifications: false,
  commitCommand: '',
  confirmAllRepos: true,
  readme: false,
  folders: { enabled: false, dirs: [] },
  playgrounds: [],
  webPages: [],
  agents: [],
  plugins: [],
  configRepo: ''
}

const pickConfig = (s: Config): Config => ({
  projectsDir: s.projectsDir,
  notifications: s.notifications,
  commitCommand: s.commitCommand,
  confirmAllRepos: s.confirmAllRepos,
  readme: s.readme,
  folders: s.folders,
  playgrounds: s.playgrounds,
  webPages: s.webPages,
  agents: s.agents,
  plugins: s.plugins,
  configRepo: s.configRepo
})

// A plugin's title-bar item, view or panel that throws drops out (or shows fallback) instead of taking
// the window down with it. A change of reset (the project, for a view or panel) gives it another try.
class Quiet extends Component<{ children: ReactNode; what?: string; reset?: unknown; fallback?: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  componentDidCatch(err: unknown): void {
    console.error(`plugin ${this.props.what ?? 'agent bar'}:`, err)
  }
  componentDidUpdate(prev: { reset?: unknown }): void {
    if (this.state.failed && prev.reset !== this.props.reset) this.setState({ failed: false })
  }
  render(): ReactNode {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children
  }
}

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

// ⌃⇧arrows: the nearest section on screen in that direction, among those showing (a tab in
// front) with something to focus. Distance is measured from the focused section's center.
const ARROWS: Record<string, PaneDir> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }
const BRACKETS: Record<string, 1 | -1> = { BracketLeft: -1, BracketRight: 1 }

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

// The system's appearance, live. Light only when the system says so; anything else is dark.
function useSystemTheme(): Theme {
  const query = (): MediaQueryList => window.matchMedia('(prefers-color-scheme: light)')
  const [light, setLight] = useState(() => query().matches)
  useEffect(() => {
    const q = query()
    const on = (): void => setLight(q.matches)
    q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  }, [])
  return light ? 'light' : 'dark'
}
