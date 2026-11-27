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
import { contextMenu } from './components/ContextMenu'
import CodePane, { saveAll, selection, selectionIn, type Reveal } from './components/CodePane'
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
import Terminal, { pasteInto, whenReady } from './components/Terminal'
import { shellQuote } from './xterm'
import Toasts, { toast } from './components/Toasts'
import WebPage from './components/WebPage'
import {
  apply,
  closePanel,
  hosts,
  mount,
  openPanel,
  openPanels,
  panelHost,
  panelId,
  panelShowing,
  PRESETS,
  reveal as revealSection,
  SECTIONS,
  setPanelTitle,
  show as showSection,
  type Section
} from './layout'
import { agentProject, offer, offeredAt, pageState, pluginOfPanel, remember, used, type Page } from './pages'
import { message, pluginError } from './errors'
import { isEmbedded, PageProject, playChanged, playKey, setPlay, setPlayHandlers } from './play'
import { loadPlugins, pluginNow, projectSwitched, reloadPlugins, runCommand, setActiveFile, setCurrent, setOpenFile, setSaveAll, setSendToAgent, setShow, usePlugins, type Registered, type Send } from './plugins'

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
  // Per plugin: its homes, the projects its data last came from, most recently opened first.
  const [pluginHomes, setPluginHomes] = useState<Record<string, string[]>>({})
  const pluginHomesRef = useRef(pluginHomes)
  pluginHomesRef.current = pluginHomes
  // Per tab: the project its plugin view is for, when that's a home other than the tab's own.
  const [viewFor, setViewFor] = useState<Record<string, string | undefined>>({})
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
      setPluginHomes(s.pluginHomes)
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
      window.api.save({ ...config, projects, shelved, active, theme: themeChoice, files, agent: terms, recent, layout: layoutRef.current, layouts, pluginHomes })
    }
  }, [loaded, projects, shelved, active, themeChoice, selected, terms, config, recent, layoutSaves, layouts, pluginHomes])

  // The dock, once the saved layout is known. Dragging a divider changes the layout every frame;
  // it's saved once that settles.
  useEffect(() => {
    if (!loaded || !dockEl.current) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const unmount = mount(dockEl.current, layoutRef.current, (layout, minimized) => {
      layoutRef.current = layout
      setMinimized(minimized.join())
      setPanels(openPanels(layout).map((p) => `${p.id}\t${p.project ?? ''}`).join('\n'))
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
  // project, which hides its view. Overlapping loads collapse into one rerun. Each load updates
  // where the plugin is remembered to have data (its homes). A load that a reload overtook is
  // the old version's: it's dropped and run again by the new one.
  const plugins = usePlugins()
  const pluginsRef = useRef(plugins)
  pluginsRef.current = plugins
  useEffect(() => void loadPlugins(), [])
  const [data, setData] = useState<Record<string, unknown>>({})
  const dataRef = useRef(data)
  dataRef.current = data
  const loading = useRef(new Map<string, boolean>())
  const loadData = useCallback(async (id: string, path: string) => {
    const key = `${id}:${path}`
    if (loading.current.has(key)) return void loading.current.set(key, true)
    do {
      loading.current.set(key, false)
      const p = pluginNow(id)
      const source = p?.source
      if (!p || !source) break
      const r = await Promise.resolve()
        .then(() => source.load(path))
        .catch((err: unknown) => (pluginError(p, 'load', err), null))
      if (pluginNow(id)?.source !== source) {
        loading.current.set(key, true)
        continue
      }
      // Unchanged data keeps its identity, so views (a laid-out graph) don't redo their work.
      setData((x) => (key in x && JSON.stringify(x[key]) === JSON.stringify(r) ? x : { ...x, [key]: r }))
      setPluginHomes((h) => remember(h, id, path, r !== null && r !== undefined))
    } while (loading.current.get(key))
    loading.current.delete(key)
  }, [])
  // A plugin reloaded (or gone): its old version's data goes, so the new one's pages never get it.
  const regs = useRef(new Map<string, number>())
  useEffect(() => {
    const now = new Map(plugins.map((p) => [p.id, p.key]))
    const stale = [...regs.current].filter(([id, key]) => now.get(id) !== key).map(([id]) => id)
    regs.current = now
    if (stale.length) setData((x) => Object.fromEntries(Object.entries(x).filter(([k]) => !stale.includes(k.slice(0, k.indexOf(':'))))))
  }, [plugins])
  const dataFor = (id: string, project: string | null): unknown => (project ? (data[`${id}:${project}`] ?? null) : null)
  const dataOf = (id: string): unknown => dataFor(id, active)
  useEffect(() => {
    for (const p of plugins) setCurrent(p.id, dataOf(p.id))
  })

  // A plugin with no homes remembered gets the projects folder looked through once, in the
  // background and a project at a time (each plugin on its own, so one whose load never settles
  // holds up only itself). What it finds is remembered (nothing found too), so a launch doesn't
  // do it again; a project opened later is found by its own load.
  const scanned = useRef(new Set<string>())
  useEffect(() => {
    const dir = config.projectsDir
    if (!loaded || !dir) return
    const todo = plugins.filter((p) => p.source && !(p.id in pluginHomesRef.current) && !scanned.current.has(p.id))
    if (!todo.length) return
    todo.forEach((p) => scanned.current.add(p.id))
    void (async () => {
      const paths = await window.api.repos(dir).catch((): string[] => [])
      for (const p of todo) {
        void (async () => {
          const found: string[] = []
          for (const path of paths) {
            const r = await Promise.resolve()
              .then(() => p.source!.load(path))
              .catch((err: unknown) => (pluginError(p, 'load', err), null))
            if (r !== null && r !== undefined) found.push(path)
          }
          setPluginHomes((h) => ({ ...h, [p.id]: [...(h[p.id] ?? []), ...found.filter((f) => !h[p.id]?.includes(f))] }))
        })()
      }
    })()
  }, [loaded, plugins, config.projectsDir])

  // The first look at a slot only sets the baseline, so a page left from last time isn't news.
  const checkPlay = useCallback(async (path: string) => {
    const slots = Array.from({ length: slotsRef.current }, (_, i) => i + 1)
    const versions = await Promise.all(slots.map((slot) => window.api.playVersion(path, slot).catch(() => null)))
    slots.forEach((slot, i) => {
      const key = playKey(slot, path)
      const v = versions[i]
      const seen = key in playVersionsRef.current
      if (seen && v === playVersionsRef.current[key]) return
      setPlayVersions((r) => ({ ...r, [key]: v }))
      if (!seen || v === null) return
      // Showing in full or inside a plugin's view, it's seen as it changes.
      if (viewRef.current[path] !== slot && !isEmbedded(key)) setPlayUnseen((s) => new Set(s).add(key))
      playChanged(slot, path)
    })
  }, [])

  useEffect(() => {
    refresh()
  }, [active, refresh])

  useEffect(() => {
    if (active) for (const p of plugins) if (p.source) loadData(p.id, active)
  }, [active, plugins, loadData])

  useEffect(() => {
    if (active) checkPlay(active)
  }, [active, checkPlay, config.playgrounds.length])

  useEffect(
    () =>
      window.api.onFsChange((dir, paths) => {
        // The tab in front, and the homes plugin pages away from home are showing.
        const front = dir === activeRef.current
        if (!front && !awayRef.current.has(dir)) return
        if (front) refresh()
        checkPlay(dir)
        // A project a plugin has nothing for is rechecked when its tab is next opened, not on
        // every change; otherwise only for changes the plugin says could matter.
        for (const p of pluginsRef.current) {
          const d = dataRef.current[`${p.id}:${dir}`]
          if (p.source && (front ? d !== null : d !== null && d !== undefined) && (p.source.relevant?.(paths) ?? true)) loadData(p.id, dir)
        }
        if (front) setTick((t) => t + 1)
      }),
    [refresh, checkPlay, loadData]
  )

  // Shows next over the project (or the home screen, ''), or hides it when it's showing. A web page
  // or the folders cover it, so while one's up, showing it brings it out from under them instead.
  const toggleView = (where: string, next: View): void => {
    const covered = showingWeb !== null || browsing
    if (isCovered()) setOverlay(null)
    setView((v) => ({ ...v, [where]: v[where] === next && !covered ? undefined : next }))
  }
  // What a plugin's embedded playground shows: the slots of the project its page is for.
  useEffect(() => {
    const names = config.playgrounds.map((p, i) => p.name || `playground ${i + 1}`)
    setPlay({ project: active, names, versions: playVersions, theme })
  }, [active, config.playgrounds, playVersions, theme])
  const unseen = (key: string): void =>
    setPlayUnseen((s) => {
      if (!s.has(key)) return s
      const next = new Set(s)
      next.delete(key)
      return next
    })
  const togglePlay = (slot: number): void => {
    if (!active || slot > config.playgrounds.length) return
    toggleView(active, slot)
    unseen(playKey(slot, active))
  }
  const shown = active ? view[active] : undefined
  // A slot since removed in settings just stops showing.
  const playing = typeof shown === 'number' && shown <= config.playgrounds.length ? shown : null

  const toggleReadme = (): void => {
    if (active && config.readme) toggleView(active, 'readme')
  }
  const reading = config.readme && shown === 'readme'

  // A plugin's pages (views and panels) and the project each opens for (pages.ts): the tab's own when
  // the plugin offers it there, else one of the plugin's homes.
  const report =
    (p: Registered) =>
    (err: unknown): void =>
      pluginError(p, 'when', err)
  const pageOf = (p: Registered, when: When<unknown> | undefined, panel: boolean): Page => ({ source: !!p.source, when, panel })
  const offerOf = (p: Registered, when: When<unknown> | undefined, panel: boolean): ReturnType<typeof offer> =>
    offer(pageOf(p, when, panel), p.id, active, pluginHomes[p.id] ?? [], data, report(p))
  // How a page for project stands: the tab's own as ever (hidden until its data is in), a home's
  // loading in the background first.
  const stateAt = (p: Registered, when: When<unknown> | undefined, panel: boolean, project: string | null): ReturnType<typeof pageState> =>
    project === active
      ? offeredAt(pageOf(p, when, panel), dataOf(p.id), active, report(p))
        ? 'ready'
        : 'gone'
      : pageState(pageOf(p, when, panel), p.id, project!, data, report(p))
  const note = (text: string): ReactNode => <div className="h-full bg-bg p-3 text-xs text-muted">{text}</div>
  // A web page or the folders cover the workspace: showing a view brings it out from under them.
  const isCovered = (): boolean => showingWeb !== null || browsing

  // A plugin can have several views, one per command. They can show over the home screen too, so
  // which one is showing is kept per project, and under '' with none open.
  const here = active ?? ''
  const viewKey = (plugin: string, command: string) => `plugin:${plugin}:${command}` as const
  const allViews = plugins.flatMap((p) => p.views.map((v) => ({ key: viewKey(p.id, v.command), plugin: p, view: v })))
  const views = allViews.filter((v) => offerOf(v.plugin, v.view.when, false))
  const shownView = allViews.find((v) => v.key === view[here]) ?? null
  const viewProject = shownView ? (viewFor[here] ?? active) : null
  const viewState = shownView ? stateAt(shownView.plugin, shownView.view.when, false, viewProject) : 'gone'
  const pluginView = viewState === 'gone' ? null : shownView
  const clearView = (where: string): void => {
    setView((v) => (v[where] === undefined ? v : { ...v, [where]: undefined }))
    setViewFor((f) => (f[where] === undefined ? f : { ...f, [where]: undefined }))
  }
  const hidePluginView = (key: string): void => {
    if (view[here] === key) clearView(here)
  }

  // Panels live in the workspace, so from the home screen they open in their home's tab.
  const allPanels = plugins.flatMap((p) => p.panels.map((panel) => ({ id: panelId(p.id, panel.id), plugin: p, panel })))
  const paneled = allPanels.filter((x) => offerOf(x.plugin, x.panel.when, true))
  // The dock's plugin panels, each with the project it's tied to (null: the tab in front's).
  const openList = panels
    ? panels.split('\n').map((line) => {
        const [id, project] = line.split('\t')
        return { id, project: project || null }
      })
    : []
  const openPanelIds = openList.map((o) => o.id)

  // A project a page away from home is for, opened in the background (shelved) when it isn't open.
  // Only once it's known to be a folder: a remembered home or a tied panel's project may be gone.
  const shelveOpen = (path: string): void => {
    setProjects((ps) => (ps.includes(path) ? ps : [...ps, path]))
    setShelved((s) => (s.includes(path) ? s : [...s, path]))
  }
  const visit = (path: string): void => {
    if (!projectsRef.current.includes(path)) void isFolder(path).then((ok) => ok && shelveOpen(path))
  }
  // A project brought to the front: put back on the bar, or opened.
  const bring = (path: string): void => (projectsRef.current.includes(path) ? select(path) : open([path]))
  // Shows a page for project through show(where), where being the tab it shows in. From the home
  // screen, the home opens as a tab first.
  const openFor = (p: Registered, project: string | null, show: (where: string) => void): void => {
    if (project && project !== active) setPluginHomes((h) => used(h, p.id, project))
    if (project && !active) {
      void (async () => {
        if (projectsRef.current.includes(project) || (await isFolder(project))) {
          open([project])
          return show(project)
        }
        setPluginHomes((h) => remember(h, p.id, project, false))
        toast(false, p.name, `${tildify(project)} is gone.`)
      })()
      return
    }
    if (project && project !== active) visit(project)
    show(here)
  }
  // The project a page opens for from here; ask: let the user pick among several homes (else the
  // one opened last). null: it isn't offered, or the pick was dismissed.
  const chooseHome = async (p: Registered, when: When<unknown> | undefined, panel: boolean, id: string, ask: boolean): Promise<{ project: string | null } | null> => {
    const o = offerOf(p, when, panel)
    if (!o) return null
    if ('for' in o) return { project: o.for }
    if (!ask) return { project: o.ask[0] }
    const anchor = document.querySelector(`[data-page="${CSS.escape(id)}"]`) ?? document.querySelector('header') ?? undefined
    const i = await contextMenu(
      o.ask.map((path) => `${projectName(path)}\t${tildify(path)}`),
      anchor
    )
    return i === null ? null : { project: o.ask[i] }
  }

  const showViewFor = (v: (typeof allViews)[number], project: string | null): void => {
    if (isCovered()) setOverlay(null)
    openFor(v.plugin, project, (where) => {
      setView((x) => ({ ...x, [where]: v.key }))
      setViewFor((f) => ({ ...f, [where]: project && project !== where ? project : undefined }))
    })
  }
  // Its button and command: hides it when it's showing (or brings it out from under a web page or
  // the folders), else opens it, asking which home when there are several.
  const togglePluginView = async (key: string): Promise<void> => {
    const v = allViews.find((x) => x.key === key)
    if (!v) return
    if (pluginView?.key === key) return isCovered() ? setOverlay(null) : hidePluginView(key)
    const to = await chooseHome(v.plugin, v.view.when, false, key, true)
    if (to) showViewFor(v, to.project)
  }
  const showPanelFor = (x: (typeof allPanels)[number], project: string | null): void =>
    openFor(x.plugin, project, (where) => openPanel(x.id, x.panel.title, x.panel.dock, project && project !== where ? project : null))
  const togglePluginPanel = async (id: string): Promise<void> => {
    const x = allPanels.find((y) => y.id === id)
    if (!x) return
    if (panelShowing(id)) return closePanel(id)
    const to = await chooseHome(x.plugin, x.panel.when, true, id, true)
    if (to) showPanelFor(x, to.project)
  }
  const onPluginCommand = (plugin: string, command: string): void => {
    const p = plugins.find((x) => x.id === plugin)
    const v = views.find((x) => x.plugin === p && x.view.command === command)
    const panel = paneled.find((x) => x.plugin === p && x.panel.command === command)
    if (v) void togglePluginView(v.key)
    else if (panel) void togglePluginPanel(panel.id)
    // A view's or panel's command does nothing while it isn't offered.
    else if (!p?.views.some((x) => x.command === command) && !p?.panels.some((x) => x.command === command)) runCommand(plugin, command)
  }
  // A plugin's show() and hide(): like its button, but only ever opening (on) or closing, and
  // never asking: away from home, the home opened last.
  const showPlugin = (plugin: string, command: string, on: boolean): boolean => {
    const v = allViews.find((x) => x.plugin.id === plugin && x.view.command === command)
    const x = allPanels.find((y) => y.plugin.id === plugin && y.panel.command === command)
    if (!on) {
      if (v) hidePluginView(v.key)
      if (x) closePanel(x.id)
      return true
    }
    if (v) {
      if (pluginView?.key === v.key) {
        if (isCovered()) setOverlay(null)
        return true
      }
      const o = offerOf(v.plugin, v.view.when, false)
      if (o) showViewFor(v, 'for' in o ? o.for : o.ask[0])
      return !!o
    }
    if (!x) return false
    const already = openList.find((o) => o.id === x.id)
    if (already) {
      openPanel(x.id, x.panel.title, x.panel.dock, already.project)
      return true
    }
    const o = offerOf(x.plugin, x.panel.when, true)
    if (o) showPanelFor(x, 'for' in o ? o.for : o.ask[0])
    return !!o
  }
  useEffect(() => setShow(showPlugin))

  // What a page gets: everything is its project's, its home when it's shown away from it.
  const pageProps = (project: string | null, close: () => void): { root: string | null; openFile: (abs: string, line: number) => void; close: () => void } => ({
    root: project,
    openFile: (abs, line) => openFileIn(project, abs, line),
    close
  })
  // What a plugin panel's tab shows: the plugin's content, or why there's none.
  const panelContent = (id: string, tie: string | null): ReactNode => {
    const x = allPanels.find((y) => y.id === id)
    const project = tie ?? active
    if (!x) return note("This panel's plugin isn't loaded.")
    if (!project) return null
    const { plugin: p, panel } = x
    const state = stateAt(p, panel.when, true, project)
    if (state === 'gone') return note(`${p.name} has nothing for ${project === active ? 'this project' : projectName(project)}.`)
    if (state === 'loading') return note(`Loading ${projectName(project)}…`)
    return (
      <PageProject.Provider value={project}>
        <Quiet plugin={p} what={`panel ${panel.id}`} reset={`${p.key}\n${active}\n${project}`} fallback={note(`${panel.title} hit an error (see Plugins).`)}>
          {panel.render({ data: dataFor(p.id, project), ...pageProps(project, () => closePanel(id)) })}
        </Quiet>
      </PageProject.Provider>
    )
  }
  // A tied panel's tab says its project when another tab is in front.
  useEffect(() => {
    for (const o of openList) {
      const x = allPanels.find((y) => y.id === o.id)
      if (x) setPanelTitle(o.id, o.project && o.project !== active ? `${x.panel.title} · ${projectName(o.project)}` : x.panel.title)
    }
  }, [panels, active, plugins])

  // Pages showing away from home: their homes open in the background, their data loads, and they
  // stay live (changes there reload them, playground pages there update).
  const awayPages = [
    ...(pluginView && viewProject && viewProject !== active ? [{ plugin: pluginView.plugin, project: viewProject }] : []),
    ...openList.flatMap((o) => {
      const p = plugins.find((x) => x.id === pluginOfPanel(o.id))
      return p && o.project && o.project !== active ? [{ plugin: p, project: o.project }] : []
    })
  ]
  const awayKey = awayPages.map((a) => `${a.plugin.id}\t${a.project}`).join('\n')
  const awayRef = useRef(new Set<string>())
  awayRef.current = new Set(awayPages.map((a) => a.project))
  useEffect(() => {
    if (!active) return
    for (const { plugin, project } of awayPages) {
      visit(project)
      if (plugin.source) loadData(plugin.id, project)
    }
    for (const project of awayRef.current) checkPlay(project)
  }, [awayKey, active])

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
  // View › Reload Plugins. What failed to load is on the Plugins page.
  const reloadAll = (): void =>
    void reloadPlugins(null).then(
      async (n) => {
        const failed = (await window.api.plugins().catch(() => [])).filter((s) => s.enabled && s.error)
        const text = `Reloaded ${n} ${n === 1 ? 'plugin' : 'plugins'}.`
        toast(!failed.length, 'Plugins', failed.length ? `${text} ${failed.map((s) => s.name ?? s.path).join(', ')} failed to load (see Plugins).` : text)
      },
      (err: unknown) => toast(false, 'Plugins', `Reload failed: ${message(err)}`)
    )

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
    // So do pages away from home showing it, or they'd open it again in the background.
    const awayTabs = Object.keys(viewFor).filter((where) => viewFor[where] === path)
    setView(({ [path]: _, ...v }) => ({ ...v, ...Object.fromEntries(awayTabs.map((where) => [where, undefined])) }))
    setViewFor(({ [path]: _, ...f }) => Object.fromEntries(Object.entries(f).filter(([, p]) => p !== path)))
    for (const o of openList) if (o.project === path) closePanel(o.id)
    setPanels((x) => x.split('\n').filter((line) => line && line.split('\t')[1] !== path).join('\n'))
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
    else if (cmd.type === 'reloadPlugins') reloadAll()
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
              <Quiet key={`${p.key}:${i}`} plugin={p} what="agent bar">
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
    clearView(active)
    openAt(abs.slice(root.length + 1), line, 1, 0)
  }
  useEffect(() => setOpenFile(openFile))
  useEffect(() =>
    setActiveFile(() => {
      const root = status?.root
      if (!active || !root || !workPath) return null
      const path = `${root}/${workPath}`
      const sel = selectionIn(path)
      return { path, project: active, selection: sel?.range ?? null, text: sel?.text ?? '' }
    })
  )
  useEffect(() => projectSwitched(active), [active])

  // A page's openFile, in its project's repo: a page away from home switches to its home's tab.
  const openFileIn = (project: string | null, abs: string, line: number): void => {
    if (!project || project === active) return openFile(abs, line)
    const where = here
    void (async () => {
      const root = (statuses.current.get(project) ?? (await window.api.status(project).catch(() => null)))?.root
      if (!root || !abs.startsWith(`${root}/`)) return
      const path = abs.slice(root.length + 1)
      clearView(where)
      clearView(project)
      bring(project)
      setSelected((s) => ({ ...s, [project]: { path, code: 'M' } }))
      revealSection('editor')
      setReveal((r) => ({ path, line, col: 1, len: 0, n: (r?.n ?? 0) + 1 }))
    })()
  }

  // Shows an agent (starting it if it wasn't running) and resolves once its prompt is up.
  // With stay, only starts it: the screen and the agent in front stay as they are.
  const wake = (path: string, agentId: string, stay = false): Promise<boolean> => {
    const id = `${agentId}:${path}`
    if (!stay) {
      revealSection('agents')
      setTerms((t) => ({ ...t, [path]: agentId }))
    }
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
  // separately, after the paste, or the agent takes it as part of the pasted text. With stay (a
  // page inside a plugin's view), the screen stays as it is.
  const playDone = (slot: number, stay = false, project = active): Promise<boolean> => {
    const name = config.playgrounds[slot - 1]?.name || `playground ${slot}`
    return tellAgent(`I'm done in the ${name}: read .cuckcode/playground/${slot}/data/answers.json and act on it.`, true, 'Playground', stay, project)
  }

  // Back to the workspace, and type text into a project's agent that takes playground answers, as
  // if typed there; with submit, Enter follows. Playground Done and plugins (sendToAgent) use it.
  // With stay (plugins only), the screen and focus stay put: the agent just gets the text. A
  // project other than the tab in front's comes to the front (without stay), and one that isn't
  // open opens, in the background: a remembered home, or a folder in the projects folder.
  const tellAgent = async (text: string, submit: boolean, from: string, stay = false, project = active): Promise<boolean> => {
    if (!project) return false
    if (!projectsRef.current.includes(project)) {
      // A remembered home may have gone since.
      const known = Object.values(pluginHomesRef.current).some((h) => h.includes(project))
        ? await isFolder(project)
        : !!config.projectsDir && (await window.api.repos(config.projectsDir).catch((): string[] => [])).includes(project)
      if (!known) {
        toast(false, from, `${tildify(project)} isn't an open project or a folder in your projects folder.`)
        return false
      }
      if (activeRef.current) shelveOpen(project)
      else open([project])
    }
    const to = target(agents, agentOf(project), (a) => a.playground)
    if (!to) {
      toast(false, from, 'No agent takes playground answers. Turn Playground on for one in Settings › Agents.')
      return false
    }
    const id = `${to.id}:${project}`
    if (!stay) {
      if (activeRef.current) clearView(activeRef.current)
      clearView(project)
      if (project !== activeRef.current) bring(project)
    }
    if (!(await wake(project, to.id, stay)) || !pasteInto(id, text, !stay)) return false
    if (submit) setTimeout(() => window.api.ptyWrite(id, '\r'), 150)
    return true
  }
  // A plugin's sendToAgent: the project it names, else its pages' on screen (pages.ts).
  const sendFromPlugin = async (send: Send): Promise<boolean> => {
    const r = agentProject(
      send.plugin,
      send.project,
      pluginView ? { plugin: pluginView.plugin.id, project: viewProject } : null,
      active ? openList.filter((o) => panelShowing(o.id)).map((o) => ({ plugin: pluginOfPanel(o.id), project: o.project })) : [],
      active
    )
    if ('among' in r) {
      toast(false, send.from, `Its panels are showing for ${r.among.map(projectName).join(' and ')} and it didn't say which agent this was for, so nothing was sent.`)
      return false
    }
    return tellAgent(send.text, send.submit, send.from, send.stay, r.to)
  }
  useEffect(() => setSendToAgent(sendFromPlugin))
  useEffect(() => setPlayHandlers({ done: (slot, project) => playDone(slot, true, project), seen: unseen }))
  useEffect(() => setSaveAll(saveAll), [])

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
          .map((v) => ({
            id: v.key,
            title: v.view.title,
            icon: v.view.icon,
            shortcut: v.plugin.shortcut(v.view.command),
            tag: pluginView?.key === v.key && viewProject && viewProject !== active ? projectName(viewProject) : undefined
          }))}
        pluginView={pluginView?.key ?? null}
        onPluginView={(key) => void togglePluginView(key)}
        pluginPanels={paneled
          .filter((x) => x.panel.button !== false)
          .map((x) => {
            const tie = openList.find((o) => o.id === x.id)?.project
            return {
              id: x.id,
              title: x.panel.title,
              icon: x.panel.icon,
              shortcut: x.plugin.shortcut(x.panel.command),
              open: openPanelIds.includes(x.id),
              tag: tie && tie !== active ? projectName(tie) : undefined
            }
          })}
        onPluginPanel={(id) => void togglePluginPanel(id)}
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
            {openList.map((o) => createPortal(panelContent(o.id, o.project), panelHost(o.id), o.id))}
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
                  onDone={() => void playDone(playing)}
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
        {/* Over the project's workspace, or the home screen for a view offered there, for the
            project it's for. One that throws shows a note instead of taking the window down;
            another project gives it another try. */}
        {pluginView && (
          <div className="absolute inset-0 z-30">
            <PageProject.Provider value={viewProject}>
              <Quiet
                key={`${pluginView.key}\n${pluginView.plugin.key}\n${viewProject ?? ''}`}
                plugin={pluginView.plugin}
                what={`view ${pluginView.view.command}`}
                reset={active}
                fallback={note(`${pluginView.view.title} hit an error (see Plugins).`)}
              >
                {viewState === 'loading'
                  ? note(`Loading ${projectName(viewProject ?? '')}…`)
                  : pluginView.view.render({
                      data: dataFor(pluginView.plugin.id, viewProject),
                      ...pageProps(viewProject, () => hidePluginView(pluginView.key))
                    })}
              </Quiet>
            </PageProject.Provider>
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

// Whether path is a folder there now.
const isFolder = (path: string): Promise<boolean> => window.api.browse(path).then(() => true, () => false)

// Until init answers; never saved (saving waits for init).
const EMPTY: Config = {
  projectsDir: '',
  notifications: false,
  commitCommand: '',
  agentRunCommand: '',
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
  agentRunCommand: s.agentRunCommand,
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
// What it caught goes to the plugin's errors (a toast, and the Plugins page).
class Quiet extends Component<
  { children: ReactNode; plugin: { id: string; name: string }; what: string; reset?: unknown; fallback?: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  componentDidCatch(err: unknown): void {
    pluginError(this.props.plugin, this.props.what, err)
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
