import { homedir } from 'node:os'
import type { Settings } from '../shared/types'

// What travels between machines: the Settings screen's choices, the theme and the saved layouts.
// Installed plugins and the sync repo are wired to this machine; projects, the window and the
// session stay home too.
const KEYS = ['theme', 'projectsDir', 'meters', 'notifications', 'readme', 'folders', 'playgrounds', 'webPages', 'agents', 'layouts'] as const

// Paths under home travel as ~/…, so they land in the same place for a different user name.
const tilde = (p: string, home: string): string => (p === home || p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p)
const expand = (p: unknown, home: string): unknown => (typeof p === 'string' && (p === '~' || p.startsWith('~/')) ? home + p.slice(1) : p)

export function toFile(s: Settings, home = homedir()): string {
  const out: Record<string, unknown> = Object.fromEntries(KEYS.map((k) => [k, s[k]]))
  out.projectsDir = s.projectsDir && tilde(s.projectsDir, home)
  out.folders = { ...s.folders, dirs: s.folders.dirs.map((d) => tilde(d, home)) }
  return `${JSON.stringify(out, null, 2)}\n`
}

// The file's keys over the current settings, for the caller's parse to validate. A key the file
// lacks keeps its current value.
/* eslint-disable @typescript-eslint/no-explicit-any */
export function fromFile(raw: any, current: Settings, home = homedir()): Record<string, unknown> {
  const keys = raw && typeof raw === 'object' && !Array.isArray(raw) ? KEYS.filter((k) => k in raw) : []
  if (!keys.length) throw new Error('Not a cuckcode config file.')
  const picked: Record<string, any> = Object.fromEntries(keys.map((k) => [k, raw[k]]))
  if ('projectsDir' in picked) picked.projectsDir = expand(picked.projectsDir, home)
  if (Array.isArray(picked.folders?.dirs)) picked.folders = { ...picked.folders, dirs: picked.folders.dirs.map((d: unknown) => expand(d, home)) }
  return { ...current, ...picked }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
