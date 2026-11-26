import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

// kit.js is plain browser JS; this is just enough of a DOM to draw a page and press Done.
class Node {}
class El extends Node {
  tagName: string
  children: El[] = []
  parentElement: El | null = null
  attrs: Record<string, string> = {}
  dataset: Record<string, string> = {}
  style = { setProperty: (): void => {} }
  listeners: Record<string, ((e: unknown) => void)[]> = {}
  className = ''
  classList = { add: (): void => {}, remove: (): void => {}, contains: (): boolean => false }
  innerHTML = ''
  textContent = ''
  hidden = false
  onclick: (() => void) | null = null
  constructor(tag: string) {
    super()
    this.tagName = tag.toUpperCase()
  }
  get isConnected(): boolean {
    return true
  }
  addEventListener(type: string, fn: (e: unknown) => void): void {
    ;(this.listeners[type] ||= []).push(fn)
  }
  setAttribute(k: string, v: string): void {
    this.attrs[k] = String(v)
  }
  getAttribute(k: string): string | null {
    return this.attrs[k] ?? null
  }
  append(...kids: (El | string)[]): void {
    for (const k of kids) if (k instanceof El) (this.children.push(k), (k.parentElement = this))
  }
  replaceChildren(...kids: El[]): void {
    this.children = []
    this.append(...kids)
  }
  replaceWith(): void {}
  remove(): void {}
  closest(): null {
    return null
  }
  querySelector(): null {
    return null
  }
  querySelectorAll(): El[] {
    return []
  }
  find(test: (el: El) => boolean): El | undefined {
    if (test(this)) return this
    for (const c of this.children) {
      const hit = c.find(test)
      if (hit) return hit
    }
    return undefined
  }
}

const source = readFileSync(join(__dirname, 'kit.js'), 'utf8')

type Answers = Record<string, unknown>

// Loads a page with `saved` as the answers file, presses Done, and returns what Done saved.
async function done(blocks: unknown[], saved: Answers | null = null): Promise<Answers> {
  const body = new El('body')
  const document = {
    body,
    head: new El('head'),
    documentElement: new El('html'),
    currentScript: null,
    title: '',
    createElement: (tag: string) => new El(tag),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {}
  }
  let written: Answers | null = null
  let handedOver = false
  const window = {
    document,
    location: { search: '', pathname: '/index.html' },
    URL,
    URLSearchParams,
    Node,
    console,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    addEventListener: () => {},
    sessionStorage: { getItem: () => null, setItem: () => {} },
    cuckcode: {
      load: async () => (saved ? JSON.parse(JSON.stringify(saved)) : null),
      save: async (_name: string, data: Answers) => void (written = JSON.parse(JSON.stringify(data))),
      done: () => void (handedOver = true)
    }
  } as Record<string, unknown>
  window.window = window
  vm.runInNewContext(source, window)
  const kit = window.kit as { page: (spec: unknown) => Promise<El> }
  const main = await kit.page({ title: 'Test', blocks })
  const button = main.find((el) => el.tagName === 'BUTTON' && el.className === 'k-btn primary')
  button!.onclick!()
  await new Promise((ok) => setTimeout(ok, 0))
  expect(handedOver).toBe(true)
  return written!
}

const form = {
  type: 'form',
  id: 'setup',
  fields: [
    { id: 'name', label: 'Name' },
    { id: 'platforms', kind: 'checkbox', options: ['macOS', 'Linux'], default: ['macOS'] },
    { id: 'offline', kind: 'toggle', default: true },
    { id: 'density', kind: 'range', min: 1, max: 5, default: 3 }
  ]
}

describe('kit Done', () => {
  it('saves an untouched form as its defaults', async () => {
    const answers = await done([form])
    expect(answers.setup).toEqual({ platforms: ['macOS'], offline: true, density: 3 })
    expect(typeof answers._done).toBe('string')
  })

  it('never replaces an answer already saved', async () => {
    const answers = await done([form], { setup: { name: 'Lighthouse', offline: false } })
    expect(answers.setup).toEqual({ name: 'Lighthouse', offline: false })
  })

  it('saves nothing for a form without defaults', async () => {
    const answers = await done([{ type: 'form', id: 'f', fields: [{ id: 'name' }] }])
    expect('f' in answers).toBe(false)
  })

  it('saves untouched plans, checklists, boards and tunes as shown', async () => {
    const answers = await done([
      { type: 'plan', id: 'plan', items: [{ id: 'db', title: 'Add a table', checked: false }, 'Write docs'] },
      { type: 'checklist', id: 'list', items: ['One'] },
      { type: 'buckets', id: 'triage', buckets: ['Now', 'Later'], items: [{ id: '12', title: 'Crash', bucket: 'Now' }, { id: '13', title: 'Typo' }] },
      { type: 'tune', id: 'card', knobs: [{ id: 'radius', value: 12 }, { id: 'shadow', kind: 'toggle' }, { id: 'font', kind: 'select', options: ['system-ui', 'Georgia'] }] }
    ])
    expect(answers.plan).toEqual([
      { id: 'db', title: 'Add a table', checked: false, note: '' },
      { id: '2', title: 'Write docs', checked: true, note: '' }
    ])
    expect(answers.list).toEqual([{ id: '1', title: 'One', checked: true, note: '' }])
    expect(answers.triage).toEqual({ Now: ['12'], Later: [] })
    expect(answers.card).toEqual({ radius: 12, shadow: false, font: 'system-ui' })
  })

  it('leaves blocks with nothing chosen up front unanswered', async () => {
    const answers = await done([
      { type: 'choice', id: 'pick', options: [{ id: 'a' }, { id: 'b' }] },
      { type: 'review', id: 'art', items: ['a.png'] },
      { type: 'table', id: 'deps', select: 'many', rows: [{ id: 'react', name: 'react' }] }
    ])
    expect(Object.keys(answers)).toEqual(['_done'])
  })
})
