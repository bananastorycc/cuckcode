import { describe, expect, it } from 'vitest'
import type { Settings } from '../shared/types'
import { fromFile, overStale, scratchOf, toFile, travelling } from './configfile'

const base: Settings = {
  projects: ['/Users/a/p'],
  active: '/Users/a/p',
  theme: 'dark',
  files: {},
  agent: {},
  recent: [],
  projectsDir: '/Users/a/code',
  meters: true,
  notifications: false,
  readme: true,
  folders: { enabled: true, dirs: ['/Users/a/Pictures', '/Volumes/x'] },
  playgrounds: [{ name: 'playground' }],
  webPages: [],
  agents: [{ id: 'claude', name: 'claude', type: 'claude' }],
  plugins: [{ path: '/Users/a/plugins/p', enabled: true }],
  configRepo: 'git@example.com:a/c.git',
  layout: null,
  layouts: []
}

describe('config file', () => {
  it('leaves out what belongs to this machine and writes home paths as ~', () => {
    const out = JSON.parse(toFile(base, 'notes', '/Users/a'))
    expect(out).not.toHaveProperty('projects')
    expect(out).not.toHaveProperty('plugins')
    expect(out).not.toHaveProperty('configRepo')
    expect(out.projectsDir).toBe('~/code')
    expect(out.folders.dirs).toEqual(['~/Pictures', '/Volumes/x'])
  })

  it('reads back into another home, keeping local keys', () => {
    const local = { ...base, theme: 'light' as const, plugins: [], configRepo: '' }
    const next = fromFile(JSON.parse(toFile(base, 'notes', '/Users/a')), local, '/Users/b')
    expect(next.projectsDir).toBe('/Users/b/code')
    expect(next.folders).toEqual({ enabled: true, dirs: ['/Users/b/Pictures', '/Volumes/x'] })
    expect(next.theme).toBe('dark')
    expect(next.plugins).toEqual([])
    expect(next.configRepo).toBe('')
    expect(next.projects).toEqual(base.projects)
  })

  it('carries the scratchpad, and leaves it alone when a file has none', () => {
    expect(scratchOf(JSON.parse(toFile(base, 'notes', '/Users/a')))).toBe('notes')
    expect(scratchOf({ theme: 'dark' })).toBeNull()
  })

  it('rejects anything else', () => {
    for (const raw of [null, [], 'x', { foo: 1 }]) expect(() => fromFile(raw, base)).toThrow()
  })

  it("keeps a sync's values over a window save that hasn't seen it, but takes the window's own changes", () => {
    const old = travelling(base)
    const synced: Settings = { ...base, theme: 'light', meters: false }
    // Sent before the window had the sync, with a change of its own.
    const stale = overStale({ ...base, readme: false, active: '/Users/a/q' }, synced, [old])
    expect(stale).toMatchObject({ theme: 'light', meters: false, readme: false, active: '/Users/a/q' })
    // Once it shows the sync, nothing in its saves is old.
    expect(overStale({ ...synced, notifications: true }, synced, [old])).toBeNull()
  })
})
