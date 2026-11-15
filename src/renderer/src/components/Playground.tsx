import { useEffect, useRef } from 'react'

interface Props {
  project: string
  slot: number // from 1
  name: string
  // When the page last changed; null when Claude hasn't made one.
  version: number | null
}

interface SaveMessage {
  cuckcode: 'save'
  id: number
  name: string
  text: string
}

// A slot's .cuckcode/playground/<slot>/index.html, which Claude writes. The page saves answers
// through window.cuckcode (injected by media.ts), relayed here because only this side has the api.
export default function Playground({ project, slot, name, version }: Props): React.JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null)
  const target = useRef({ project, slot })
  target.current = { project, slot }

  useEffect(() => {
    const onMessage = (e: MessageEvent): void => {
      const win = frame.current?.contentWindow
      const d = e.data as SaveMessage | null
      if (!win || e.source !== win || d?.cuckcode !== 'save') return
      const reply = (error?: string): void => win.postMessage({ cuckcode: 'saved', id: d.id, error }, '*')
      window.api.playSave(target.current.project, target.current.slot, String(d.name), String(d.text)).then(
        () => reply(),
        (err: Error) => reply(err.message)
      )
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex h-8 shrink-0 items-center border-b border-line bg-panel px-3 font-mono text-xs text-muted">
        {name}
      </div>
      {version === null ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted">
          Nothing here yet. Ask Claude to put something in the {name}.
        </div>
      ) : (
        <iframe
          ref={frame}
          src={`media://play/${encodeURIComponent(project)}/${slot}/index.html?v=${version}`}
          className="min-h-0 w-full flex-1 border-0 bg-bg"
        />
      )}
    </div>
  )
}
