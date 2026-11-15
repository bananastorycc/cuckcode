import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ChangedFile, Commit, GitStatus } from '../../../shared/types'
import { FileRow } from './GitPanel'

interface Props {
  cwd: string
  status: GitStatus | null
  selected: ChangedFile | null
  onSelect: (file: ChangedFile) => void
}

// git log pages are this long; a shorter one means the start of history.
const PAGE = 100

export default function History({ cwd, status, selected, onSelect }: Props): React.JSX.Element {
  const [commits, setCommits] = useState<Commit[] | null>(null)
  const [more, setMore] = useState(false)
  const [open, setOpen] = useState<string | null>(selected?.commit ?? null)
  // Commits never change, so their file lists are fetched once.
  const [files, setFiles] = useState<Record<string, ChangedFile[]>>({})
  const loading = useRef(false)
  // Bumped when the list reloads, so a page fetched for the old list isn't appended to the new one.
  const generation = useRef(0)
  const root = status?.root ?? ''
  const head = status?.head

  // Reloaded when HEAD moves (a commit, pull, or branch switch), not on every file change.
  useEffect(() => {
    if (head === undefined) return
    generation.current++
    let live = true
    window.api.log(cwd, 0).then((c) => {
      if (!live) return
      setCommits(c)
      setMore(c.length === PAGE)
    })
    return () => {
      live = false
    }
  }, [cwd, head])

  useEffect(() => {
    if (!open || !root || files[open]) return
    window.api.commitFiles(root, open).then(
      (f) => setFiles((all) => ({ ...all, [open]: f })),
      () => setFiles((all) => ({ ...all, [open]: [] }))
    )
  }, [open, root, files])

  const loadMore = async (): Promise<void> => {
    if (!more || loading.current) return
    loading.current = true
    const gen = generation.current
    const next = await window.api.log(cwd, commits?.length ?? 0).catch(() => [])
    loading.current = false
    if (gen !== generation.current) return
    setCommits((c) => [...(c ?? []), ...next])
    setMore(next.length === PAGE)
  }

  const onScroll = (e: React.UIEvent<HTMLDivElement>): void => {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) loadMore()
  }

  // Up/down walk the rows, showing each file's diff as it's reached; right/left open and close a commit.
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const rows = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
    const i = rows.indexOf(document.activeElement as HTMLButtonElement)
    const sha = rows[i]?.dataset.commit
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const row = rows[i < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))]
      row?.focus()
      row?.scrollIntoView({ block: 'nearest' })
      if (row && !row.dataset.commit) row.click()
    } else if (e.key === 'ArrowRight' && sha && open !== sha) {
      setOpen(sha)
    } else if (e.key === 'ArrowLeft' && open) {
      e.preventDefault()
      rows.find((r) => r.dataset.commit === open)?.focus()
      setOpen(null)
    }
  }

  if (commits && !commits.length) {
    return <div className="flex flex-1 items-center justify-center text-xs text-muted">No commits yet</div>
  }

  return (
    <div
      tabIndex={-1}
      onKeyDown={onKey}
      onScroll={onScroll}
      className="min-h-0 flex-1 overflow-y-auto py-1 outline-hidden"
    >
      {commits?.map((c) => {
        const expanded = open === c.sha
        const Chevron = expanded ? ChevronDown : ChevronRight
        return (
          <div key={c.sha}>
            <button
              data-commit={c.sha}
              onClick={() => setOpen(expanded ? null : c.sha)}
              title={`${c.sha.slice(0, 7)} · ${c.author} · ${new Date(c.date * 1000).toLocaleString()}\n\n${c.subject}`}
              className="flex w-full items-center gap-1 py-1 pl-2 pr-3 text-left text-xs outline-hidden hover:bg-hover focus:bg-hover"
            >
              <Chevron className="h-3.5 w-3.5 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate">{c.subject}</span>
              <span className="shrink-0 pl-2 font-mono text-muted">{ago(c.date)}</span>
            </button>
            {expanded &&
              (files[c.sha] ?? []).map((f) => (
                <FileRow
                  key={f.path}
                  file={f}
                  indent
                  selected={selected?.commit === c.sha && selected.path === f.path}
                  onClick={() => onSelect(f)}
                />
              ))}
          </div>
        )
      })}
    </div>
  )
}

const UNITS: [number, string][] = [
  [365 * 86400, 'y'],
  [30 * 86400, 'mo'],
  [7 * 86400, 'w'],
  [86400, 'd'],
  [3600, 'h'],
  [60, 'm']
]

function ago(unix: number): string {
  const s = Date.now() / 1000 - unix
  for (const [n, unit] of UNITS) if (s >= n) return `${Math.floor(s / n)}${unit}`
  return 'now'
}
