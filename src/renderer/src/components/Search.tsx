import { useEffect, useMemo, useRef, useState } from 'react'
import { CaseSensitive, ChevronDown, ChevronRight, Regex, ReplaceAll, WholeWord, type LucideIcon } from 'lucide-react'
import { replaceIn, toRegExp } from '../../../shared/search'
import type { SearchMatch, SearchQuery, SearchResult } from '../../../shared/types'
import { saveAll } from './CodePane'

interface Props {
  root: string
  tick: number // bumps on any file system change in the project
  focus: number // bumps on ⌘⇧F
  onOpen: (path: string, line: number, col: number, len: number) => void
}

type Flag = 'caseSensitive' | 'word' | 'regex'

const FLAGS: [Flag, LucideIcon, string][] = [
  ['caseSensitive', CaseSensitive, 'Match Case'],
  ['word', WholeWord, 'Match Whole Word'],
  ['regex', Regex, 'Use Regular Expression']
]

export default function Search({ root, tick, focus, onOpen }: Props): React.JSX.Element {
  const [q, setQ] = useState<SearchQuery>({ text: '', regex: false, caseSensitive: false, word: false })
  const [replacement, setReplacement] = useState('')
  // Tagged with its root: after a tab switch, the last project's hits must not show (or open) here.
  const [found, setFound] = useState<{ root: string; result: SearchResult } | null>(null)
  const result = found?.root === root ? found.result : null
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const searching = useRef<Promise<unknown>>(Promise.resolve())

  useEffect(() => {
    if (focus) input.current?.select()
  }, [focus])

  // Debounced, and rerun on file changes so results (and replaces) stay fresh. One at a time:
  // while an agent writes, changes land faster than a big repo scans, and scans would pile up in main.
  useEffect(() => {
    if (!root || !q.text) return setFound(null)
    let live = true
    const t = setTimeout(() => {
      searching.current = searching.current.then(() =>
        live
          ? window.api.search(root, q).then(
              (r) => live && setFound({ root, result: r }),
              () => live && setFound(null)
            )
          : undefined
      )
    }, 200)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [root, q, tick])

  // Single-match regex for previewing each hit's replacement.
  const one = useMemo(() => {
    try {
      return q.text ? toRegExp(q, false) : null
    } catch {
      return null
    }
  }, [q])
  const preview = replacement && one ? (m: string): string => replaceIn(m, one, q, replacement) : null

  const files = result?.files ?? []
  const count = files.reduce((n, f) => n + f.matches.reduce((k, m) => k + m.ranges.length, 0), 0)

  const replace = async (paths: string[]): Promise<void> => {
    if (busy || !paths.length) return
    setBusy(true)
    // An unsaved edit saved after the replace would write the old text back.
    await saveAll()
    await window.api.replace(root, q, replacement, paths).catch(() => 0)
    setBusy(false)
  }

  const toggle = (path: string): void =>
    setCollapsed((c) => {
      const next = new Set(c)
      if (!next.delete(path)) next.add(path)
      return next
    })

  const field = 'min-w-0 flex-1 select-text bg-transparent px-2 py-1 font-mono text-xs outline-hidden'

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="shrink-0 space-y-1 border-b border-line p-2">
        <div className="flex items-center rounded-sm border border-line bg-bg focus-within:border-accent">
          <input
            ref={input}
            value={q.text}
            onChange={(e) => setQ({ ...q, text: e.target.value })}
            placeholder="Search"
            spellCheck={false}
            className={field}
          />
          {FLAGS.map(([flag, Icon, title]) => (
            <button
              key={flag}
              title={title}
              onClick={() => setQ({ ...q, [flag]: !q[flag] })}
              className={`mr-0.5 shrink-0 rounded-sm p-0.5 ${q[flag] ? 'bg-hover text-accent' : 'text-muted hover:text-fg'}`}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
        <div className="flex items-center rounded-sm border border-line bg-bg focus-within:border-accent">
          <input
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && e.metaKey && replace(files.map((f) => f.path))}
            placeholder="Replace"
            spellCheck={false}
            className={field}
          />
          <button
            title="Replace All (⌘↩)"
            disabled={busy || !files.length}
            onClick={() => replace(files.map((f) => f.path))}
            className="mr-0.5 shrink-0 rounded-sm p-0.5 text-muted hover:text-fg disabled:opacity-40 disabled:hover:text-muted"
          >
            <ReplaceAll className="h-3.5 w-3.5" />
          </button>
        </div>
        {result && (
          <div className={`truncate px-0.5 text-[0.85rem] ${result.error ? 'text-del' : 'text-muted'}`} title={result.error}>
            {result.error ??
              (count
                ? `${count}${result.truncated ? '+' : ''} result${count === 1 ? '' : 's'} in ${files.length} file${files.length === 1 ? '' : 's'}`
                : 'No results')}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {files.map((f) => {
          const slash = f.path.lastIndexOf('/')
          const open = !collapsed.has(f.path)
          const Chevron = open ? ChevronDown : ChevronRight
          return (
            <div key={f.path}>
              <div
                onClick={() => toggle(f.path)}
                title={f.path}
                className="group flex items-center gap-1 py-0.5 pl-2 pr-2 font-mono text-xs hover:bg-hover"
              >
                <Chevron className="h-3 w-3 shrink-0 text-muted" />
                <span className="truncate">
                  {f.path.slice(slash + 1)}
                  {slash > 0 && <span className="ml-2 text-muted">{f.path.slice(0, slash)}</span>}
                </span>
                <span className="ml-auto shrink-0 pl-1 text-[0.85rem] text-muted group-hover:hidden">{f.matches.length}</span>
                <button
                  title="Replace in File"
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation()
                    replace([f.path])
                  }}
                  className="ml-auto hidden shrink-0 text-muted hover:text-fg group-hover:block"
                >
                  <ReplaceAll className="h-3.5 w-3.5" />
                </button>
              </div>
              {open &&
                f.matches.map((m) => (
                  <button
                    key={m.line}
                    onClick={() => onOpen(f.path, m.line, m.col, m.ranges[0][1] - m.ranges[0][0])}
                    title={`Line ${m.line}`}
                    className="block w-full truncate whitespace-pre py-0.5 pl-7 pr-2 text-left font-mono text-xs outline-hidden hover:bg-hover focus:bg-hover"
                  >
                    <Line match={m} preview={preview} />
                  </button>
                ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const LEAD = 12

function Line({ match, preview }: { match: SearchMatch; preview: ((m: string) => string) | null }): React.JSX.Element {
  const { text, ranges } = match
  // Drop indentation, and keep only a little lead-in so the hit fits the narrow panel.
  const indent = text.length - text.trimStart().length
  let at = Math.min(Math.max(indent, ranges[0][0] - LEAD), ranges[0][0])
  const parts: React.JSX.Element[] = []
  if (at > indent || match.col - 1 > ranges[0][0]) parts.push(<span key="lead">…</span>)
  for (const [s, e] of ranges) {
    if (s > at) parts.push(<span key={`t${s}`}>{text.slice(at, s)}</span>)
    const hit = text.slice(s, e)
    if (preview) {
      parts.push(<span key={`d${s}`} className="hit-del">{hit}</span>)
      parts.push(<span key={`a${s}`} className="hit-add">{preview(hit)}</span>)
    } else {
      parts.push(<span key={`h${s}`} className="hit">{hit}</span>)
    }
    at = e
  }
  parts.push(<span key="end">{text.slice(at)}</span>)
  return <>{parts}</>
}
