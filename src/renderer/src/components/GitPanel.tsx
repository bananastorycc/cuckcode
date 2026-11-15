import { useState } from 'react'
import { ArrowDown, ArrowUp, RefreshCw, Sparkles } from 'lucide-react'
import type { ChangedFile, GitOp, GitStatus } from '../../../shared/types'
import BranchMenu from './BranchMenu'
import { saveAll, saveFile } from './CodePane'
import { contextMenu } from './ContextMenu'
import { CODE_COLOR } from './FileTree'
import { projectName } from './Header'
import History from './History'
import { toast } from './Toasts'

export type GitTab = 'commit' | 'history'

interface Props {
  cwd: string
  projects: string[]
  status: GitStatus | null
  selected: ChangedFile | null
  tab: GitTab
  onTab: (tab: GitTab) => void
  onSelect: (file: ChangedFile) => void
  onChanged: () => void
  // A new file was discarded (it's in the Trash now), so it can't stay open.
  onDiscarded: (path: string) => void
}

export default function GitPanel({ cwd, projects, status, selected, tab, onTab, onSelect, onChanged, onDiscarded }: Props): React.JSX.Element {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState<GitOp | null>(null)
  const files = status?.files ?? []
  const picked = selected && !selected.commit ? selected.path : null

  // Arrow keys move the selection (and the diff) instead of scrolling the list.
  // ⌘⌫ discards, as it trashes in the file tree.
  const onListKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Backspace' && e.metaKey) {
      e.preventDefault()
      const f = files.find((x) => x.path === picked)
      if (f) void discard(f)
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    if (!files.length) return
    const i = files.findIndex((f) => f.path === picked)
    const next = i < 0 ? 0 : Math.min(files.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))
    onSelect(files[next])
    const row = e.currentTarget.children[next] as HTMLElement | undefined
    row?.focus()
    row?.scrollIntoView({ block: 'nearest' })
  }

  const run = async (op: GitOp): Promise<void> => {
    if (busy || (op === 'commit' && !message.trim())) return
    setBusy(op)
    await saveAll()
    const r = await window.api.git(cwd, op, message.trim())
    if (r.ok && op === 'commit') setMessage('')
    toast(r.ok, projectName(cwd), r.output)
    setBusy(null)
    onChanged()
  }

  const discard = async (f: ChangedFile): Promise<void> => {
    if (!status?.root) return
    await saveFile(`${status.root}/${f.path}`)
    const r = await window.api.discard(status.root, f)
    if (!r) return
    toast(r.ok, projectName(cwd), r.output)
    if (r.ok && (f.code === '?' || f.code === 'A' || f.code === 'R')) onDiscarded(f.path)
    onChanged()
  }

  const onRowMenu = async (e: React.MouseEvent, f: ChangedFile): Promise<void> => {
    e.preventDefault()
    onSelect(f)
    if ((await contextMenu(['Discard Changes…'])) === 0) await discard(f)
  }

  const repo = !status || !!status.root

  return (
    <div className="flex h-full flex-col border-t border-line bg-panel">
      {/* Wraps rather than overlapping: when narrow, the repo actions drop to their own row. */}
      <div className="flex shrink-0 flex-wrap items-center border-b border-line px-3 font-mono text-xs text-muted">
        {repo && (
          <div className="flex h-8 items-center gap-1">
            {(['commit', 'history'] as const).map((t) => (
              <button key={t} onClick={() => onTab(t)} className={`shrink-0 rounded-sm px-1.5 ${t === tab ? 'bg-bg text-fg ring-1 ring-line' : 'hover:bg-hover'}`}>
                {t}
                {t === 'commit' && files.length > 0 && <span className="ml-1 text-mod">{files.length}</span>}
              </button>
            ))}
          </div>
        )}
        <div className="flex h-8 min-w-0 max-w-full grow items-center justify-end gap-2 pl-2">
          <AllRepos projects={projects} onChanged={onChanged} />
          {status?.branch && <BranchMenu cwd={cwd} branch={status.branch} onChanged={onChanged} />}
        </div>
      </div>
      {!repo ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted">Not a git repository</div>
      ) : tab === 'history' ? (
        <History cwd={cwd} status={status} selected={selected} onSelect={onSelect} />
      ) : (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line p-2">
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && run('commit')}
              placeholder={files.length ? 'Commit all changes…' : 'Nothing to commit'}
              className="min-w-40 flex-1 select-text rounded-sm border border-line bg-bg px-2 py-1 font-mono text-xs outline-hidden focus:border-accent"
            />
            <button className="btn" disabled={!!busy || !message.trim() || !files.length} onClick={() => run('commit')}>
              Commit
            </button>
            <button className="btn" disabled={!!busy || !files.length} onClick={() => run('aicommit')} title="Commit all changes with a message Claude writes">
              <Sparkles className={`h-3.5 w-3.5 ${busy === 'aicommit' ? 'animate-pulse' : ''}`} />
              AI
            </button>
            <button className="btn" disabled={!!busy} onClick={() => run('pull')} title="git pull">
              <ArrowDown className={`h-3.5 w-3.5 ${busy === 'pull' ? 'animate-pulse' : ''}`} />
              {status?.behind || ''}
            </button>
            <button className="btn" disabled={!!busy} onClick={() => run('push')} title="git push">
              <ArrowUp className={`h-3.5 w-3.5 ${busy === 'push' ? 'animate-pulse' : ''}`} />
              {status?.ahead || ''}
            </button>
            <button className="btn" disabled={!!busy} onClick={() => run('sync')} title="git pull --rebase --autostash && git push">
              <RefreshCw className={`h-3.5 w-3.5 ${busy === 'sync' ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div tabIndex={-1} onKeyDown={onListKey} className="min-h-0 flex-1 overflow-y-auto py-1 outline-hidden">
            {files.map((f) => (
              <FileRow key={f.path} file={f} selected={picked === f.path} onClick={() => onSelect(f)} onContextMenu={(e) => onRowMenu(e, f)} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

interface FileRowProps {
  file: ChangedFile
  selected: boolean
  indent?: boolean
  onClick: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}

export function FileRow({ file: f, selected, indent, onClick, onContextMenu }: FileRowProps): React.JSX.Element {
  const slash = f.path.lastIndexOf('/')
  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={f.from ? `${f.from} → ${f.path}` : f.path}
      className={`flex w-full items-center gap-2 py-1 pr-3 text-left font-mono text-xs outline-hidden ${indent ? 'pl-8' : 'pl-3'} ${
        selected ? 'bg-hover' : 'hover:bg-hover'
      }`}
    >
      <span className={`w-3 shrink-0 font-bold ${CODE_COLOR[f.code]}`}>{f.code === '?' ? 'U' : f.code}</span>
      <span className="truncate">
        {f.path.slice(slash + 1)}
        {slash > 0 && <span className="ml-2 text-muted">{f.path.slice(0, slash)}</span>}
      </span>
    </button>
  )
}

type BulkOp = 'aicommit' | 'sync'

// Commit / sync every open project at once, as a sanity check before walking away.
// Each repo gets its own message, written by claude.
function AllRepos({ projects, onChanged }: { projects: string[]; onChanged: () => void }): React.JSX.Element {
  const [busy, setBusy] = useState<BulkOp | null>(null)

  const run = async (op: BulkOp): Promise<void> => {
    if (busy) return
    setBusy(op)
    await saveAll()
    const statuses = await Promise.all(projects.map((path) => window.api.status(path).catch(() => null)))
    // Several tabs can live in one repo, so run once per repo root.
    const roots = new Set<string>()
    for (const s of statuses) if (s?.root && (op === 'sync' || s.files.length)) roots.add(s.root)
    const results = await Promise.all([...roots].map(async (root) => ({ root, ...(await window.api.git(root, op)) })))
    // One toast per repo for commits, so every message can be read; a sync just reports the count.
    if (!results.length) toast(true, 'All repos', op === 'sync' ? 'No repos' : 'Nothing to commit')
    else if (op === 'aicommit') for (const r of results) toast(r.ok, projectName(r.root), r.output)
    else {
      for (const r of results) if (!r.ok) toast(false, projectName(r.root), r.output)
      const ok = results.filter((r) => r.ok).length
      if (ok) toast(true, 'All repos', `Synced ${ok} repo${ok === 1 ? '' : 's'}`)
    }
    setBusy(null)
    onChanged()
  }

  return (
    <>
      <button
        className="btn shrink-0 px-1.5 text-accent"
        disabled={!!busy}
        onClick={() => run('aicommit')}
        title="Commit all open repos with changes, each with a message Claude writes"
      >
        <Sparkles className={`h-3.5 w-3.5 ${busy === 'aicommit' ? 'animate-pulse' : ''}`} />
      </button>
      <button
        className="btn shrink-0 px-1.5 text-accent"
        disabled={!!busy}
        onClick={() => run('sync')}
        title="Sync all open repos: git pull --rebase --autostash && git push"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${busy === 'sync' ? 'animate-spin' : ''}`} />
      </button>
    </>
  )
}
