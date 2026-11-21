import { useEffect, useSyncExternalStore, type ReactNode } from 'react'

// One notepad shared by every project tab; it saves to app data, not into any repo. Its text lives
// here, once, so every pad on screen (the Scratch section, one inside a plugin's view) shows the
// same notes as they're typed.
const SAVE_MS = 500
let pending: { text: string; timer: ReturnType<typeof setTimeout> } | null = null
let text: string | null = null // null until loaded
let loading = false
const listeners = new Set<() => void>()

const set = (next: string): void => {
  text = next
  listeners.forEach((l) => l())
}

// Writes a save still on the timer; called on quit.
export async function flushScratch(): Promise<void> {
  if (!pending) return
  clearTimeout(pending.timer)
  const { text } = pending
  pending = null
  await window.api.scratchWrite(text).catch(() => {})
}

function load(): void {
  if (loading) return
  loading = true
  window.api.scratchRead().then((t) => text === null && set(t))
  // From the config repo or an import. While a save is pending, this machine's notes win: the
  // save syncs them back out.
  window.api.onRemoteScratch((next) => {
    if (!pending) set(next)
  })
}

const subscribe = (l: () => void): (() => void) => {
  load()
  listeners.add(l)
  return () => listeners.delete(l)
}

// actions: drawn at the right of its title bar (a plugin's minimize button).
export default function Scratch({ actions }: { actions?: ReactNode }): React.JSX.Element {
  const value = useSyncExternalStore(subscribe, () => text)
  // Typed in and then closed (a plugin's pad): the save still on the timer goes now.
  useEffect(() => () => void flushScratch(), [])

  const change = (next: string): void => {
    set(next)
    if (pending) clearTimeout(pending.timer)
    pending = { text: next, timer: setTimeout(flushScratch, SAVE_MS) }
  }

  return (
    <div className="flex h-full flex-col border-t border-line bg-panel">
      <div className="flex h-8 shrink-0 items-center border-b border-line bg-panel px-3 font-mono text-xs text-muted">
        <span className="flex-1">scratch</span>
        {actions}
      </div>
      <textarea
        value={value ?? ''}
        disabled={value === null}
        onChange={(e) => change(e.target.value)}
        spellCheck={false}
        placeholder="Notes for every project…"
        className="min-h-0 flex-1 resize-none select-text bg-panel px-3 py-2 font-mono text-xs text-fg outline-hidden placeholder:text-muted"
      />
    </div>
  )
}
