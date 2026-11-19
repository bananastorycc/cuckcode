import { describe, expect, it } from 'vitest'
import type { Settings } from '../shared/types'
import { fromFile, overStale, scratchOf, toFile, travelling } from './configfile'

const base: Settings = {
  projects: ['/Users/a/p'],
  shelved: [],
  active: '/Users/a/p',
  theme: 'dark',
  files: {},
  agent: {},
  recent: [],
  projectsDir: '/Users/a/code',
  commitCommand: 'x',
  confirmAllRepos: true,
  notifications: false,
  readme: true,
  folders: { enabled: true, dirs: ['/Users/a/Pictures', '/Volumes/x'] },
  playgrounds: [{ name: 'playground' }],
  webPages: [],
  agents: [{ id: 'claude', name: 'claude', command: 'claude', notify: true, awake: true, mentions: true, newline: true, playground: true }],
  plugins: [
    { path: '/Users/a/plugins/p', enabled: true },
    { path: '/Users/a/plugins/q', url: 'git@example.com:a/q.git', enabled: false }
  ],
  configRepo: 'git@example.com:a/c.git',
  layout: null,
  layouts: []
}

describe('config file', () => {
  it('leaves out what belongs to this machine and writes home paths as ~', () => {
    const out = JSON.parse(toFile(base, 'notes', '/Users/a'))
    expect(out).not.toHaveProperty('projects')
    expect(out).not.toHaveProperty('configRepo')
    expect(out.projectsDir).toBe('~/code')
    expect(out.folders.dirs).toEqual(['~/Pictures', '/Volumes/x'])
  })

  it('reads back into another home, keeping local keys', () => {
    const local = { ...base, theme: 'light' as const, plugins: [], configRepo: '' }
    const next = fromFile(JSON.parse(toFile(base, 'notes', '/Users/a')), local, '/Users/b/plugins', '/Users/b')
    expect(next.projectsDir).toBe('/Users/b/code')
    expect(next.folders).toEqual({ enabled: true, dirs: ['/Users/b/Pictures', '/Volumes/x'] })
    expect(next.theme).toBe('dark')
    expect(next.plugins).toEqual([{ path: '/Users/b/plugins/q', url: 'git@example.com:a/q.git', enabled: false }])
    expect(next.configRepo).toBe('')
    expect(next.projects).toEqual(base.projects)
  })

  it('carries plugins installed from a URL, and leaves folders of your own on each machine', () => {
    expect(JSON.parse(toFile(base, '', '/Users/a')).plugins).toEqual([{ url: 'git@example.com:a/q.git', enabled: false }])
    const own = { path: '/Users/b/dev/mine', enabled: true }
    const gone = { path: '/Users/b/plugins/old', url: 'https://example.com/old.git', enabled: true }
    // Installed here before it was synced: the same clone, not a second one.
    const clone = { path: '/Users/b/plugins/r', enabled: true }
    const raw = { plugins: [{ url: 'git@example.com:a/q.git', enabled: true }, { url: 'https://example.com/r.git' }, { url: '..' }, 'x'] }
    const next = fromFile(raw, { ...base, plugins: [own, gone, clone] }, '/Users/b/plugins', '/Users/b')
    expect(next.plugins).toEqual([
      own,
      { ...clone, url: 'https://example.com/r.git' },
      { path: '/Users/b/plugins/q', url: 'git@example.com:a/q.git', enabled: true }
    ])
  })

  it('carries the scratchpad, and leaves it alone when a file has none', () => {
    expect(scratchOf(JSON.parse(toFile(base, 'notes', '/Users/a')))).toBe('notes')
    expect(scratchOf({ theme: 'dark' })).toBeNull()
  })

  it('rejects anything else', () => {
    for (const raw of [null, [], 'x', { foo: 1 }]) expect(() => fromFile(raw, base, '/p')).toThrow()
  })

  it("keeps a sync's values over a window save that hasn't seen it, but takes the window's own changes", () => {
    const old = travelling(base)
    const synced: Settings = { ...base, theme: 'light', commitCommand: 'y' }
    // Sent before the window had the sync, with a change of its own.
    const stale = overStale({ ...base, readme: false, active: '/Users/a/q' }, synced, [old])
    expect(stale).toMatchObject({ theme: 'light', commitCommand: 'y', readme: false, active: '/Users/a/q' })
    // Once it shows the sync, nothing in its saves is old.
    expect(overStale({ ...synced, notifications: true }, synced, [old])).toBeNull()
  })
})
