import { useEffect, useMemo, useRef, useState } from 'react'
import { fuzzy } from '../../../shared/fuzzy'
import type { ChangedFile, GitStatus } from '../../../shared/types'
import { CODE_COLOR } from './FileTree'

interface Props {
  root: string
  status: GitStatus | null
  open: number // bumps on ⌘O
  onPick: (file: ChangedFile) => void
}

const RECENT_MAX = 10
// Per repo root, most recent first. Only for this run: an empty query shows them.
const recents = new Map<string, string[]>()

export default function QuickOpen({ root, status, open, onPick }: Props): React.JSX.Element | null {
  const [shown, setShown] = useState(false)
  const [query, setQuery] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const restore = useRef<Element | null>(null)

  // Fetched fresh on each open, then held while typing.
  useEffect(() => {
    if (!open || !root) return
    restore.current = document.activeElement
    setShown(true)
    setQuery('')
    setIndex(0)
    let live = true
    window.api.files(root).then(
      (f) => live && setFiles(f),
      () => live && setFiles([])
    )
    return () => {
      live = false
    }
  }, [open])

  useEffect(() => {
    if (shown) input.current?.focus()
  }, [shown])

  const results = useMemo(() => {
    if (query.trim()) return fuzzy(query, files)
    const have = new Set(files)
    return (recents.get(root) ?? []).filter((p) => have.has(p))
  }, [query, files, root])

  useEffect(() => {
    const row = list.current?.children[index] as HTMLElement | undefined
    row?.scrollIntoView({ block: 'nearest' })
  }, [index])

  if (!shown) return null

  const close = (): void => {
    setShown(false)
    if (restore.current instanceof HTMLElement) restore.current.focus()
  }

  const pick = (path: string): void => {
    recents.set(root, [path, ...(recents.get(root) ?? []).filter((p) => p !== path)].slice(0, RECENT_MAX))
    setShown(false)
    onPick(status?.files.find((f) => f.path === path) ?? { path, code: 'M' })
  }

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape') close()
    else if (e.key === 'ArrowDown') setIndex((i) => Math.min(results.length - 1, i + 1))
    else if (e.key === 'ArrowUp') setIndex((i) => Math.max(0, i - 1))
    else if (e.key === 'Enter' && results[index]) pick(results[index])
    else return
    e.preventDefault()
  }

  const codes = new Map(status?.files.map((f) => [f.path, f.code]))

  return (
    <div className="absolute inset-0 z-40 flex justify-center" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="mt-16 flex h-fit max-h-[60%] w-[560px] max-w-[90%] flex-col rounded-md border border-line bg-panel shadow-lg">
        <input
          ref={input}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setIndex(0)
          }}
          onKeyDown={onKey}
          onBlur={close}
          placeholder="Go to file…"
          spellCheck={false}
          className="m-2 select-text rounded-sm border border-line bg-bg px-2 py-1 font-mono text-xs outline-hidden focus:border-accent"
        />
        {results.length > 0 && (
          <div ref={list} className="min-h-0 overflow-y-auto pb-1">
            {results.map((path, i) => {
              const slash = path.lastIndexOf('/')
              const code = codes.get(path)
              return (
                <button
                  key={path}
                  // Picked on mousedown, before the input's blur closes the palette.
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pick(path)
                  }}
                  onMouseMove={() => setIndex(i)}
                  className={`flex w-full items-baseline gap-2 px-3 py-1 text-left font-mono text-xs ${i === index ? 'bg-hover' : ''}`}
                >
                  <span className={`shrink-0 ${code ? CODE_COLOR[code] : ''}`}>{path.slice(slash + 1)}</span>
                  {slash > 0 && <span className="truncate text-muted">{path.slice(0, slash)}</span>}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
