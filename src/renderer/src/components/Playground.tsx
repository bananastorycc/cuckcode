import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { Theme } from '../../../shared/types'

interface Props {
  project: string
  slot: number // from 1
  name: string
  // When the page last changed; null when no page has been made.
  version: number | null
  theme: Theme
  // The page's Done button: tell the agent.
  onDone: () => void
  // Back to the workspace (same as ⌥⌘<slot>).
  onClose: () => void
}

type Message = { cuckcode: 'save'; id: number; root: string; name: string; text: string } | { cuckcode: 'done' }

// A slot's .cuckcode/playground/<slot>/index.html, which an agent writes. The page saves answers
// through window.cuckcode (injected by media.ts), relayed here because only this side has the api;
// its Done button lands here too.
export default function Playground({ project, slot, name, version, theme, onDone, onClose }: Props): React.JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null)
  // The kit's showcase: every block, so you can see what an agent can put here.
  const [showcase, setShowcase] = useState(false)
  const done = useRef(onDone)
  done.current = onDone

  useEffect(() => {
    const onMessage = (e: MessageEvent): void => {
      const win = frame.current?.contentWindow
      const d = e.data as Message | null
      if (!win || e.source !== win) return
      if (d?.cuckcode === 'done') return done.current()
      if (d?.cuckcode !== 'save') return
      const reply = (error?: string): void => win.postMessage({ cuckcode: 'saved', id: d.id, error }, '*')
      // The page's own slot, not the current one: switching projects runs the old page's last
      // save (on pagehide) after the props already point at the new project.
      const [, id, slot] = String(d.root).split('/')
      window.api.playSave(decodeURIComponent(id ?? ''), Number(slot), String(d.name), String(d.text)).then(
        () => reply(),
        (err: Error) => reply(err.message)
      )
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-line bg-panel px-3 font-mono text-xs text-muted">
        <span>{showcase ? `${name} · templates` : name}</span>
        <div className="flex items-center gap-1">
          <button className="rounded px-1.5 py-0.5 hover:bg-hover hover:text-fg" onClick={() => setShowcase((s) => !s)}>
            {showcase ? 'Back' : 'Templates'}
          </button>
          <button className="rounded p-1 hover:bg-hover hover:text-fg" title={`Close (⌥⌘${slot % 10}). Answers are kept.`} onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {showcase ? (
        <iframe src={`media://kit/showcase.html?theme=${theme}`} allow="clipboard-write" className="min-h-0 w-full flex-1 border-0 bg-bg" />
      ) : version === null ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-xs text-muted">
          <span>Nothing here yet. Agents with Playground on put pages here when showing beats describing, or ask yours to.</span>
          <button className="text-accent hover:underline" onClick={() => setShowcase(true)}>
            See what it can make
          </button>
        </div>
      ) : (
        <iframe
          ref={frame}
          allow="clipboard-write"
          src={`media://play/${encodeURIComponent(project)}/${slot}/index.html?v=${version}&theme=${theme}`}
          className="min-h-0 w-full flex-1 border-0 bg-bg"
        />
      )}
    </div>
  )
}
