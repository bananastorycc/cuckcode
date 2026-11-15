import { useState } from 'react'
import { RefreshCw } from 'lucide-react'

// A configured web page, full-window. Sandboxed without allow-top-navigation, so the page can
// never navigate cuckcode itself away; popups go to the browser via setWindowOpenHandler.
export default function WebPage({ url }: { url: string }): React.JSX.Element {
  const [reloads, setReloads] = useState(0)
  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-panel px-3 font-mono text-xs text-muted">
        <span className="truncate">{url}</span>
        <button className="btn ml-auto text-muted" onClick={() => setReloads((n) => n + 1)} title="Reload">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>
      <iframe
        key={reloads}
        src={url}
        sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups"
        className="min-h-0 w-full flex-1 border-0 bg-bg"
      />
    </div>
  )
}
