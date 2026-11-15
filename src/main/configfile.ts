import { homedir } from 'node:os'
import type { Settings } from '../shared/types'

// What travels between machines: the Settings screen's choices, the theme, the saved layouts and
// (beside them, as `scratch`) the scratchpad.
// Installed plugins and the sync repo are wired to this machine; projects, the window and the
// session stay home too.
const KEYS = ['theme', 'projectsDir', 'meters', 'notifications', 'readme', 'folders', 'playgrounds', 'webPages', 'agents', 'layouts'] as const

// Paths under home travel as ~/…, so they land in the same place for a different user name.
const tilde = (p: string, home: string): string => (p === home || p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p)
const expand = (p: unknown, home: string): unknown => (typeof p === 'string' && (p === '~' || p.startsWith('~/')) ? home + p.slice(1) : p)

export function toFile(s: Settings, scratch: string, home = homedir()): string {
  const out: Record<string, unknown> = Object.fromEntries(KEYS.map((k) => [k, s[k]]))
  out.projectsDir = s.projectsDir && tilde(s.projectsDir, home)
  out.folders = { ...s.folders, dirs: s.folders.dirs.map((d) => tilde(d, home)) }
  out.scratch = scratch
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

// The file's scratchpad; null when it has none, which leaves this machine's alone.
export const scratchOf = (raw: any): string | null => (typeof raw?.scratch === 'string' ? raw.scratch : null)
/* eslint-enable @typescript-eslint/no-explicit-any */

// The travelling keys as JSON, to tell old values from new.
export const travelling = (s: Settings): Record<string, string> => Object.fromEntries(KEYS.map((k) => [k, JSON.stringify(s[k])]))

// A window save sent before the window showed settings that came from elsewhere (an import, the
// config repo) still carries values from before: `olds`, one per change it hasn't shown yet.
// Those keys keep the current values, so the save can't undo the change; a key the window
// changed itself is taken. Null when nothing in the save was old: the window has caught up.
export function overStale(save: Settings, current: Settings, olds: Record<string, string>[]): Settings | null {
  const out: Record<string, unknown> = { ...save }
  let stale = false
  for (const k of KEYS) {
    const value = JSON.stringify(save[k])
    if (value === JSON.stringify(current[k]) || !olds.some((o) => o[k] === value)) continue
    out[k] = current[k]
    stale = true
  }
  return stale ? (out as unknown as Settings) : null
}
