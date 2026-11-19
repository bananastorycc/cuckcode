import { useEffect, useRef } from 'react'
import { Archive, BookOpen, ChevronDown, FolderOpen, Globe, Plus, Settings, Shapes, X } from 'lucide-react'
import type { PlaygroundSlot, WebPage } from '../../../shared/types'
import { TITLES, type Section } from '../layout'
import { contextMenu } from './ContextMenu'

interface Props {
  // The tab bar's projects; the shelved ones are open too, just kept off it.
  projects: string[]
  shelved: string[]
  active: string | null
  done: Set<string>
  // Selecting a shelved project puts it back on the bar.
  onSelect: (path: string) => void
  onClose: (path: string) => void
  onShelve: (path: string) => void
  onMove: (from: number, to: number) => void
  onOpen: () => void
  playgrounds: PlaygroundSlot[]
  // The slot shown, if any (from 1).
  playing: number | null
  // Slots the agent changed since they were last opened.
  playUnseen: (slot: number) => boolean
  onPlay: (slot: number) => void
  readme: boolean
  reading: boolean
  onReadme: () => void
  // Plugins' views the project has, and the one shown, if any.
  pluginViews: { id: string; title: string; icon: React.ReactNode; shortcut: string }[]
  pluginView: string | null
  onPluginView: (id: string) => void
  webPages: WebPage[]
  // Which web page is shown, if any.
  showingWeb: number | null
  onWeb: (i: number) => void
  folders: boolean
  browsing: boolean
  onFolders: () => void
  configuring: boolean
  onSettings: () => void
  // Sections minimized from the dock, each a button that brings it back.
  minimized: Section[]
  onRestore: (s: Section) => void
}

const on = 'bg-bg text-fg shadow-xs ring-1 ring-line'
const off = 'text-muted hover:bg-hover'
// Shortcut digits: 1–9, then 0 for the tenth.
const digit = (i: number): string => String((i + 1) % 10)

export const projectName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

export const tildify = (path: string): string => path.replace(/^\/Users\/[^/]+/, '~')

export default function Header(p: Props): React.JSX.Element {
  const dragging = useRef<number | null>(null)
  const strip = useRef<HTMLDivElement>(null)
  // Keep the active tab in view when ⌘<n> or ⇧⌘[ / ] switches to one scrolled off the strip.
  useEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>('[data-active]')
    if (!strip.current || !el) return
    const s = strip.current
    if (el.offsetLeft < s.scrollLeft) s.scrollLeft = el.offsetLeft
    else if (el.offsetLeft + el.offsetWidth > s.scrollLeft + s.clientWidth) s.scrollLeft = el.offsetLeft + el.offsetWidth - s.clientWidth
  }, [p.active, p.projects])
  return (
    <header className="drag flex h-8 shrink-0 items-center gap-1 border-b border-line bg-panel pl-[78px] pr-2">
      <div ref={strip} className="no-drag no-scrollbar relative flex min-w-0 items-center gap-1 overflow-x-auto p-px">
        {p.projects.map((path, i) => (
          <div
            key={path}
            draggable
            onDragStart={(e) => {
              dragging.current = i
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragEnd={() => (dragging.current = null)}
            onDragOver={(e) => {
              const from = dragging.current
              if (from === null) return
              e.preventDefault()
              if (from === i) return
              // Swap only once past the target's midpoint, or a wide tab swaps straight back.
              const r = e.currentTarget.getBoundingClientRect()
              const past = from < i ? e.clientX > r.left + r.width / 2 : e.clientX < r.left + r.width / 2
              if (!past) return
              p.onMove(from, i)
              dragging.current = i
            }}
            onClick={() => p.onSelect(path)}
            onContextMenu={async (e) => {
              e.preventDefault()
              // The last tab stays: an empty bar would leave no project in front.
              const items = p.projects.length > 1 ? ['Move to Shelf', 'Close'] : ['Close']
              const i = await contextMenu(items)
              if (i !== null && items[i] === 'Move to Shelf') p.onShelve(path)
              else if (i !== null) p.onClose(path)
            }}
            data-active={path === p.active || undefined}
            title={i < 9 ? `${path}  ⌘${i + 1}` : path}
            className={`group flex shrink-0 items-center gap-1.5 rounded px-2 py-0.5 font-mono text-xs ${
              p.done.has(path)
                ? 'tab-done'
                : path === p.active
                  ? 'tab-active'
                  : 'text-muted hover:bg-hover'
            }`}
          >
            {projectName(path)}
            <button
              onClick={(e) => {
                e.stopPropagation()
                p.onClose(path)
              }}
              className="rounded-sm opacity-0 hover:text-del group-hover:opacity-100"
              title="Close  ⇧⌘W"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
      {/* Outside the strip, so it stays in reach however many projects are open. */}
      <button className="no-drag btn shrink-0 text-muted" onClick={p.onOpen} title="Open project  ⌘T">
        <Plus className="h-3.5 w-3.5" />
      </button>
      {p.shelved.length > 0 && (
        <button
          onClick={async (e) => {
            const i = await contextMenu(
              p.shelved.map((path) => `${p.done.has(path) ? '● ' : ''}${projectName(path)}`),
              e.currentTarget
            )
            if (i !== null) p.onSelect(p.shelved[i])
          }}
          title="Shelf: open projects kept off the bar, still committed and synced with the rest"
          className={`no-drag flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-xs ${
            p.shelved.some((path) => p.done.has(path)) ? 'tab-done' : 'text-muted hover:bg-hover'
          }`}
        >
          <Archive className="h-3.5 w-3.5" />
          {p.shelved.length}
        </button>
      )}

      <div className="no-drag ml-auto flex shrink-0 items-center gap-1 text-xs text-muted">
        {p.active && p.minimized.length > 0 && (
          <div className="mr-1 flex items-center gap-1 border-r border-line pr-2">
            {p.minimized.map((s) => (
              <button
                key={s}
                onClick={() => p.onRestore(s)}
                title={`Show ${TITLES[s]}`}
                className="shrink-0 rounded border border-dashed border-line px-1.5 text-[11px] leading-[18px] hover:border-solid hover:bg-hover hover:text-fg"
              >
                {TITLES[s]}
              </button>
            ))}
          </div>
        )}
        {p.pluginViews.map((v) => (
          <button
            key={v.id}
            onClick={() => p.onPluginView(v.id)}
            title={`Toggle ${v.title.toLowerCase()}${v.shortcut ? `  ${v.shortcut}` : ''}`}
            className={`shrink-0 rounded p-1 [&_svg]:h-3.5 [&_svg]:w-3.5 ${p.pluginView === v.id ? on : off}`}
          >
            {v.icon}
          </button>
        ))}
        {p.active && p.readme && (
          <button onClick={p.onReadme} title="Toggle README  ⌘E" className={`shrink-0 rounded p-1 ${p.reading ? on : off}`}>
            <BookOpen className="h-3.5 w-3.5" />
          </button>
        )}
        {p.active &&
          p.playgrounds.map((slot, i) => (
            <button
              key={i}
              onClick={() => p.onPlay(i + 1)}
              title={`Toggle ${slot.name || `playground ${i + 1}`}  ⌥⌘${digit(i)}`}
              className={`flex shrink-0 items-end rounded p-1 ${p.playUnseen(i + 1) ? 'tab-done' : p.playing === i + 1 ? on : off}`}
            >
              <Shapes className="h-3.5 w-3.5" />
              {p.playgrounds.length > 1 && <span className="-mb-0.5 text-[9px] font-semibold leading-none">{digit(i)}</span>}
            </button>
          ))}
        {p.folders && (
          <button onClick={p.onFolders} title="Toggle folders  ⌘B" className={`shrink-0 rounded p-1 ${p.browsing ? on : off}`}>
            <FolderOpen className="h-3.5 w-3.5" />
          </button>
        )}
        {p.webPages.length > 0 && (
          // One button however many pages there are: with one it toggles it, with more it drops down a list.
          <button
            onClick={async (e) => {
              if (p.webPages.length === 1) return p.onWeb(0)
              const items = p.webPages.map(
                (page, i) => `${p.showingWeb === i ? '✓ ' : ''}${page.name || page.url.replace(/^https?:\/\//, '')}\t⌃⌘${digit(i)}`
              )
              const i = await contextMenu([...items, '-', 'Edit Web Pages…'], e.currentTarget)
              if (i === null) return
              if (i < p.webPages.length) p.onWeb(i)
              else p.onSettings()
            }}
            onContextMenu={async (e) => {
              e.preventDefault()
              if ((await contextMenu(['Edit Web Pages…'])) === 0) p.onSettings()
            }}
            title={
              p.webPages.length === 1
                ? `${p.webPages[0].name ? `${p.webPages[0].name}: ` : ''}${p.webPages[0].url}  ⌃⌘1`
                : p.showingWeb !== null
                  ? `Web pages (showing ${p.webPages[p.showingWeb]?.name || p.webPages[p.showingWeb]?.url})`
                  : 'Web pages  ⌃⌘1–0'
            }
            className={`flex shrink-0 items-center gap-0.5 rounded p-1 ${p.showingWeb !== null ? on : off}`}
          >
            <Globe className="h-3.5 w-3.5" />
            {p.webPages.length > 1 && <ChevronDown className="h-2.5 w-2.5" />}
          </button>
        )}
        <button onClick={p.onSettings} title="Settings  ⌘," className={`shrink-0 rounded p-1 ${p.configuring ? on : off}`}>
          <Settings className="h-3.5 w-3.5" />
        </button>
      </div>
    </header>
  )
}
