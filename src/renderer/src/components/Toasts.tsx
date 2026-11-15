import { useEffect, useRef, useState } from 'react'

interface Toast {
  id: number
  ok: boolean
  title: string
  text: string
}

const FADE_MS = 6000

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

  // Successes fade on their own (held while hovered, to finish reading); failures stay until clicked.
  useEffect(() => {
    if (!t.ok || hover) return
    const timer = setTimeout(() => dismiss.current(), FADE_MS)
    return () => clearTimeout(timer)
  }, [t.ok, hover])

  return (
    <div
      onClick={() => !window.getSelection()?.toString() && onDismiss()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`pointer-events-auto w-full select-text rounded border bg-panel px-3 py-2 font-mono text-xs shadow-lg ${
        t.ok ? 'border-line' : 'border-del'
      }`}
    >
      <div className={`mb-0.5 font-bold ${t.ok ? 'text-add' : 'text-del'}`}>{t.title}</div>
      <div className="max-h-40 overflow-y-auto whitespace-pre-wrap wrap-break-word text-fg">{t.text}</div>
    </div>
  )
}
