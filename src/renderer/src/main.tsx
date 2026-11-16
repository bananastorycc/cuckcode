import { createRoot } from 'react-dom/client'
import App from './App'
import ContextMenuHost from './components/ContextMenu'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <>
    <App />
    <ContextMenuHost />
  </>
)
