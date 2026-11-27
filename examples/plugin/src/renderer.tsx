import { useEffect, useState, useSyncExternalStore } from 'react'
import type { RendererHost, ViewProps } from 'cuckcode/plugin'
import { createPins, type Pins } from './pins'

// The renderer side: a panel listing the files you pinned, a file tree item that pins or unpins
// one, and line counts (from the main side) that refresh as the editor saves.

let pins: Pins
let host: RendererHost

export async function activate(h: RendererHost): Promise<void> {
  host = h
  pins = createPins(h.store)
  await pins.load()
  // The manifest's command opens and closes it, as does its header button.
  h.panel({ id: 'pins', command: 'pins', title: 'Pinned', icon: <span className="example-icon">📌</span>, render: (props) => <Panel {...props} /> })
  h.contextMenu({
    where: 'files',
    title: 'Pin / Unpin',
    run: (path) => {
      void pins.toggle(path)
      h.show('pins')
    }
  })
}

// Nothing to undo by hand: the host disposes what activate registered. A timer, a watcher or a
// process the plugin started would be stopped here.
export function deactivate(): void {}

function Panel({ root, openFile }: ViewProps<unknown>): React.JSX.Element {
  const list = useSyncExternalStore(pins.subscribe, pins.list)
  const here = list.filter((p) => root && p.startsWith(`${root}/`))
  if (!here.length) return <div className="example-empty">Right-click a file in the tree and pick Pin / Unpin.</div>
  return (
    <ul className="example-pins">
      {here.map((path) => (
        <li key={path}>
          <button onClick={() => openFile(path, 1)}>{path.slice(root!.length + 1)}</button>
          <Lines path={path} />
        </li>
      ))}
    </ul>
  )
}

function Lines({ path }: { path: string }): React.JSX.Element {
  const [n, setN] = useState<number | null>(null)
  useEffect(() => {
    let live = true
    const count = (): void =>
      void host.invoke<number>('lines', path).then(
        (x) => live && setN(x),
        () => live && setN(null)
      )
    count()
    const off = host.onFileSaved((saved) => saved === path && count())
    return () => {
      live = false
      off()
    }
  }, [path])
  return <span className="example-lines">{n ?? '–'}</span>
}
