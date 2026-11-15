import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ChangedFile, FileSnapshot, Theme } from '../../../shared/types'
import { monaco, setMonacoTheme } from '../monaco'
import { addEditor } from '../plugins'
import { MONO } from '../theme'
import MediaPane from './MediaPane'

type Model = monaco.editor.ITextModel

interface Props {
  root: string
  file: ChangedFile | null
  theme: Theme
  tick: number // bumps on any file system change in the project
  reveal: Reveal | null
  onSaved: () => void
  onClose: () => void
  onOpen: (abs: string, line: number) => void // a definition (from a plugin) in another file
}

// A search hit to select once its file is shown. n makes repeat clicks re-reveal.
export interface Reveal {
  path: string
  line: number
  col: number
  len: number
  n: number
}

// Version each working-tree model was last loaded from or saved to disk at.
const savedAt = new Map<string, number>()
const markSaved = (m: Model): void => void savedAt.set(m.uri.toString(), m.getAlternativeVersionId())
const isDirty = (m: Model): boolean => savedAt.get(m.uri.toString()) !== m.getAlternativeVersionId()

// One write per file at a time: a commit's saveAll during a ⌘S write would otherwise start a
// second writeFile to the same path, and the two can land interleaved.
const writing = new Map<string, Promise<boolean>>()

// Bumped as each write starts and ends. A snapshot read from disk while the count was
// different may predate the write, and loading it would put the old text back; the
// watcher sends a fresh one once the write lands.
const writes = new Map<string, number>()
const bump = (key: string): void => void writes.set(key, (writes.get(key) ?? 0) + 1)

function saveModel(m: Model): Promise<boolean> {
  const key = m.uri.toString()
  const next = (writing.get(key) ?? Promise.resolve(false)).then(() => writeModel(m))
  writing.set(key, next)
  void next.finally(() => writing.get(key) === next && writing.delete(key))
  return next
}

async function writeModel(m: Model): Promise<boolean> {
  const key = m.uri.toString()
  // Only working-tree models (file://) are saved; a commit's (rev://) are read-only.
  if (m.isDisposed() || m.uri.scheme !== 'file' || !isDirty(m)) return false
  const version = m.getAlternativeVersionId()
  bump(key)
  try {
    await window.api.writeFile(m.uri.fsPath, m.getValue())
  } catch {
    // Stays dirty (●) for the next ⌘S to retry; throwing would wedge saveAll's callers.
    return false
  } finally {
    bump(key)
  }
  savedAt.set(key, version)
  // A file left with unsaved edits kept its models until now; once saved, nothing needs them.
  if (!m.isAttachedToEditor() && !isDirty(m)) {
    savedAt.delete(key)
    monaco.editor.getModel(m.uri.with({ scheme: 'head' }))?.dispose()
    m.dispose()
  }
  return true
}

// Writes every unsaved edit, e.g. right before a commit, so it includes what's on screen.
// Resolves to the paths it wrote.
export async function saveAll(): Promise<string[]> {
  const models = monaco.editor.getModels().filter((m) => m.uri.scheme === 'file')
  const paths = models.map((m) => m.uri.fsPath)
  const wrote = await Promise.all(models.map(saveModel))
  return paths.filter((_, i) => wrote[i])
}

// Writes a file's unsaved edits before its changes are discarded, so a later ⌘S can't put
// them back. Saved rather than dropped: the discard may be cancelled. Once it lands, the
// clean model reloads from disk.
export async function saveFile(abs: string): Promise<void> {
  const m = monaco.editor.getModel(monaco.Uri.file(abs))
  if (m) await saveModel(m)
}

// The editor in front (plain or diff), for Send Selection to Claude.
let front: () => monaco.editor.ICodeEditor | null = () => null

// The working file shown and its selected lines (1-based, inclusive; null when nothing is
// selected), or null when no working file is shown. A selection that ends at the start of a
// line doesn't take that line.
export function selection(): { abs: string; lines: [number, number] | null } | null {
  const ed = front()
  const m = ed?.getModel()
  const sel = ed?.getSelection()
  if (!m || !sel || m.uri.scheme !== 'file') return null
  if (sel.isEmpty()) return { abs: m.uri.fsPath, lines: null }
  const end = sel.endColumn === 1 && sel.endLineNumber > sel.startLineNumber ? sel.endLineNumber - 1 : sel.endLineNumber
  return { abs: m.uri.fsPath, lines: [sel.startLineNumber, end] }
}

function model(uri: monaco.Uri, text: string): Model {
  return monaco.editor.getModel(uri) ?? monaco.editor.createModel(text, undefined, uri)
}

export default function CodePane({ root, file, theme, tick, reveal, onSaved, onClose, onOpen }: Props): React.JSX.Element {
  const diffHost = useRef<HTMLDivElement>(null)
  const editHost = useRef<HTMLDivElement>(null)
  const diff = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const edit = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const shown = useRef<monaco.Uri | null>(null)
  const save = useRef<(m?: Model) => void>(() => {})
  const pending = useRef<Reveal | null>(null)
  const [snap, setSnap] = useState<(FileSnapshot & { abs: string; commit?: string; writes: number }) | null>(null)
  const [mode, setMode] = useState<'diff' | 'edit'>('diff')
  // The file you typed into from the editor. It stays there: otherwise a clean file's first
  // save turns it into a change, and the view flips to the diff and drops focus.
  const [typedIn, setTypedIn] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const openRef = useRef(onOpen)
  openRef.current = onOpen
  const viewRef = useRef<'diff' | 'edit'>('diff')

  const abs = file && root ? `${root}/${file.path}` : null
  const commit = file?.commit

  // Search hits open in the plain editor: the diff view may fold the line away.
  const applyReveal = (): void => {
    const r = pending.current
    if (!r || !abs || r.path !== file?.path || shown.current?.toString() !== monaco.Uri.file(abs).toString()) return
    pending.current = null
    const range = new monaco.Range(r.line, r.col, r.line, r.col + r.len)
    setMode('edit')
    edit.current!.setSelection(range)
    edit.current!.revealRangeInCenter(range)
  }

  useEffect(() => {
    pending.current = reveal
    applyReveal()
  }, [reveal])

  useEffect(() => {
    const common: monaco.editor.IEditorOptions = {
      fontFamily: MONO,
      fontSize: 13,
      automaticLayout: true,
      scrollBeyondLastLine: false,
      minimap: { enabled: false },
      padding: { top: 6 },
      renderWhitespace: 'selection',
      // Type into the hidden textarea, as before Monaco 0.53: pane focus (⌘⌥arrows) finds
      // the editor by it, and the native Edit menu's copy/paste is proven on it.
      editContext: false
    }
    const d = monaco.editor.createDiffEditor(diffHost.current!, {
      ...common,
      originalEditable: false,
      renderSideBySide: false,
      renderGutterMenu: false,
      hideUnchangedRegions: { enabled: true }
    })
    const e = monaco.editor.create(editHost.current!, { ...common, model: null })
    diff.current = d
    edit.current = e

    // The diff editor shares the working model, so its diff stays current while editing.
    const marks = e.createDecorationsCollection()
    d.onDidUpdateDiff(() => marks.set(changeMarks(d.getLineChanges() ?? [])))

    const cmdS = monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS
    for (const ed of [d.getModifiedEditor(), e]) {
      ed.addCommand(cmdS, () => save.current())
      ed.onDidChangeModelContent(() => {
        const m = ed.getModel()
        if (!m) return
        setDirty(isDirty(m))
      })
    }
    // Plugins hook into both editors (hover previews, ⌘-click definitions).
    const unhook = [addEditor(d.getModifiedEditor()), addEditor(e)]
    // Monaco moves within the same file itself; another file opens through the app.
    const opener = monaco.editor.registerEditorOpener({
      openCodeEditor: (_source, uri, at) => {
        if (uri.scheme !== 'file') return false
        openRef.current(uri.fsPath, at && 'lineNumber' in at ? at.lineNumber : at && 'startLineNumber' in at ? at.startLineNumber : 1)
        return true
      }
    })
    front = () => (viewRef.current === 'edit' ? e : d.getModifiedEditor())

    // Both editors hear every edit to the shared model; only count typing in this one.
    e.onDidChangeModelContent((ev) => {
      if (!ev.isFlush && e.hasTextFocus()) setTypedIn(e.getModel()?.uri.fsPath ?? null)
    })
    return () => {
      unhook.forEach((u) => u())
      opener.dispose()
      front = () => null
      d.dispose()
      e.dispose()
    }
  }, [])

  useEffect(() => setMonacoTheme(theme), [theme])

  useEffect(() => setTypedIn(null), [abs])

  useEffect(() => {
    if (!file || !abs) return setSnap(null)
    let live = true
    const at = writes.get(monaco.Uri.file(abs).toString()) ?? 0
    window.api.snapshot(root, file).then((s) => live && setSnap({ ...s, abs, commit, writes: at }))
    return () => {
      live = false
    }
    // Primitive deps: a status refresh yields new file objects for the same file.
    // A commit's files never change, so file system changes don't reload them.
  }, [root, abs, file?.code, file?.from, commit, commit ? 0 : tick])

  const ready = !!snap && snap.abs === abs && snap.commit === commit

  // Push the loaded snapshot into Monaco models without clobbering unsaved edits.
  useEffect(() => {
    if (!snap || !ready || snap.kind !== 'text') return
    const fileUri = monaco.Uri.file(snap.abs)
    const workUri = snap.commit ? fileUri.with({ scheme: 'rev', query: snap.commit }) : fileUri
    const headUri = snap.commit ? workUri.with({ query: `${snap.commit}^` }) : fileUri.with({ scheme: 'head' })
    const head = model(headUri, snap.head ?? '')
    const work = model(workUri, snap.work ?? '')
    if (!savedAt.has(work.uri.toString())) markSaved(work)

    if (head.getValue() !== (snap.head ?? '')) head.setValue(snap.head ?? '')
    const stale = !snap.commit && (writes.get(work.uri.toString()) ?? 0) !== snap.writes
    if (!stale && !isDirty(work) && work.getValue() !== (snap.work ?? '')) {
      const views = [diff.current!.saveViewState(), edit.current!.saveViewState()] as const
      work.setValue(snap.work ?? '')
      markSaved(work)
      diff.current!.restoreViewState(views[0])
      edit.current!.restoreViewState(views[1])
    }

    if (shown.current?.toString() !== workUri.toString()) {
      const prev = diff.current!.getModel()
      diff.current!.setModel({ original: head, modified: work })
      edit.current!.setModel(work)
      shown.current = workUri
      // Leaving a file saves it (its models are freed once written); a clean one is freed now.
      if (prev && isDirty(prev.modified)) void save.current(prev.modified)
      else if (prev) {
        savedAt.delete(prev.modified.uri.toString())
        prev.modified.dispose()
        prev.original.dispose()
      }
    }
    const readOnly = snap.work === null || !!snap.commit
    diff.current!.getModifiedEditor().updateOptions({ readOnly })
    edit.current!.updateOptions({ readOnly })
    setDirty(isDirty(work))
    applyReveal()
  }, [snap, ready])

  save.current = async (m = edit.current?.getModel() ?? undefined) => {
    if (!m || !(await saveModel(m))) return
    if (m === edit.current?.getModel()) setDirty(isDirty(m))
    onSaved()
  }

  const text = ready && snap.kind === 'text'
  // A file opened from the tree with no changes has nothing to diff.
  // While the next file loads, keep showing the last one if it was the same kind, so switching never flashes.
  // Monaco forces visibility: visible inside itself, so a hidden editor also needs opacity-0, or it shows through.
  const showText = snap?.kind === 'text'
  const clean = showText && snap.head === snap.work
  const view = clean || typedIn === abs ? 'edit' : mode
  viewRef.current = view
  const hide = 'invisible opacity-0 pointer-events-none'

  return (
    <div className="flex h-full flex-col">
      {file && (
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-panel px-3 text-xs">
          <span className="truncate font-mono" title={file.path}>
            {file.path}
          </span>
          {commit && (
            <span className="font-mono text-muted" title={commit}>
              @ {commit.slice(0, 7)}
            </span>
          )}
          {file.code === 'D' && <span className="text-del">deleted</span>}
          {dirty && <span className="text-accent" title="Unsaved: saves on ⌘S, a prompt, leaving the file, or quitting">●</span>}
          <div className="ml-auto flex items-center gap-2">
            {text && !clean && (
              <div className="flex rounded-sm border border-line">
                {(['diff', 'edit'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => {
                      setMode(m)
                      setTypedIn(null)
                    }}
                    className={`px-2 py-0.5 capitalize ${view === m ? 'bg-hover text-fg' : 'text-muted'}`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
            <button className="rounded-sm text-muted hover:text-fg" onClick={onClose} title="Close file  ⇧⌘W">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <div ref={diffHost} className={`absolute inset-0 ${showText && view === 'diff' ? '' : hide}`} />
        <div ref={editHost} className={`absolute inset-0 ${showText && view === 'edit' ? '' : hide}`} />
        {!file && <Placeholder>Select a file</Placeholder>}
        {ready && snap.kind === 'binary' && <Placeholder>Binary or oversized file</Placeholder>}
        {file && (snap?.kind === 'image' || snap?.kind === 'video') && (
          <MediaPane snap={snap} labels={commit ? ['Parent', commit.slice(0, 7)] : undefined} />
        )}
      </div>
    </div>
  )
}

function changeMarks(changes: monaco.editor.ILineChange[]): monaco.editor.IModelDeltaDecoration[] {
  const ruler = (id: string): monaco.editor.IModelDecorationOverviewRulerOptions => ({
    color: { id },
    position: monaco.editor.OverviewRulerLane.Left
  })
  return changes.map((c) => {
    // modifiedEndLineNumber 0 = lines removed after modifiedStartLineNumber.
    if (c.modifiedEndLineNumber === 0) {
      const line = Math.max(1, c.modifiedStartLineNumber)
      return {
        range: new monaco.Range(line, 1, line, 1),
        options: { linesDecorationsClassName: 'gutter-del', overviewRuler: ruler('editorGutter.deletedBackground') }
      }
    }
    const added = c.originalEndLineNumber === 0
    return {
      range: new monaco.Range(c.modifiedStartLineNumber, 1, c.modifiedEndLineNumber, 1),
      options: {
        isWholeLine: true,
        className: added ? 'line-add' : 'line-mod',
        linesDecorationsClassName: added ? 'gutter-add' : 'gutter-mod',
        overviewRuler: ruler(added ? 'editorGutter.addedBackground' : 'editorGutter.modifiedBackground')
      }
    }
  })
}

function Placeholder({ children }: { children: string }): React.JSX.Element {
  return <div className="absolute inset-0 flex items-center justify-center bg-bg text-xs text-muted">{children}</div>
}
