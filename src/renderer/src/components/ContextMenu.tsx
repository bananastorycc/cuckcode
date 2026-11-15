import { useEffect, useLayoutEffect, useRef, useState } from 'react'

interface Open {
  items: string[]
  x: number
  y: number
  resolve: (i: number | null) => void
}

// Menus open where the right-click was. Captured before any handler runs, so callers
// only need the labels.
let at = { x: 0, y: 0 }
window.addEventListener('contextmenu', (e) => (at = { x: e.clientX, y: e.clientY }), true)

let show: ((m: Open) => void) | null = null

// An in-app context menu ('-' is a separator); resolves to the picked item's index, or null when dismissed.
export function contextMenu(items: string[]): Promise<number | null> {
  return new Promise((resolve) => (show ? show({ items, ...at, resolve }) : resolve(null)))
}

export default function ContextMenuHost(): React.JSX.Element | null {
  const [menu, setMenu] = useState<Open | null>(null)
  const [index, setIndex] = useState(-1)
  const box = useRef<HTMLDivElement>(null)
  const restore = useRef<Element | null>(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })

  const close = (i: number | null): void => {
    if (!menu) return
    // Focus goes back first, so a rename field opened by the pick can take it.
    if (restore.current instanceof HTMLElement) restore.current.focus()
    setMenu(null)
    menu.resolve(i)
  }

  useEffect(() => {
    show = (m) => {
      setMenu((prev) => {
        prev?.resolve(null)
        return m
      })
      setIndex(-1)
      restore.current = document.activeElement
    }
    return () => {
      show = null
    }
  }, [])

  // Kept on screen: flipped up or left when it would run off the window.
  useLayoutEffect(() => {
    if (!menu || !box.current) return
    const { width, height } = box.current.getBoundingClientRect()
    setPos({
      left: menu.x + width > innerWidth ? Math.max(0, menu.x - width) : menu.x,
      top: menu.y + height > innerHeight ? Math.max(0, menu.y - height) : menu.y
    })
    box.current.focus()
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const dismiss = (): void => close(null)
    window.addEventListener('blur', dismiss)
    window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('resize', dismiss)
    }
  }, [menu])

  if (!menu) return null

  const step = (by: number): void => {
    const n = menu.items.length
    let i = index
    for (let k = 0; k < n; k++) {
      i = (i + by + n) % n
      if (menu.items[i] !== '-') return setIndex(i)
    }
  }

  const onKey = (e: React.KeyboardEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'ArrowDown') step(1)
    else if (e.key === 'ArrowUp') step(-1)
    else if (e.key === 'Enter' && index >= 0) close(index)
    else if (e.key === 'Escape') close(null)
  }

  return (
    <div
      className="no-drag fixed inset-0 z-100"
      onMouseDown={(e) => e.target === e.currentTarget && close(null)}
      onContextMenu={(e) => {
        e.preventDefault()
        close(null)
      }}
    >
      <div
        ref={box}
        tabIndex={-1}
        onKeyDown={onKey}
        style={pos}
        className="absolute min-w-40 rounded-md border border-line bg-panel py-1 shadow-lg outline-hidden"
      >
        {menu.items.map((label, i) =>
          label === '-' ? (
            <div key={i} className="my-1 border-t border-line" />
          ) : (
            <button
              key={i}
              onMouseEnter={() => setIndex(i)}
              onMouseLeave={() => setIndex(-1)}
              onClick={() => close(i)}
              className={`block w-full whitespace-nowrap px-3 py-0.5 text-left text-xs text-fg outline-hidden ${
                i === index ? 'bg-hover' : ''
              }`}
            >
              {label}
            </button>
          )
        )}
      </div>
    </div>
  )
}
