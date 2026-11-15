import { useRef } from 'react'
import { BookOpen, FolderOpen, Globe, Plus, Settings, Shapes, X } from 'lucide-react'
import type { PlaygroundSlot, WebPage } from '../../../shared/types'
import { contextMenu } from './ContextMenu'

interface Props {
  projects: string[]
  active: string | null
  done: Set<string>
  onSelect: (path: string) => void
  onClose: (path: string) => void
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
}

const on = 'bg-bg text-fg shadow-xs ring-1 ring-line'
const off = 'text-muted hover:bg-hover'
// Shortcut digits: 1–9, then 0 for the tenth.
const digit = (i: number): string => String((i + 1) % 10)

export const projectName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

export const tildify = (path: string): string => path.replace(/^\/Users\/[^/]+/, '~')

export default function Header(p: Props): React.JSX.Element {
  const dragging = useRef<number | null>(null)
  return (
    <header className="drag flex h-8 shrink-0 items-center gap-1 border-b border-line bg-panel pl-[78px] pr-2">
      <div className="no-drag flex min-w-0 items-center gap-1 overflow-x-auto p-px">
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
            title={i < 9 ? `${path}  ⌘${i + 1}` : path}
            className={`group flex shrink-0 items-center gap-1.5 rounded px-2 py-0.5 font-mono text-xs ${
              p.done.has(path)
                ? 'tab-done'
                : path === p.active
                  ? 'bg-bg text-fg shadow-xs ring-1 ring-line'
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
        <button className="btn text-muted" onClick={p.onOpen} title="Open project  ⌘T">
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="no-drag ml-auto flex shrink-0 items-center gap-1 text-xs text-muted">
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
        {p.webPages.map((page, i) => (
          <button
            key={i}
            onClick={() => p.onWeb(i)}
            onContextMenu={async (e) => {
              e.preventDefault()
              if ((await contextMenu(['Edit Web Pages…'])) === 0) p.onSettings()
            }}
            title={`${page.name ? `${page.name}: ` : ''}${page.url}  ⌃⌘${digit(i)}`}
            className={`flex shrink-0 items-end rounded p-1 ${p.showingWeb === i ? on : off}`}
          >
            <Globe className="h-3.5 w-3.5" />
            <span className="-mb-0.5 text-[9px] font-semibold leading-none">{digit(i)}</span>
          </button>
        ))}
        <button onClick={p.onSettings} title="Settings  ⌘," className={`shrink-0 rounded p-1 ${p.configuring ? on : off}`}>
          <Settings className="h-3.5 w-3.5" />
        </button>
      </div>
    </header>
  )
}
