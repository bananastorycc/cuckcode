import { useEffect, useRef, useState } from 'react'

interface Ask {
  title: string
  detail?: string
  action: string // the confirming button's label
  danger?: boolean // the action destroys something: tinted in --del
  dontAsk?: boolean // offer a "Don't ask again" checkbox
}

interface Answer {
  yes: boolean
  dontAsk: boolean // ticked, and confirmed
}

interface Pending extends Ask {
  answer: (a: Answer) => void
}

let show: ((p: Pending) => void) | null = null

// An in-app replacement for window.confirm, which Electron draws as a native sheet. Resolves
// no if nothing is mounted to ask, or another question replaces this one.
export function askFull(q: Ask): Promise<Answer> {
  return new Promise((answer) => (show ? show({ ...q, answer }) : answer({ yes: false, dontAsk: false })))
}

export async function ask(q: Ask): Promise<boolean> {
  return (await askFull(q)).yes
}

export default function Confirm(): React.JSX.Element | null {
  const [pending, setPending] = useState<Pending | null>(null)
  const [dontAsk, setDontAsk] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const restore = useRef<Element | null>(null)
  // The question up now, outside state: setPending's updater must stay pure.
  const current = useRef<Pending | null>(null)

  useEffect(() => {
    show = (p) => {
      if (current.current) current.current.answer({ yes: false, dontAsk: false })
      else restore.current = document.activeElement
      current.current = p
      setDontAsk(false)
      setPending(p)
    }
    return () => {
      show = null
    }
  }, [])

  useEffect(() => {
    if (pending) button.current?.focus()
  }, [pending])

  if (!pending) return null

  const done = (yes: boolean): void => {
    pending.answer({ yes, dontAsk: yes && dontAsk })
    current.current = null
    setPending(null)
    if (restore.current instanceof HTMLElement) restore.current.focus()
  }

  return (
    <div
      className="absolute inset-0 z-50 flex items-start justify-center bg-bg/60 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && done(false)}
      onKeyDown={(e) => {
        // Enter is the focused button's own click, so tabbing to Cancel and pressing it cancels.
        if (e.key !== 'Escape') return
        done(false)
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <div
        role="alertdialog"
        aria-label={pending.title}
        className={`confirm-pop mt-24 w-[400px] max-w-[90%] overflow-hidden rounded-md border border-l-[3px] border-line bg-panel font-mono text-xs shadow-lg ${
          pending.danger ? 'border-l-del' : 'border-l-accent'
        }`}
      >
        <div className="px-4 pb-3 pt-3.5">
          <div className="text-sm font-bold text-fg">{pending.title}</div>
          {pending.detail && <div className="mt-1.5 leading-relaxed text-muted">{pending.detail}</div>}
        </div>
        <div className="flex items-center justify-end gap-1.5 border-t border-line bg-bg/40 px-3 py-2">
          {pending.dontAsk && (
            <label className="mr-auto flex cursor-pointer items-center gap-1.5 text-muted">
              <input type="checkbox" className="accent-accent" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} />
              Don't ask again
            </label>
          )}
          <button className="btn text-muted" onClick={() => done(false)}>
            Cancel <kbd className="text-[10px] opacity-60">esc</kbd>
          </button>
          <button
            ref={button}
            onClick={() => done(true)}
            className={`btn border outline-hidden ${
              pending.danger
                ? 'border-del/50 text-del hover:bg-del/15 focus:bg-del/15'
                : 'border-accent/50 text-accent hover:bg-accent/15 focus:bg-accent/15'
            }`}
          >
            {pending.action} <kbd className="text-[10px] opacity-60">↵</kbd>
          </button>
        </div>
      </div>
    </div>
  )
}
