import { useEffect, useMemo, useReducer, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ChangedFile, GitStatus } from '../../../shared/types'
import { saveAll } from './CodePane'
import { contextMenu } from './ContextMenu'
import { PATH_DRAG } from './Terminal'

interface Props {
  status: GitStatus | null
  selected: string | null
  tick: number // bumps on any file system change in the project
  newFile: number // bumps on ⌘N
  onSelect: (file: ChangedFile) => void
}

interface Dir {
  dirs: Map<string, Dir>
  files: string[] // full repo-relative paths
}

interface Row {
  path: string
  name: string
  depth: number
  dir: boolean
}

export const CODE_COLOR: Record<ChangedFile['code'], string> = {
  M: 'text-mod',
  A: 'text-add',
  D: 'text-del',
  R: 'text-new',
  '?': 'text-add'
}

function build(paths: string[]): Dir {
  const root: Dir = { dirs: new Map(), files: [] }
  for (const p of paths) {
    const segs = p.split('/')
    let d = root
    for (const s of segs.slice(0, -1)) {
      let next = d.dirs.get(s)
      if (!next) d.dirs.set(s, (next = { dirs: new Map(), files: [] }))
      d = next
    }
    // git lists a nested repo as its directory ('vendor/lib/'), not as a file.
    if (segs[segs.length - 1]) d.files.push(p)
  }
  return root
}

const byName = (a: string, b: string): number => a.localeCompare(b, undefined, { sensitivity: 'base' })

// Only expanded directories are walked, so huge repos stay cheap to render.
function flatten(d: Dir, open: Set<string>, prefix = '', depth = 0, out: Row[] = []): Row[] {
  for (const name of [...d.dirs.keys()].sort(byName)) {
    const path = prefix + name
    out.push({ path, name, depth, dir: true })
    if (open.has(path)) flatten(d.dirs.get(name)!, open, path + '/', depth + 1, out)
  }
  for (const path of [...d.files].sort(byName)) {
    out.push({ path, name: path.slice(path.lastIndexOf('/') + 1), depth, dir: false })
  }
  return out
}

// Expanded directories and listed files per repo, kept across tab switches so the tree
// paints at once and refreshes behind.
const expandedByRoot = new Map<string, Set<string>>()
const listedByRoot = new Map<string, string[]>()
const NONE: string[] = []

// The inline name field: a new file inside `dir` ('' = repo root), or renaming `path`.
type Editing = { kind: 'new'; dir: string; depth: number } | { kind: 'rename'; path: string }

const parentOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')))
const join = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name)

const same = (a: string[] | undefined, b: string[]): boolean => a?.length === b.length && a.every((p, i) => p === b[i])

export default function FileTree({ status, selected, tick, newFile, onSelect }: Props): React.JSX.Element {
  const root = status?.root ?? ''
  const paths = listedByRoot.get(root) ?? NONE
  const [, relisted] = useReducer((n: number) => n + 1, 0)
  const [open, setOpen] = useState<Set<string>>(() => expandedByRoot.get(root) ?? new Set())
  // Keyboard cursor: follows the open file, but can also rest on a directory.
  const [cursor, setCursor] = useState<string | null>(selected)
  const [editing, setEditing] = useState<Editing | null>(null)

  useEffect(() => setCursor(selected), [selected])

  useEffect(() => setOpen(expandedByRoot.get(root) ?? new Set()), [root])

  useEffect(() => {
    if (!root) return
    let live = true
    window.api.files(root).then(
      (ps) => {
        // An unchanged listing keeps its identity, so saving a file doesn't rebuild the tree.
        if (same(listedByRoot.get(root), ps)) return
        listedByRoot.set(root, ps)
        if (live) relisted()
      },
      () => {}
    )
    return () => {
      live = false
    }
  }, [root, tick])

  const changed = useMemo(() => new Map((status?.files ?? []).map((f) => [f.path, f])), [status])
  // By value: most status refreshes change no paths, only codes.
  const changedPaths = (status?.files ?? []).map((f) => f.path).join('\0')

  // Directories holding a change, so collapsed folders still point the way.
  const dirty = useMemo(() => {
    const s = new Set<string>()
    for (const p of changed.keys()) {
      for (let i = p.indexOf('/'); i > 0; i = p.indexOf('/', i + 1)) s.add(p.slice(0, i))
    }
    return s
  }, [changed])

  // `git rm`'d files leave ls-files but should still be visible.
  const tree = useMemo(
    () => build(changedPaths ? [...new Set([...paths, ...changedPaths.split('\0')])] : paths),
    [paths, changedPaths]
  )
  const rows = useMemo(() => flatten(tree, open), [tree, open])

  const toggle = (path: string): void => {
    const next = new Set(open)
    if (!next.delete(path)) next.add(path)
    expandedByRoot.set(root, next)
    setOpen(next)
  }

  // Opens every directory above path, keeping whatever was already open.
  const expandTo = (path: string, base = open): void => {
    const next = new Set(base)
    for (let d = parentOf(path); d; d = parentOf(d)) next.add(d)
    expandedByRoot.set(root, next)
    setOpen(next)
  }

  const fresh = (path: string): ChangedFile => ({ path, code: '?' })

  // Throws on failure, so the name field stays open showing the error.
  const commitName = async (e: Editing, name: string): Promise<void> => {
    if (e.kind === 'new') {
      const path = join(e.dir, name)
      await window.api.createFile(`${root}/${path}`)
      expandTo(path)
      setCursor(path)
      onSelect(fresh(path))
      return
    }
    const from = e.path
    const to = join(parentOf(from), name)
    if (to === from) return
    // Unsaved edits would otherwise be saved to the old path later.
    await saveAll()
    await window.api.rename(`${root}/${from}`, `${root}/${to}`)
    const moved = (p: string): string | null =>
      p === from ? to : p.startsWith(from + '/') ? to + p.slice(from.length) : null
    expandTo(to, new Set([...open].map((p) => moved(p) ?? p)))
    setCursor(to)
    const sel = selected && moved(selected)
    if (sel) onSelect(fresh(sel))
  }

  const trash = async (path: string): Promise<void> => {
    await saveAll()
    await window.api.trash(`${root}/${path}`).catch(() => {})
  }

  const newIn = (dir: string, depth: number): void => {
    if (dir && !open.has(dir)) toggle(dir)
    setEditing({ kind: 'new', dir, depth })
  }

  // ⌘N: inside the folder under the cursor, else beside the cursor's file. The cursor's file
  // can sit in a collapsed folder, so open the whole way down to it.
  useEffect(() => {
    if (!newFile || !root) return
    const dir = cursor && rows.find((r) => r.path === cursor)?.dir ? cursor : parentOf(cursor ?? '')
    if (dir) expandTo(join(dir, ''))
    setEditing({ kind: 'new', dir, depth: dir ? dir.split('/').length : 0 })
  }, [newFile])

  const onRowMenu = async (e: React.MouseEvent, r: Row): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    setCursor(r.path)
    const i = await contextMenu(['New File…', '-', 'Rename…', 'Move to Trash', '-', 'Reveal in Finder', 'Copy Path', 'Copy Relative Path'])
    if (i === 0) r.dir ? newIn(r.path, r.depth + 1) : newIn(parentOf(r.path), r.depth)
    else if (i === 2) setEditing({ kind: 'rename', path: r.path })
    else if (i === 3) trash(r.path)
    else if (i === 5) window.api.reveal(`${root}/${r.path}`)
    else if (i === 6) navigator.clipboard.writeText(`${root}/${r.path}`)
    else if (i === 7) navigator.clipboard.writeText(r.path)
  }

  const onTreeMenu = async (e: React.MouseEvent): Promise<void> => {
    e.preventDefault()
    if ((await contextMenu(['New File…'])) === 0) newIn('', 0)
  }

  const pick = (r: Row): void => {
    setCursor(r.path)
    if (r.dir) toggle(r.path)
    else onSelect(changed.get(r.path) ?? { path: r.path, code: 'M' })
  }

  // Up/Down walk the visible rows (opening files as they go); Right expands or
  // steps into a directory, Left collapses or jumps to the parent.
  // Finder's keys: Return renames, ⌘⌫ moves to the Trash.
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (cursor && rows.some((r) => r.path === cursor)) {
      if (e.key === 'Enter') {
        e.preventDefault()
        return setEditing({ kind: 'rename', path: cursor })
      }
      if (e.key === 'Backspace' && e.metaKey) {
        e.preventDefault()
        return void trash(cursor)
      }
    }
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return
    e.preventDefault()
    if (!rows.length) return
    const i = rows.findIndex((r) => r.path === cursor)
    const r = rows[i]
    let next = i
    if (i < 0) next = 0
    else if (e.key === 'ArrowDown') next = Math.min(rows.length - 1, i + 1)
    else if (e.key === 'ArrowUp') next = Math.max(0, i - 1)
    else if (e.key === 'ArrowRight') {
      if (!r.dir) return
      if (!open.has(r.path)) return toggle(r.path)
      next = Math.min(rows.length - 1, i + 1)
    } else {
      if (r.dir && open.has(r.path)) return toggle(r.path)
      const parent = parentOf(r.path)
      if (!parent) return
      next = rows.findIndex((x) => x.path === parent)
    }
    if (next === i) return
    const target = rows[next]
    setCursor(target.path)
    if (!target.dir) onSelect(changed.get(target.path) ?? { path: target.path, code: 'M' })
    const row = e.currentTarget.children[next] as HTMLElement | undefined
    row?.focus()
    row?.scrollIntoView({ block: 'nearest' })
  }

  if (!root) {
    return <div className="flex h-full items-center justify-center bg-panel text-xs text-muted">No files</div>
  }

  return (
    <div
      tabIndex={-1}
      onKeyDown={onKey}
      onContextMenu={onTreeMenu}
      className="h-full overflow-y-auto bg-panel py-1 outline-hidden"
    >
      {editing?.kind === 'new' && !editing.dir && newField(0)}
      {rows.map((r) => {
        const after = editing?.kind === 'new' && editing.dir === r.path && newField(editing.depth)
        if (editing?.kind === 'rename' && editing.path === r.path) {
          return (
            <NameField
              key={r.path}
              depth={r.depth}
              initial={r.name}
              onCommit={(name) => commitName(editing, name)}
              onDone={() => setEditing(null)}
            />
          )
        }
        const f = changed.get(r.path)
        const color = r.dir ? (dirty.has(r.path) ? 'text-mod' : '') : f ? CODE_COLOR[f.code] : ''
        const Chevron = open.has(r.path) ? ChevronDown : ChevronRight
        const row = (
          <button
            key={r.path}
            onClick={() => pick(r)}
            onDoubleClick={() => !r.dir && setEditing({ kind: 'rename', path: r.path })}
            onContextMenu={(e) => onRowMenu(e, r)}
            draggable
            onDragStart={(e) => e.dataTransfer.setData(PATH_DRAG, `${root}/${r.path}`)}
            title={r.path}
            style={{ paddingLeft: 8 + r.depth * 12 }}
            className={`flex w-full items-center gap-1 py-0.5 pr-2 text-left font-mono text-xs outline-hidden ${
              cursor === r.path ? 'bg-hover' : 'hover:bg-hover'
            }`}
          >
            {r.dir ? <Chevron className="h-3 w-3 shrink-0 text-muted" /> : <span className="w-3 shrink-0" />}
            <span className={`truncate ${color} ${f?.code === 'D' ? 'line-through' : ''}`}>{r.name}</span>
            {f && <span className={`ml-auto shrink-0 pl-1 font-bold ${CODE_COLOR[f.code]}`}>{f.code === '?' ? 'U' : f.code}</span>}
          </button>
        )
        return after ? [row, after] : row
      })}
    </div>
  )

  function newField(depth: number): React.JSX.Element {
    const e = editing!
    return <NameField key="\0new" depth={depth} initial="" onCommit={(name) => commitName(e, name)} onDone={() => setEditing(null)} />
  }
}

interface NameFieldProps {
  depth: number
  initial: string
  onCommit: (name: string) => Promise<void>
  onDone: () => void
}

// Return commits, Escape or clicking away cancels. A failed commit keeps the field open with the error.
function NameField({ depth, initial, onCommit, onDone }: NameFieldProps): React.JSX.Element {
  const [error, setError] = useState('')
  const submit = async (name: string): Promise<void> => {
    if (!name || name === initial) return onDone()
    try {
      await onCommit(name)
      onDone()
    } catch (err) {
      setError(String(err).replace(/^.*Error: /, ''))
    }
  }
  return (
    <div style={{ paddingLeft: 8 + depth * 12 }} className="flex items-center gap-1 py-0.5 pr-2">
      <span className="w-3 shrink-0" />
      <input
        autoFocus
        defaultValue={initial}
        title={error}
        spellCheck={false}
        // Select the name without its extension, as Finder does.
        onFocus={(e) => e.currentTarget.setSelectionRange(0, initial.lastIndexOf('.') > 0 ? initial.lastIndexOf('.') : initial.length)}
        onChange={() => setError('')}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit(e.currentTarget.value.trim())
          else if (e.key === 'Escape') onDone()
        }}
        // Only a click elsewhere in the window cancels, not a closing menu or switching apps.
        onBlur={() => document.hasFocus() && onDone()}
        className={`min-w-0 flex-1 select-text rounded border bg-bg px-1 font-mono text-xs outline-hidden ${
          error ? 'border-del' : 'border-accent'
        }`}
      />
    </div>
  )
}
