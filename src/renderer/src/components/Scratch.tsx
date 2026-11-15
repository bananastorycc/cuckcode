import { useEffect, useState } from 'react'

// One notepad shared by every project tab; it saves to app data, not into any repo.
const SAVE_MS = 500
let pending: { text: string; timer: ReturnType<typeof setTimeout> } | null = null

// Writes a save still on the timer; called on quit.
export async function flushScratch(): Promise<void> {
  if (!pending) return
  clearTimeout(pending.timer)
  const { text } = pending
  pending = null
  await window.api.scratchWrite(text).catch(() => {})
}

export default function Scratch(): React.JSX.Element {
  const [text, setText] = useState<string | null>(null)

  useEffect(() => {
    // A write still pending from before an unmount would otherwise be read back stale.
    flushScratch().then(() => window.api.scratchRead()).then(setText)
  }, [])

  // From the config repo or an import. While a save is pending, this machine's notes win: the
  // save syncs them back out.
  useEffect(
    () =>
      window.api.onRemoteScratch((next) => {
        if (!pending) setText(next)
      }),
    []
  )

  const change = (next: string): void => {
    setText(next)
    if (pending) clearTimeout(pending.timer)
    pending = { text: next, timer: setTimeout(flushScratch, SAVE_MS) }
  }

  return (
    <div className="flex h-full flex-col border-t border-line bg-panel">
      <div className="flex h-8 shrink-0 items-center border-b border-line bg-panel px-3 font-mono text-xs text-muted">scratch</div>
      <textarea
        value={text ?? ''}
        disabled={text === null}
        onChange={(e) => change(e.target.value)}
        spellCheck={false}
        placeholder="Notes for every project…"
        className="min-h-0 flex-1 resize-none select-text bg-panel px-3 py-2 font-mono text-xs text-fg outline-hidden placeholder:text-muted"
      />
    </div>
  )
}
