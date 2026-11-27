import type { When } from '../../shared/plugin'

// A plugin's pages (its views and panels) and the project each one is for. A page opens for the
// tab's own project when it has the plugin's data there; from any other tab it opens for one of
// the plugin's homes, the projects where its ProjectSource.load last returned data. Kept free of
// the DOM and dockview, so the rules can be tested on their own.

export interface Page {
  source: boolean // the plugin keeps per-project data (projectData)
  when?: When<unknown>
  panel?: boolean // panels live in the workspace, so never on the home screen
}

// Per `${plugin}:${path}`: the plugin's data there. Absent: not loaded yet; null: nothing there.
export type Data = Record<string, unknown>

const key = (plugin: string, path: string): string => `${plugin}:${path}`

// Whether a page is offered for root (null: the home screen), from the plugin's data there: by its
// when, else while root has the plugin's data (or the plugin keeps none). A when that throws
// offers nothing.
export function offeredAt(page: Page, data: unknown, root: string | null, report?: (err: unknown) => void): boolean {
  if (page.panel && !root) return false
  if (!page.when) return !!root && (!page.source || (data !== null && data !== undefined))
  try {
    return !!page.when(data ?? null, root)
  } catch (err) {
    report?.(err)
    return false
  }
}

// How a page in path stands: its data still loading, there to show, or gone (nothing for it there).
export function pageState(page: Page, plugin: string, path: string, data: Data, report?: (err: unknown) => void): 'loading' | 'ready' | 'gone' {
  const d = data[key(plugin, path)]
  if (d === undefined) return page.source ? 'loading' : offeredAt(page, null, path, report) ? 'ready' : 'gone'
  return d !== null && offeredAt(page, d, path, report) ? 'ready' : 'gone'
}

// The plugin's homes for this page, most recently used first: the remembered ones, less any whose
// loaded data says otherwise. A plugin that keeps no data has none.
export function homes(page: Page, plugin: string, remembered: string[], data: Data, report?: (err: unknown) => void): string[] {
  if (!page.source) return []
  return remembered.filter((path) => pageState(page, plugin, path, data, report) !== 'gone')
}

// What a page's button does from the tab in front (active; null on the home screen): opens it for
// a project (null: the home screen itself), asks which of several homes, or nothing (null).
export type Offer = { for: string | null } | { ask: string[] }

export function offer(page: Page, plugin: string, active: string | null, remembered: string[], data: Data, report?: (err: unknown) => void): Offer | null {
  // The tab's own project, also while its data is still loading when it's a remembered home.
  const here = active === null ? undefined : data[key(plugin, active)]
  if (offeredAt(page, here, active, report) || (active && here === undefined && page.source && remembered.includes(active))) return { for: active }
  const away = homes(page, plugin, remembered, data, report).filter((p) => p !== active)
  if (!away.length) return null
  return away.length === 1 ? { for: away[0] } : { ask: away }
}

// Where a plugin last had data, most recently used first, after a load in path found some (has) or
// none. A plugin without an entry gets one only when something is found: no entry means the
// projects folder hasn't been looked through for it yet.
export function remember(all: Record<string, string[]>, plugin: string, path: string, has: boolean): Record<string, string[]> {
  const list = all[plugin]
  if (has) return list?.includes(path) ? all : { ...all, [plugin]: [...(list ?? []), path] }
  return list?.includes(path) ? { ...all, [plugin]: list.filter((p) => p !== path) } : all
}

// A home just opened goes first, so show() and the chooser start from it.
export function used(all: Record<string, string[]>, plugin: string, path: string): Record<string, string[]> {
  const list = all[plugin] ?? []
  return list[0] === path ? all : { ...all, [plugin]: [path, ...list.filter((p) => p !== path)] }
}

// A page on screen: which plugin's, and the project it's for.
export interface Shown {
  plugin: string
  project: string | null
}

// The project whose agent a plugin's sendToAgent types into: the one it names; else the project of
// its pages on screen: the view over the workspace (any plugin's: it covers the dock), else its
// panels showing in the dock (an untied one is the tab in front's); else the tab in front. Panels
// showing for different projects leave it unclear, so it's refused (among) rather than guessed:
// typing into the wrong agent is the one thing this must never do. view is null when none is
// showing; panels holds only those in front in their groups, and none on the home screen.
export function agentProject(
  plugin: string,
  given: string | undefined,
  view: Shown | null,
  panels: Shown[],
  active: string | null
): { to: string | null } | { among: string[] } {
  if (given) return { to: given }
  if (view) return { to: view.plugin === plugin ? view.project : active }
  const here = [...new Set(panels.filter((p) => p.plugin === plugin).map((p) => p.project ?? active))]
  return here.length > 1 ? { among: here.filter((p): p is string => !!p) } : { to: here[0] ?? active }
}

// --- Panels in the dock ---

// A plugin panel's dock id: `plugin:<plugin id>:<panel id>`. Neither id has a colon.
const PANEL = 'plugin:'
export const isPanel = (id: string): boolean => id.startsWith(PANEL)
export const panelId = (plugin: string, panel: string): string => `${PANEL}${plugin}:${panel}`
export const pluginOfPanel = (id: string): string => id.slice(PANEL.length, id.indexOf(':', PANEL.length))

// The plugin panels in a saved layout (dockview's JSON), each with the project it's tied to: one
// opened away from its home keeps that home in its params, so it shows the same project after a
// relaunch or a saved layout's load. null: it follows the tab in front.
export function panelsIn(layout: unknown): { id: string; project: string | null }[] {
  const panels = (layout as { panels?: Record<string, { params?: { project?: unknown } }> } | null)?.panels
  if (!panels || typeof panels !== 'object') return []
  return Object.keys(panels)
    .filter(isPanel)
    .map((id) => {
      const project = panels[id]?.params?.project
      return { id, project: typeof project === 'string' && project.startsWith('/') ? project : null }
    })
}
