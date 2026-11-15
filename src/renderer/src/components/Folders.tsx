import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, ChevronLeft, ChevronRight, Folder, FolderOpen, Plus, RefreshCw } from 'lucide-react'
import type { BrowseEntry } from '../../../shared/types'
import { contextMenu } from './ContextMenu'

interface Props {
  // Saved folders, kept in settings.
  dirs: string[]
  // In front: the listing refreshes each time it's shown (no watcher outside projects).
  shown: boolean
  onDirs: (dirs: string[]) => void
}

type Sort = 'new' | 'name'

const VIDEO = /\.(webm|mp4|mov)$/i

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1) || path
const mediaUrl = (path: string, mtime: number): string => `media://local/?path=${encodeURIComponent(path)}&v=${mtime}`

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// Full-window folder browser for looking at images and videos.
export default function Folders({ dirs, shown, onDirs }: Props): React.JSX.Element {
  const [root, setRoot] = useState<string | null>(dirs[0] ?? null)
  const [path, setPath] = useState<string | null>(dirs[0] ?? null)
  // Tagged with the folder they're from: until the next one loads, the old names would be
  // shown under the new path, as broken tiles.
  const [listing, setListing] = useState<{ path: string; entries: BrowseEntry[] } | null>(null)
  const entries = useMemo(() => (listing && listing.path === path ? listing.entries : []), [listing, path])
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState<Sort>('new')
  const [size, setSize] = useState(220)
  const [viewing, setViewing] = useState<string | null>(null)
  const [reloads, setReloads] = useState(0)
  const box = useRef<HTMLDivElement>(null)

  // A removed (or first added) folder moves the view to one that's still listed.
  useEffect(() => {
    if (root && dirs.includes(root)) return
    setRoot(dirs[0] ?? null)
    setPath(dirs[0] ?? null)
  }, [dirs, root])

  useEffect(() => {
    if (shown) box.current?.focus()
  }, [shown])

  useEffect(() => {
    if (!shown || !path) return
    let stale = false
    window.api.browse(path).then(
      (list) => {
        if (stale) return
        setListing({ path, entries: list })
        setError(null)
      },
      () => {
        if (stale) return
        setListing({ path, entries: [] })
        setError('Folder not found')
      }
    )
    return () => {
      stale = true
    }
  }, [shown, path, reloads])

  const folders = useMemo(
    () => entries.filter((e) => e.dir).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    [entries]
  )
  const media = useMemo(
    () =>
      entries
        .filter((e) => !e.dir)
        .sort((a, b) => (sort === 'new' ? b.mtime - a.mtime : a.name.localeCompare(b.name, undefined, { numeric: true }))),
    [entries, sort]
  )
  const index = viewing === null ? -1 : media.findIndex((e) => e.name === viewing)
  const current = index >= 0 ? media[index] : null

  const go = (dir: string): void => {
    setPath(dir)
    setViewing(null)
  }
  const step = (by: number): void => {
    if (!media.length || index < 0) return
    setViewing(media[(index + by + media.length) % media.length].name)
  }

  const add = async (): Promise<void> => {
    const dir = await window.api.pickFolder()
    if (!dir) return
    if (!dirs.includes(dir)) onDirs([...dirs, dir])
    setRoot(dir)
    go(dir)
  }

  const fileMenu = async (file: string): Promise<void> => {
    const pick = await contextMenu(['Reveal in Finder', 'Copy Path'])
    if (pick === 0) window.api.reveal(file)
    else if (pick === 1) navigator.clipboard.writeText(file)
  }

  // Crumbs from the saved folder down to here.
  const crumbs: { name: string; path: string }[] = []
  if (root && path) {
    crumbs.push({ name: baseName(root), path: root })
    const rest = path.slice(root.length).split('/').filter(Boolean)
    rest.forEach((name, i) => crumbs.push({ name, path: `${root}/${rest.slice(0, i + 1).join('/')}` }))
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (current) {
      if (e.key === 'ArrowLeft') step(-1)
      else if (e.key === 'ArrowRight') step(1)
      else if (e.key === 'Escape') setViewing(null)
      else if (e.key === ' ' && !(e.target instanceof HTMLVideoElement)) {
        const video = box.current?.querySelector<HTMLVideoElement>('[data-viewer] video')
        if (video) video.paused ? video.play().catch(() => {}) : video.pause()
      } else return
      e.preventDefault()
    } else if (e.key === 'Backspace' && root && path && path !== root) {
      e.preventDefault()
      go(path.slice(0, path.lastIndexOf('/')))
    }
  }

  return (
    <div ref={box} tabIndex={-1} onKeyDown={onKeyDown} className="flex h-full bg-bg outline-hidden">
      <aside className="flex w-52 shrink-0 flex-col border-r border-line bg-panel">
        <div className="flex h-8 shrink-0 items-center justify-between border-b border-line px-3 text-xs text-muted">
          <span>Folders</span>
          <button className="btn text-muted" onClick={add} title="Add folder">
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {dirs.map((dir) => (
            <button
              key={dir}
              onClick={() => {
                setRoot(dir)
                go(dir)
              }}
              onContextMenu={async (e) => {
                e.preventDefault()
                const pick = await contextMenu(['Reveal in Finder', '-', 'Remove'])
                if (pick === 0) window.api.reveal(dir)
                else if (pick === 2) onDirs(dirs.filter((d) => d !== dir))
              }}
              title={dir}
              className={`flex w-full items-center gap-2 px-3 py-1 text-left text-xs ${
                dir === root ? 'bg-hover text-fg' : 'text-muted hover:bg-hover'
              }`}
            >
              <Folder className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{baseName(dir)}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-panel px-3 text-xs text-muted">
          <button
            className="btn text-muted disabled:opacity-40"
            disabled={!root || path === root}
            onClick={() => path && go(path.slice(0, path.lastIndexOf('/')))}
            title="Up  ⌫"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <div className="flex min-w-0 items-center gap-1 overflow-hidden font-mono">
            {crumbs.map((c, i) => (
              <span key={c.path} className="flex shrink-0 items-center gap-1">
                {i > 0 && <span>/</span>}
                <button className={`hover:text-fg ${i === crumbs.length - 1 ? 'text-fg' : ''}`} onClick={() => go(c.path)}>
                  {c.name}
                </button>
              </span>
            ))}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-3">
            <span>{media.length} files</span>
            <button className="hover:text-fg" onClick={() => setSort((s) => (s === 'new' ? 'name' : 'new'))} title="Sort order">
              {sort === 'new' ? 'newest' : 'name'}
            </button>
            <input
              type="range"
              min={100}
              max={480}
              step={20}
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
              title="Thumbnail size"
              className="w-24 accent-(--accent)"
            />
            <button className="btn text-muted" onClick={() => setReloads((n) => n + 1)} title="Reload">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {!dirs.length ? (
          <div className="flex flex-1 items-center justify-center">
            <button className="btn text-muted" onClick={add}>
              <FolderOpen className="h-4 w-4" /> Add a folder
            </button>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {error && <p className="text-xs text-del">{error}</p>}
            {folders.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {folders.map((f) => (
                  <button
                    key={f.name}
                    onClick={() => path && go(`${path}/${f.name}`)}
                    className="flex items-center gap-1.5 rounded-sm border border-line bg-panel px-2 py-1 text-xs text-muted hover:bg-hover hover:text-fg"
                  >
                    <Folder className="h-3.5 w-3.5" />
                    {f.name}
                  </button>
                ))}
              </div>
            )}
            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size}px, 1fr))` }}>
              {path &&
                media.map((m) => (
                  <Tile
                    key={m.name}
                    entry={m}
                    src={mediaUrl(`${path}/${m.name}`, m.mtime)}
                    onOpen={() => setViewing(m.name)}
                    onMenu={() => fileMenu(`${path}/${m.name}`)}
                  />
                ))}
            </div>
          </div>
        )}

        {/* Over the grid rather than instead of it, so closing returns to the same scroll spot. */}
        {current && path && (
          <Viewer
            entry={current}
            src={mediaUrl(`${path}/${current.name}`, current.mtime)}
            position={`${index + 1} / ${media.length}`}
            onStep={step}
            onClose={() => setViewing(null)}
            onMenu={() => fileMenu(`${path}/${current.name}`)}
          />
        )}
      </section>
    </div>
  )
}

interface TileProps {
  entry: BrowseEntry
  src: string
  onOpen: () => void
  onMenu: () => void
}

function Tile({ entry, src, onOpen, onMenu }: TileProps): React.JSX.Element {
  const video = VIDEO.test(entry.name)
  const ref = useRef<HTMLButtonElement>(null)
  // <video> has no loading="lazy": attach its source only once the tile scrolls near view,
  // or a big folder opens every clip at once.
  const [near, setNear] = useState(!video)
  useEffect(() => {
    if (near || !ref.current) return
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: '400px' })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [near])

  return (
    <button
      ref={ref}
      onClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu()
      }}
      title={entry.name}
      className="group flex min-w-0 flex-col gap-1 rounded-sm p-1 text-left hover:bg-hover"
    >
      <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-sm bg-panel">
        {video ? (
          near && (
            <video
              src={src}
              preload="metadata"
              muted
              loop
              playsInline
              onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
              onMouseLeave={(e) => e.currentTarget.pause()}
              className="max-h-full max-w-full object-contain"
            />
          )
        ) : (
          <img src={src} loading="lazy" decoding="async" draggable={false} className="max-h-full max-w-full object-contain" />
        )}
      </div>
      <span className="w-full truncate px-0.5 font-mono text-[0.7rem] text-muted group-hover:text-fg">{entry.name}</span>
    </button>
  )
}

interface ViewerProps {
  entry: BrowseEntry
  src: string
  position: string
  onStep: (by: number) => void
  onClose: () => void
  onMenu: () => void
}

function Viewer({ entry, src, position, onStep, onClose, onMenu }: ViewerProps): React.JSX.Element {
  const video = VIDEO.test(entry.name)
  const [dims, setDims] = useState('')
  useEffect(() => setDims(''), [src])

  return (
    <div data-viewer className="absolute inset-0 z-10 flex flex-col bg-bg">
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center p-4"
        onClick={(e) => e.target === e.currentTarget && onClose()}
        onContextMenu={(e) => {
          e.preventDefault()
          onMenu()
        }}
      >
        {video ? (
          <video
            key={src}
            src={src}
            controls
            autoPlay
            loop
            playsInline
            onLoadedMetadata={(e) => setDims(`${e.currentTarget.videoWidth}×${e.currentTarget.videoHeight}`)}
            className="max-h-full max-w-full"
          />
        ) : (
          <img
            src={src}
            draggable={false}
            onClick={onClose}
            onLoad={(e) => setDims(`${e.currentTarget.naturalWidth}×${e.currentTarget.naturalHeight}`)}
            className="max-h-full max-w-full object-contain"
          />
        )}
        <button
          onClick={() => onStep(-1)}
          className="absolute left-2 top-1/2 -translate-y-1/2 rounded-sm p-2 text-muted hover:bg-hover hover:text-fg"
          title="Previous  ←"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        <button
          onClick={() => onStep(1)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-2 text-muted hover:bg-hover hover:text-fg"
          title="Next  →"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      </div>
      <div className="flex h-7 shrink-0 items-center gap-3 border-t border-line bg-panel px-3 font-mono text-xs text-muted">
        <span className="truncate text-fg">{entry.name}</span>
        <span className="ml-auto shrink-0">{dims}</span>
        <span className="shrink-0">{formatSize(entry.size)}</span>
        <span className="shrink-0">{position}</span>
        <span className="shrink-0">esc</span>
      </div>
    </div>
  )
}
