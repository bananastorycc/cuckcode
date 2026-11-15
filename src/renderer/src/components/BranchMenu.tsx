import { useEffect, useRef, useState } from 'react'
import { Check, GitBranch, Plus } from 'lucide-react'
import type { Branches, Remote } from '../../../shared/types'
import { saveAll } from './CodePane'
import { clamp } from '../clamp'

interface Props {
  cwd: string
  branch: string
  onChanged: () => void
}

interface Item {
  name: string
  kind: 'local' | 'remote' | 'create'
}

// The branch label opens a picker: type to filter, ↑↓ and ↩ to switch, or ↩ on a new
// name to create it from HEAD. A new branch is pushed by the next commit or sync.
// Below the list, each remote's URL can be edited in place (or origin added when there's none).
export default function BranchMenu({ cwd, branch, onChanged }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [branches, setBranches] = useState<Branches | null>(null)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const list = useRef<HTMLDivElement>(null)

  const show = (): void => {
    setOpen(true)
    setQuery('')
    setIndex(0)
    setError('')
    setBranches(null)
    load()
  }

  const load = (): void => {
    window.api.branches(cwd).then(setBranches, () => setBranches({ local: [], remote: [], remotes: [] }))
  }

  const saveRemote = async (name: string, url: string): Promise<void> => {
    setError('')
    const r = await window.api.setRemote(cwd, name, url)
    if (!r.ok) setError(r.output)
    load()
    onChanged()
  }

  const q = query.trim()
  const hit = (name: string): boolean => name.toLowerCase().includes(q.toLowerCase())
  const items: Item[] = branches
    ? [
        ...branches.local.filter(hit).map((name): Item => ({ name, kind: 'local' })),
        ...branches.remote.filter(hit).map((name): Item => ({ name, kind: 'remote' }))
      ]
    : []
  if (branches && q && !branches.local.includes(q) && !branches.remote.includes(q)) items.push({ name: q, kind: 'create' })
  const at = clamp(index, 0, items.length - 1)

  useEffect(() => {
    list.current?.children[at]?.scrollIntoView({ block: 'nearest' })
  }, [at])

  const pick = async (item: Item | undefined): Promise<void> => {
    if (!item || busy) return
    if (item.kind === 'local' && item.name === branch) return setOpen(false)
    setBusy(true)
    setError('')
    // Unsaved edits belong to this branch, not the next one.
    await saveAll()
    const r = await window.api.git(cwd, item.kind === 'create' ? 'branch' : 'switch', item.name)
    setBusy(false)
    onChanged()
    if (r.ok) setOpen(false)
    else setError(r.output)
  }

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex(clamp(at + (e.key === 'ArrowDown' ? 1 : -1), 0, items.length - 1))
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) pick(items[at])
    else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => (open ? setOpen(false) : show())}
        title="Switch or create branch"
        className="-mx-1 flex items-center gap-1 whitespace-nowrap rounded-sm px-1 font-mono hover:bg-hover hover:text-fg"
      >
        <GitBranch className="h-3 w-3 shrink-0" />
        {branch}
      </button>
      {open && (
        <>
          <div className="no-drag fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-sm border border-line bg-panel shadow-lg">
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setIndex(0)
              }}
              onKeyDown={onKey}
              spellCheck={false}
              placeholder="Switch or create branch…"
              className="w-full select-text border-b border-line bg-bg px-2 py-1 font-mono text-xs text-fg outline-hidden"
            />
            <div ref={list} className="max-h-80 overflow-y-auto py-1">
              {items.map((it, i) => (
                <button
                  key={`${it.kind}:${it.name}`}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => pick(it)}
                  disabled={busy}
                  className={`flex w-full items-center gap-1.5 px-2 py-0.5 text-left font-mono text-xs text-fg outline-hidden ${
                    i === at ? 'bg-hover' : ''
                  }`}
                >
                  {it.kind === 'create' ? (
                    <Plus className="h-3 w-3 shrink-0 text-accent" />
                  ) : it.kind === 'local' && it.name === branch ? (
                    <Check className="h-3 w-3 shrink-0 text-accent" />
                  ) : (
                    <span className="w-3 shrink-0" />
                  )}
                  <span className="truncate">{it.kind === 'create' ? `Create ${it.name}` : it.name}</span>
                  {it.kind === 'remote' && <span className="ml-auto shrink-0 pl-1 text-muted">remote</span>}
                </button>
              ))}
              {branches && !items.length && <div className="px-2 py-0.5 text-xs text-muted">No branches</div>}
            </div>
            {branches && (
              <div className="border-t border-line py-1">
                <div className="px-2 pb-0.5 text-[10px] uppercase tracking-wide text-muted">Remote</div>
                {(branches.remotes.length ? branches.remotes : [{ name: 'origin', url: '' }]).map((r) => (
                  <RemoteRow key={r.name} remote={r} onSave={(url) => saveRemote(r.name, url)} />
                ))}
              </div>
            )}
            {error && (
              <div className="max-h-24 select-text overflow-y-auto whitespace-pre-wrap border-t border-line px-2 py-1 font-mono text-xs text-del">
                {error}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// Enter saves a changed URL, Escape or leaving the field puts the saved one back.
function RemoteRow({ remote, onSave }: { remote: Remote; onSave: (url: string) => void }): React.JSX.Element {
  const [url, setUrl] = useState(remote.url)
  useEffect(() => setUrl(remote.url), [remote.url])

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      const next = url.trim()
      if (next && next !== remote.url) onSave(next)
      e.currentTarget.blur()
    } else if (e.key === 'Escape') e.currentTarget.blur()
  }

  return (
    <label className="flex items-center gap-1.5 px-2 py-0.5 font-mono text-xs">
      <span className="shrink-0 text-muted">{remote.name}</span>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => setUrl(remote.url)}
        spellCheck={false}
        placeholder={remote.url ? '' : 'Add remote URL…'}
        title={remote.url ? 'Edit, then ↩ to save' : 'Paste a URL, then ↩ to add'}
        className="min-w-0 flex-1 select-text rounded-sm border border-transparent bg-transparent px-1 text-fg outline-hidden hover:border-line focus:border-line focus:bg-bg"
      />
    </label>
  )
}
