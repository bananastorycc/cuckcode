import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

interface Toast {
  id: number
  ok: boolean
  title: string
  text: string
}

// Failures get longer to be read, but still go: one that never fades just sits over the work.
const FADE_MS = 6000
const FAIL_FADE_MS = 30000

let nextId = 0
let push: ((t: Toast) => void) | null = null

// A floating note in the corner (git results, one per repo). Lives outside the panel that
// raised it, so a tab switch or several repos committing at once doesn't hide any.
export function toast(ok: boolean, title: string, text: string): void {
  push?.({ id: nextId++, ok, title, text })
}

export default function Toasts(): React.JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    push = (t) => setToasts((prev) => [...prev, t])
    return () => {
      push = null
    }
  }, [])

  const dismiss = (id: number): void => setToasts((prev) => prev.filter((t) => t.id !== id))

  return (
    <div className="pointer-events-none absolute bottom-2 right-2 z-40 flex max-w-[min(28rem,calc(100%-1rem))] flex-col items-end gap-1.5">
      {toasts.map((t) => (
        <Note key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  )
}

function Note({ toast: t, onDismiss }: { toast: Toast; onDismiss: () => void }): React.JSX.Element {
  const [hover, setHover] = useState(false)
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss

  // Fades on its own, held while hovered to finish reading; a click dismisses it sooner.
  useEffect(() => {
    if (hover) return
    const timer = setTimeout(() => dismiss.current(), t.ok ? FADE_MS : FAIL_FADE_MS)
    return () => clearTimeout(timer)
  }, [t.ok, hover])

  return (
    <div
      onClick={() => !window.getSelection()?.toString() && onDismiss()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`pointer-events-auto relative w-full select-text rounded border bg-panel py-2 pl-3 pr-7 font-mono text-xs shadow-lg ${
        t.ok ? 'border-line' : 'border-del'
      }`}
    >
      <button
        className="absolute right-1.5 top-1.5 text-muted hover:text-fg"
        title="Dismiss"
        onClick={(e) => {
          e.stopPropagation()
          onDismiss()
        }}
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <div className={`mb-0.5 font-bold ${t.ok ? 'text-add' : 'text-del'}`}>{t.title}</div>
      <div className="max-h-40 overflow-y-auto whitespace-pre-wrap wrap-break-word text-fg">{t.text}</div>
    </div>
  )
}
