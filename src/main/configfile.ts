import { homedir } from 'node:os'
import { join } from 'node:path'
import { folderName } from '../shared/plugin'
import type { PluginRef, Settings } from '../shared/types'

// What travels between machines: the Settings screen's choices, the theme, the saved layouts,
// the plugins installed from a URL (as URLs) and (beside them, as `scratch`) the scratchpad.
// Plugin folders you added yourself and the sync repo are wired to this machine; projects, the
// window and the session stay home too.
const KEYS = ['theme', 'projectsDir', 'meters', 'notifications', 'readme', 'folders', 'playgrounds', 'webPages', 'agents', 'plugins', 'layouts'] as const

// Paths under home travel as ~/…, so they land in the same place for a different user name.
const tilde = (p: string, home: string): string => (p === home || p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p)
const expand = (p: unknown, home: string): unknown => (typeof p === 'string' && (p === '~' || p.startsWith('~/')) ? home + p.slice(1) : p)

export function toFile(s: Settings, scratch: string, home = homedir()): string {
  const out: Record<string, unknown> = Object.fromEntries(KEYS.map((k) => [k, s[k]]))
  out.projectsDir = s.projectsDir && tilde(s.projectsDir, home)
  out.folders = { ...s.folders, dirs: s.folders.dirs.map((d) => tilde(d, home)) }
  out.plugins = s.plugins.filter((p) => p.url).map((p) => ({ url: p.url, enabled: p.enabled }))
  out.scratch = scratch
  return `${JSON.stringify(out, null, 2)}\n`
}

// The file's keys over the current settings, for the caller's parse to validate. A key the file
// lacks keeps its current value. A plugin new to this machine gets a folder in pluginsDir, which
// the next launch clones.
/* eslint-disable @typescript-eslint/no-explicit-any */
export function fromFile(raw: any, current: Settings, pluginsDir: string, home = homedir()): Record<string, unknown> {
  const keys = raw && typeof raw === 'object' && !Array.isArray(raw) ? KEYS.filter((k) => k in raw) : []
  if (!keys.length) throw new Error('Not a cuckcode config file.')
  const picked: Record<string, any> = Object.fromEntries(keys.map((k) => [k, raw[k]]))
  if ('projectsDir' in picked) picked.projectsDir = expand(picked.projectsDir, home)
  if (Array.isArray(picked.folders?.dirs)) picked.folders = { ...picked.folders, dirs: picked.folders.dirs.map((d: unknown) => expand(d, home)) }
  if ('plugins' in picked) picked.plugins = plugins(picked.plugins, current.plugins, pluginsDir)
  return { ...current, ...picked }
}

// This machine's own folders stay where they are; the URL-installed ones follow the file: kept
// (taking its on/off), dropped when it lacks them, added when new. A clone already in the plugins
// folder is the same plugin, so it's taken rather than listed twice.
function plugins(raw: any, current: PluginRef[], dir: string): PluginRef[] {
  const wanted = new Map<string, PluginRef>()
  for (const p of Array.isArray(raw) ? raw : []) {
    const name = typeof p?.url === 'string' ? folderName(p.url) : ''
    if (/^[\w-]/.test(name)) wanted.set(p.url, { path: join(dir, name), url: p.url, enabled: p.enabled !== false })
  }
  const match = (c: PluginRef): PluginRef | undefined => [...wanted.values()].find((w) => (c.url ? w.url === c.url : w.path === c.path))
  const kept = current.flatMap((c) => {
    const w = match(c)
    return w ? [{ ...c, url: w.url, enabled: w.enabled }] : c.url ? [] : [c]
  })
  return [...kept, ...[...wanted.values()].filter((w) => !kept.some((k) => k.url === w.url))]
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
