import { describe, expect, it } from 'vitest'
import { agentProject, homes, offer, offeredAt, pageState, panelId, panelsIn, pluginOfPanel, remember, used, type Data, type Page } from './pages'

const view: Page = { source: true }
const panel: Page = { source: true, panel: true }
const A = '/p/a'
const B = '/p/b'
const C = '/p/c'
const H = '/p/hub'

describe('offering a page', () => {
  it('opens in the tab that has the data, as before', () => {
    const data: Data = { 'x:/p/a': { n: 1 } }
    expect(offer(view, 'x', A, [A], data)).toEqual({ for: A })
  })

  it('opens for its only home from a tab without data', () => {
    const data: Data = { 'x:/p/a': { n: 1 }, 'x:/p/hub': null }
    expect(offer(view, 'x', H, [A], data)).toEqual({ for: A })
    // A home not loaded yet still counts: it loads once the page opens.
    expect(offer(view, 'x', H, [A], {})).toEqual({ for: A })
  })

  it('asks among several homes, the one opened last first', () => {
    const all = used({ x: [A, B] }, 'x', B)
    expect(all.x).toEqual([B, A])
    expect(offer(view, 'x', H, all.x, {})).toEqual({ ask: [B, A] })
  })

  it('drops a remembered home whose data is gone', () => {
    const data: Data = { 'x:/p/a': null, 'x:/p/b': { n: 2 } }
    expect(homes(view, 'x', [A, B], data)).toEqual([B])
    expect(offer(view, 'x', H, [A, B], data)).toEqual({ for: B })
    expect(offer(view, 'x', H, [A], { 'x:/p/a': null })).toBeNull()
  })

  it('offers nothing away from home for a plugin without data, and everywhere in a project', () => {
    const plain: Page = { source: false }
    expect(offer(plain, 'x', H, [A], {})).toEqual({ for: H })
    expect(offer(plain, 'x', null, [A], {})).toBeNull()
  })

  it('opens a home from the home screen; a panel never for the home screen itself', () => {
    expect(offer(panel, 'x', null, [A], {})).toEqual({ for: A })
    expect(offeredAt(panel, null, null)).toBe(false)
    const always: Page = { source: false, when: () => true }
    expect(offer(always, 'x', null, [], {})).toEqual({ for: null })
  })

  it("follows when for a home's data, and a when that throws offers nothing", () => {
    const big: Page = { source: true, when: (d) => ((d as { n: number } | null)?.n ?? 0) > 1 }
    const data: Data = { 'x:/p/a': { n: 1 }, 'x:/p/b': { n: 2 } }
    expect(offer(big, 'x', H, [A, B], data)).toEqual({ for: B })
    const errors: unknown[] = []
    const bad: Page = {
      source: true,
      when: () => {
        throw new Error('boom')
      }
    }
    expect(offer(bad, 'x', H, [A], { 'x:/p/a': {} }, (e) => errors.push(e))).toBeNull()
    expect(errors.length).toBeGreaterThan(0)
  })

  it('keeps the tab its own page while its data is still loading', () => {
    expect(offer(view, 'x', A, [B, A], {})).toEqual({ for: A })
    expect(pageState(view, 'x', A, {})).toBe('loading')
    expect(pageState(view, 'x', A, { 'x:/p/a': {} })).toBe('ready')
    expect(pageState(view, 'x', A, { 'x:/p/a': null })).toBe('gone')
  })
})

describe('remembering homes', () => {
  it('adds where data was found and drops where it went', () => {
    let all = remember({}, 'x', A, true)
    expect(all).toEqual({ x: [A] })
    all = remember(all, 'x', B, true)
    expect(all.x).toEqual([A, B])
    all = remember(all, 'x', A, false)
    expect(all.x).toEqual([B])
  })

  it('adds no entry for nothing found, so the projects folder still gets looked through', () => {
    const none = {}
    expect(remember(none, 'x', A, false)).toBe(none)
  })
})

describe("routing a plugin's sendToAgent", () => {
  it('goes to the tab in front when no project is given and nothing of the plugin shows away from home', () => {
    expect(agentProject('x', undefined, null, [], A)).toEqual({ to: A })
    expect(agentProject('x', undefined, { plugin: 'x', project: A }, [], A)).toEqual({ to: A })
    // Another plugin's page away from home doesn't matter.
    expect(agentProject('x', undefined, null, [{ plugin: 'y', project: B }], A)).toEqual({ to: A })
    // Another plugin's view covers the dock, so the plugin's tied panel isn't on screen.
    expect(agentProject('x', undefined, { plugin: 'y', project: B }, [{ plugin: 'x', project: C }], A)).toEqual({ to: A })
  })

  it('goes to the project given, wherever the page is', () => {
    expect(agentProject('x', C, { plugin: 'x', project: B }, [], A)).toEqual({ to: C })
    expect(agentProject('x', C, null, [{ plugin: 'x', project: B }, { plugin: 'x', project: null }], A)).toEqual({ to: C })
    expect(agentProject('x', C, null, [], null)).toEqual({ to: C })
  })

  it("goes to a page's home when it shows away from home, never the tab's agent", () => {
    expect(agentProject('x', undefined, { plugin: 'x', project: B }, [], H)).toEqual({ to: B })
    expect(agentProject('x', undefined, null, [{ plugin: 'x', project: B }], H)).toEqual({ to: B })
    // An untied panel follows the tab, so it's the tab's own project.
    expect(agentProject('x', undefined, null, [{ plugin: 'x', project: null }], H)).toEqual({ to: H })
    // The view covers the dock, so it wins over a panel.
    expect(agentProject('x', undefined, { plugin: 'x', project: C }, [{ plugin: 'x', project: B }], H)).toEqual({ to: C })
  })

  it("refuses to guess when the plugin's panels show for different projects", () => {
    // One follows the tab (H), one is tied to B: either could have sent it.
    expect(agentProject('x', undefined, null, [{ plugin: 'x', project: B }, { plugin: 'x', project: null }], H)).toEqual({ among: [B, H] })
    expect(agentProject('x', undefined, null, [{ plugin: 'x', project: B }, { plugin: 'x', project: C }], H)).toEqual({ among: [B, C] })
    // Two panels for the same project agree.
    expect(agentProject('x', undefined, null, [{ plugin: 'x', project: H }, { plugin: 'x', project: null }], H)).toEqual({ to: H })
  })

  it('sends nothing from the home screen without a project', () => {
    expect(agentProject('x', undefined, { plugin: 'x', project: null }, [], null)).toEqual({ to: null })
    expect(agentProject('x', undefined, null, [], null)).toEqual({ to: null })
  })
})

describe('panels in a saved layout', () => {
  // As dockview's toJSON writes it: the grid, and each panel with its params.
  const layout = {
    grid: { root: { type: 'branch', data: [] }, width: 800, height: 600, orientation: 'HORIZONTAL' },
    panels: {
      editor: { id: 'editor', contentComponent: 'editor', title: 'Editor' },
      'plugin:x:map': { id: 'plugin:x:map', contentComponent: 'plugin:x:map', title: 'Map · b', params: { project: B } },
      'plugin:y:log': { id: 'plugin:y:log', contentComponent: 'plugin:y:log', title: 'Log' },
      'plugin:z:odd': { id: 'plugin:z:odd', contentComponent: 'plugin:z:odd', title: 'Odd', params: { project: 'relative' } }
    },
    activeGroup: '1'
  }

  it('restores a panel opened away from home tied to its home, the others following the tab', () => {
    expect(panelsIn(layout)).toEqual([
      { id: 'plugin:x:map', project: B },
      { id: 'plugin:y:log', project: null },
      { id: 'plugin:z:odd', project: null }
    ])
    // The same after a round trip through the settings file.
    expect(panelsIn(JSON.parse(JSON.stringify(layout)))).toEqual(panelsIn(layout))
  })

  it('reads nothing from a layout that isn\'t one', () => {
    expect(panelsIn(null)).toEqual([])
    expect(panelsIn({ panels: 3 })).toEqual([])
  })

  it('names panels by plugin', () => {
    const id = panelId('my-plugin', 'side_bar')
    expect(id).toBe('plugin:my-plugin:side_bar')
    expect(pluginOfPanel(id)).toBe('my-plugin')
  })
})
