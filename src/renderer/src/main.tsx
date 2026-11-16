import { createRoot } from 'react-dom/client'
import App from './App'
import ContextMenuHost from './components/ContextMenu'
import './index.css'

// Pane moves (⌃⌘arrows) and project moves (⇧⌘[ ]) belong to the menu, but Monaco and xterm
// would take them first (⇧⌘[ folds in Monaco). Hidden from them here and left unhandled, they
// fall through to the menu. Blocking them in main instead makes macOS beep: no menu item claims them.
const MOVE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])
window.addEventListener(
  'keydown',
  (e) => {
    if (!e.metaKey || e.altKey) return
    const pane = e.ctrlKey && !e.shiftKey && MOVE_KEYS.has(e.key)
    const cycle = e.shiftKey && !e.ctrlKey && (e.code === 'BracketLeft' || e.code === 'BracketRight')
    if (pane || cycle) e.stopImmediatePropagation()
  },
  true
)

createRoot(document.getElementById('root')!).render(
  <>
    <App />
    <ContextMenuHost />
  </>
)
