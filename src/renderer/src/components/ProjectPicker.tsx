import { useEffect, useMemo, useRef, useState } from 'react'
import { fuzzy } from '../../../shared/fuzzy'
import { tildify } from './Header'

interface Props {
  open: number // bumps on ⌘T
  dir: string // the projects folder; '' until chosen
  onDir: (dir: string) => void
  exclude: string[] // already open as tabs
  onPick: (path: string) => void
}

const isRemote = (s: string): boolean => /^(https?:\/\/|ssh:\/\/|git:\/\/|[\w.-]+@[\w.-]+:)/.test(s)
// git@github.com:me/game.git → game
const nameOf = (remote: string): string =>
  remote.replace(/\/+$/, '').replace(/\.git$/, '').split(/[/:]/).pop()?.replace(/[^\w.-]/g, '-') ?? ''

// ⌘T: the folders in the projects folder that aren't open yet. A pasted git remote adds a new one there.
// The first ⌘T asks for that folder; it's kept in settings after that.
export default function ProjectPicker({ open, dir, onDir, exclude, onPick }: Props): React.JSX.Element | null {
  const where = tildify(dir)
  const [shown, setShown] = useState(false)
  const [query, setQuery] = useState('')
  const [name, setName] = useState('')
  const [repos, setRepos] = useState<string[]>([])
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setShown(true)
    setQuery('')
    setIndex(0)
    setError('')
  }, [open])

  useEffect(() => {
    if (!open || !dir) return
    let live = true
    window.api.repos(dir).then(
      (r) => live && setRepos(r),
      () => live && setRepos([])
    )
    return () => {
      live = false
    }
  }, [open, dir])

  useEffect(() => {
    if (shown) input.current?.focus()
  }, [shown, dir])

  const remote = isRemote(query.trim()) ? query.trim() : ''

  const results = useMemo(() => {
    const open = new Set(exclude)
    const left = repos.filter((p) => !open.has(p))
    if (!query.trim() || remote) return remote ? [] : left
    const byName = new Map(left.map((p) => [p.slice(p.lastIndexOf('/') + 1), p]))
    return fuzzy(query, [...byName.keys()]).map((n) => byName.get(n)!)
  }, [query, repos, exclude, remote])

  useEffect(() => {
    const row = list.current?.children[index] as HTMLElement | undefined
    row?.scrollIntoView({ block: 'nearest' })
  }, [index])

  if (!shown) return null

  const close = (): void => {
    if (!busy) setShown(false)
  }

  const pick = (path: string): void => {
    setShown(false)
    onPick(path)
  }

  const setUp = async (): Promise<void> => {
    if (busy || !remote || !name) return
    setBusy(true)
    setError('')
    try {
      const made = await window.api.setUpRepo(dir, remote, name)
      setShown(false)
      onPick(made)
    } catch (err) {
      // ipcRenderer.invoke wraps it: "Error invoking remote method 'x': Error: <message>"
      setError((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape') close()
    else if (e.key === 'ArrowDown') setIndex((i) => Math.max(0, Math.min(results.length - 1, i + 1)))
    else if (e.key === 'ArrowUp') setIndex((i) => Math.max(0, i - 1))
    else if (e.key === 'Enter') {
      if (remote) setUp()
      else if (results[index]) pick(results[index])
    } else return
    e.preventDefault()
  }

  const choose = async (): Promise<void> => {
    const picked = await window.api.pickFolder()
    if (picked) onDir(picked)
  }

  if (!dir) {
    return (
      <div className="absolute inset-0 z-50 flex justify-center" onMouseDown={(e) => e.target === e.currentTarget && close()}>
        <div
          className="mt-16 flex h-fit w-[560px] max-w-[90%] flex-col gap-2 rounded-md border border-line bg-panel p-3 text-xs shadow-lg"
          onKeyDown={(e) => e.key === 'Escape' && close()}
        >
          <div className="text-sm">Where do your projects live?</div>
          <div className="text-muted">
            ⌘T opens projects from this folder, and pasted git remotes are cloned into it. You can change it later in Settings.
          </div>
          <button ref={(b) => b?.focus()} className="btn ml-auto" onClick={choose}>
            Choose folder…
          </button>
        </div>
      </div>
    )
  }

  const field = 'select-text rounded-sm border border-line bg-bg px-2 py-1 font-mono text-xs outline-hidden focus:border-accent'

  return (
    <div className="absolute inset-0 z-50 flex justify-center" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="mt-16 flex h-fit max-h-[60%] w-[560px] max-w-[90%] flex-col rounded-md border border-line bg-panel shadow-lg">
        <input
          ref={input}
          value={query}
          disabled={busy}
          onChange={(e) => {
            const v = e.target.value
            setQuery(v)
            setIndex(0)
            setError('')
            if (isRemote(v.trim())) setName(nameOf(v.trim()))
          }}
          onKeyDown={onKey}
          placeholder={`Open from ${where}, or paste a git remote…`}
          spellCheck={false}
          className={`m-2 ${field}`}
        />
        {remote ? (
          <div className="flex flex-col gap-2 px-3 pb-3 text-xs">
            <label className="flex items-center gap-2 text-muted">
              <span className="shrink-0 font-mono">{where}/</span>
              <input
                value={name}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={onKey}
                spellCheck={false}
                className={`min-w-0 flex-1 text-fg ${field}`}
              />
            </label>
            <div className="flex items-center gap-2">
              <span className="text-muted">
                {busy ? 'Setting up…' : 'Empty remote: init, first commit, push to main. Otherwise: clone.'}
              </span>
              <button className="btn ml-auto" disabled={busy || !name} onClick={setUp}>
                Add ↵
              </button>
            </div>
            {error && <pre className="select-text whitespace-pre-wrap font-mono text-del">{error}</pre>}
          </div>
        ) : (
          <div ref={list} className="min-h-0 overflow-y-auto pb-1">
            {results.map((path, i) => (
              <button
                key={path}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(path)
                }}
                onMouseMove={() => setIndex(i)}
                className={`flex w-full px-3 py-1 text-left text-sm ${i === index ? 'bg-hover' : ''}`}
              >
                {path.slice(path.lastIndexOf('/') + 1)}
              </button>
            ))}
            {!results.length && (
              <div className="px-3 py-1 text-xs text-muted">
                {query.trim() ? `No match in ${where}.` : `Everything in ${where} is open. Paste a git remote to add one.`}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
