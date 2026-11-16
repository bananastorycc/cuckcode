import { createDockview, type DockviewApi, type DockviewTheme, type ITabRenderer, type SerializedDockview } from 'dockview'
import 'dockview/dist/styles/dockview.css'

// The workspace is a dockview: every section is a tab that can be dragged into any group, split
// off, or resized. Each section's content lives in one host element made here, once, and App
// renders into it through a portal; a dock panel only borrows the element. So moving a tab or
// loading a whole layout re-parents DOM and never remounts the editor or a terminal.

export const SECTIONS = ['files', 'search', 'editor', 'terminal', 'agents', 'git', 'scratch'] as const
export type Section = (typeof SECTIONS)[number]

export const TITLES: Record<Section, string> = {
  files: 'Files',
  search: 'Search',
  editor: 'Editor',
  terminal: 'Terminal',
  agents: 'Agents',
  git: 'Git',
  scratch: 'Scratch'
}

export const hosts = {} as Record<Section, HTMLElement>
for (const s of SECTIONS) {
  const el = document.createElement('div')
  el.className = 'relative h-full w-full overflow-hidden'
  // ⌃⌘+arrows move focus between these.
  el.dataset.pane = s
  hosts[s] = el
}

const THEME: DockviewTheme = { name: 'cuckcode', className: 'dockview-theme-light cc-dock', gap: 0 }

let api: DockviewApi | null = null

// A layout that names every section once and nothing else; anything else (a hand-edited or
// stale file) is rejected rather than half-loaded.
export function valid(layout: unknown): layout is SerializedDockview {
  const panels = (layout as SerializedDockview | null)?.panels
  if (!panels || typeof panels !== 'object' || !(layout as SerializedDockview).grid?.root) return false
  const ids = Object.keys(panels)
  return ids.length === SECTIONS.length && SECTIONS.every((s) => ids.includes(s))
}

export function mount(el: HTMLElement, saved: unknown, onChange: (layout: SerializedDockview) => void): () => void {
  const dock = createDockview(el, {
    theme: THEME,
    disableFloatingGroups: true,
    // Hidden tabs stay in the page, so a terminal in a background tab keeps its size.
    defaultRenderer: 'always',
    createComponent: ({ name }) => {
      const element = document.createElement('div')
      element.className = 'h-full w-full'
      return { element, init: () => element.append(hosts[name as Section]) }
    },
    // Every tab is ours: dockview only asks for one when a tab component is named.
    defaultTabComponent: 'section',
    createTabComponent: ({ id }) => tab(id as Section)
  })
  api = dock
  load(saved)
  const changed = (): void => {
    // The last section showing can't be minimized; its button goes.
    el.classList.toggle('cc-last', SECTIONS.length - hidden().length <= 1)
    onChange(dock.toJSON())
  }
  const sub = dock.onDidLayoutChange(changed)
  changed()
  return () => {
    sub.dispose()
    dock.dispose()
    if (api === dock) api = null
  }
}

// A saved layout, or a preset by name; anything unusable falls back to the default.
export function load(layout: unknown): void {
  if (!api) return
  if (valid(layout)) {
    try {
      api.fromJSON(layout)
      return
    } catch {
      // Fall through to the default.
    }
  }
  apply(PRESETS[0])
}

export function apply(preset: Preset): void {
  if (!api) return
  api.clear()
  preset.build(api)
}

export const current = (): SerializedDockview | null => api?.toJSON() ?? null

// --- Minimizing ---

// A minimized section keeps its own group in the grid, hidden, so showing it again puts it back
// where it was at the size it had. One that shared a group is split off first and remembers a
// section it was tabbed with (its home), to rejoin that group if it's still showing. Both live in
// the layout, so they're saved with it.

const panelOf = (s: Section): ReturnType<DockviewApi['getPanel']> => api?.getPanel(s) ?? undefined

// Read from the grid itself: after loading a layout, a group's own isVisible says true for a
// group the grid has hidden.
type Node = { type: 'leaf' | 'branch'; data: unknown; visible?: boolean }
function hiddenGroups(): Set<string> {
  const ids = new Set<string>()
  const walk = (n: Node): void => {
    if (n.type === 'branch') (n.data as Node[]).forEach(walk)
    else if (n.visible === false) ids.add((n.data as { id: string }).id)
  }
  if (api) walk(api.toJSON().grid.root as Node)
  return ids
}

const isHidden = (s: Section, groups = hiddenGroups()): boolean => groups.has(panelOf(s)?.group.id ?? '')

export const hidden = (): Section[] => {
  const groups = hiddenGroups()
  return SECTIONS.filter((s) => isHidden(s, groups))
}

export function hide(s: Section): void {
  const panel = panelOf(s)
  if (!api || !panel || isHidden(s) || SECTIONS.length - hidden().length <= 1) return
  const group = panel.group
  if (group.panels.length > 1) {
    const home = group.panels.find((p) => p.id !== s)!.id
    panel.api.updateParameters({ home, index: group.panels.indexOf(panel) })
    panel.api.moveTo({ group, position: 'bottom', skipSetActive: true })
  }
  panel.group.api.setVisible(false)
}

export function show(s: Section): void {
  const panel = panelOf(s)
  if (!api || !panel) return
  const own = panel.group
  if (!isHidden(s)) return
  const { home, index } = (panel.params ?? {}) as { home?: Section; index?: number }
  const to = home && panelOf(home)?.group
  panel.api.updateParameters({})
  if (to && to !== own && !isHidden(home)) panel.api.moveTo({ group: to, position: 'center', index })
  else own.api.setVisible(true)
}

// Brought to the front for something that needs it on screen (a picked file, ⇧⌘F).
export function reveal(s: Section): void {
  show(s)
  const panel = panelOf(s)
  if (panel && !panel.api.isActive) panel.api.setActive()
}

// The tab: the title, and a button to minimize the section (it replaces dockview's close).
function tab(s: Section): ITabRenderer {
  const element = document.createElement('div')
  element.className = 'dv-default-tab cc-tab'
  const title = document.createElement('div')
  title.className = 'dv-default-tab-content'
  title.textContent = TITLES[s]
  const button = document.createElement('button')
  button.className = 'cc-minimize'
  button.title = `Minimize ${TITLES[s]}`
  button.tabIndex = -1
  button.innerHTML =
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg>'
  // Not the start of a tab drag, and not a click on the tab.
  button.addEventListener('pointerdown', (e) => e.stopPropagation())
  button.addEventListener('mousedown', (e) => e.stopPropagation())
  button.addEventListener('click', (e) => {
    e.stopPropagation()
    hide(s)
  })
  element.append(title, button)
  return { element, init: () => {} }
}

// --- Presets ---

export interface Preset {
  name: string
  description: string
  build: (api: DockviewApi) => void
}

type Where = { referencePanel: Section; direction: 'left' | 'right' | 'above' | 'below' | 'within' }

function add(api: DockviewApi, id: Section, position?: Where): void {
  api.addPanel({ id, component: id, title: TITLES[id], position })
}

// Fractions of the dock's size, applied once the panels are in.
function size(api: DockviewApi, id: Section, s: { width?: number; height?: number }): void {
  const g = api.getPanel(id)?.group
  if (!g) return
  g.api.setSize({
    width: s.width === undefined ? undefined : Math.round(s.width * api.width),
    height: s.height === undefined ? undefined : Math.round(s.height * api.height)
  })
}

const front = (api: DockviewApi, id: Section): void => api.getPanel(id)?.api.setActive()

export const PRESETS: Preset[] = [
  {
    name: 'Default',
    description: 'Files over git, search and scratch in tabs; the editor over a terminal; your agent with the whole right side.',
    build: (api) => {
      add(api, 'files')
      add(api, 'editor', { referencePanel: 'files', direction: 'right' })
      add(api, 'agents', { referencePanel: 'editor', direction: 'right' })
      add(api, 'git', { referencePanel: 'files', direction: 'below' })
      add(api, 'search', { referencePanel: 'git', direction: 'within' })
      add(api, 'scratch', { referencePanel: 'git', direction: 'within' })
      add(api, 'terminal', { referencePanel: 'editor', direction: 'below' })
      size(api, 'files', { width: 0.2, height: 0.5 })
      size(api, 'agents', { width: 0.38 })
      size(api, 'editor', { height: 0.68 })
      front(api, 'git')
      front(api, 'editor')
    }
  },
  {
    name: 'Classic',
    description: "cuckcode's original four columns: files over search; the editor over a terminal; your agent over git and scratch side by side.",
    build: (api) => {
      add(api, 'files')
      add(api, 'editor', { referencePanel: 'files', direction: 'right' })
      add(api, 'agents', { referencePanel: 'editor', direction: 'right' })
      add(api, 'search', { referencePanel: 'files', direction: 'below' })
      add(api, 'terminal', { referencePanel: 'editor', direction: 'below' })
      add(api, 'git', { referencePanel: 'agents', direction: 'below' })
      add(api, 'scratch', { referencePanel: 'git', direction: 'right' })
      size(api, 'files', { width: 0.217, height: 0.5 })
      size(api, 'agents', { width: 0.39, height: 0.6 })
      size(api, 'editor', { height: 0.6 })
      size(api, 'git', { width: 0.195 })
      front(api, 'editor')
    }
  },
  {
    name: 'Editor',
    description: 'The editor takes the middle; everything else is tabbed into a narrow side column, agent and terminal below.',
    build: (api) => {
      add(api, 'files')
      add(api, 'search', { referencePanel: 'files', direction: 'within' })
      add(api, 'git', { referencePanel: 'files', direction: 'within' })
      add(api, 'scratch', { referencePanel: 'files', direction: 'within' })
      add(api, 'editor', { referencePanel: 'files', direction: 'right' })
      add(api, 'agents', { referencePanel: 'editor', direction: 'below' })
      add(api, 'terminal', { referencePanel: 'agents', direction: 'within' })
      size(api, 'files', { width: 0.2 })
      size(api, 'editor', { height: 0.65 })
      front(api, 'files')
      front(api, 'agents')
      front(api, 'editor')
    }
  },
  {
    name: 'Agent',
    description: 'Your agent in the middle, wide; files and the tools on the left; the editor and terminal on the right to watch its changes.',
    build: (api) => {
      add(api, 'files')
      add(api, 'agents', { referencePanel: 'files', direction: 'right' })
      add(api, 'editor', { referencePanel: 'agents', direction: 'right' })
      add(api, 'search', { referencePanel: 'files', direction: 'below' })
      add(api, 'git', { referencePanel: 'search', direction: 'within' })
      add(api, 'scratch', { referencePanel: 'search', direction: 'within' })
      add(api, 'terminal', { referencePanel: 'editor', direction: 'below' })
      size(api, 'files', { width: 0.18, height: 0.5 })
      size(api, 'editor', { width: 0.32, height: 0.65 })
      front(api, 'git')
      front(api, 'agents')
    }
  },
  {
    name: 'Stacked',
    description: 'Two columns for narrower windows: the editor over your agent, every other section tabbed on the left.',
    build: (api) => {
      add(api, 'files')
      add(api, 'editor', { referencePanel: 'files', direction: 'right' })
      add(api, 'agents', { referencePanel: 'editor', direction: 'below' })
      add(api, 'search', { referencePanel: 'files', direction: 'within' })
      add(api, 'git', { referencePanel: 'files', direction: 'below' })
      add(api, 'scratch', { referencePanel: 'git', direction: 'within' })
      add(api, 'terminal', { referencePanel: 'git', direction: 'within' })
      size(api, 'files', { width: 0.3, height: 0.5 })
      size(api, 'editor', { height: 0.5 })
      front(api, 'files')
      front(api, 'git')
      front(api, 'editor')
    }
  }
]
