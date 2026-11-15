import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Marked } from 'marked'

interface Props {
  project: string
  // The repo root, searched when the project folder itself has no README.
  root: string
  tick: number
}

interface Found {
  dir: string
  name: string
  text: string
}

// The project's README, rendered, refetched on every file change so edits show live.
export default function Readme({ project, root, tick }: Props): React.JSX.Element {
  const [found, setFound] = useState<Found | null | undefined>(undefined)

  useEffect(() => {
    let stale = false
    ;(async () => {
      for (const dir of root && root !== project ? [project, root] : [project]) {
        const r = await window.api.readme(dir).catch(() => null)
        if (r) return { dir, ...r }
      }
      return null
    })().then((r) => !stale && setFound(r))
    return () => {
      stale = true
    }
  }, [project, root, tick])

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex h-8 shrink-0 items-center border-b border-line bg-panel px-3 font-mono text-xs text-muted">
        {found?.name ?? 'readme'}
      </div>
      {found === null ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted">No README in this project.</div>
      ) : (
        found && <Markdown dir={found.dir} text={found.text} className="min-h-0 flex-1 overflow-auto px-8 py-6" />
      )}
    </div>
  )
}

// A README rendered and made safe; also used for plugins' READMEs.
export function Markdown({ dir, text, className = '' }: { dir: string; text: string; className?: string }): React.JSX.Element {
  const body = useMemo(() => render({ dir, text }), [dir, text])
  const el = useRef<HTMLDivElement>(null)
  // The sanitized nodes themselves, never their HTML: parsing it a second time, now with
  // scripting on, can turn inert markup live (`<noscript><!--</noscript><img onerror>`).
  useLayoutEffect(() => {
    el.current?.replaceChildren(...[...body.childNodes].map((n) => document.importNode(n, true)))
  }, [body])
  return (
    <div
      ref={el}
      className={`markdown select-text ${className}`}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest('a')
        if (!a) return
        // Never navigate the app window; web links go to the browser via the window-open handler.
        e.preventDefault()
        const href = a.getAttribute('href') ?? ''
        if (/^(https?|mailto):/i.test(href)) window.open(href)
      }}
    />
  )
}

// Relative images resolve against the README's folder, served from disk like any working file.
function render({ dir, text }: { dir: string; text: string }): HTMLElement {
  const md = new Marked({
    gfm: true,
    walkTokens: (t) => {
      if (t.type === 'image' && !/^([a-z]+:|\/\/)/i.test(t.href)) {
        const path = `${dir}/${t.href.replace(/^\.?\//, '').split(/[?#]/)[0]}`
        t.href = `media://local/?path=${encodeURIComponent(decodeSafe(path))}`
      }
    }
  })
  try {
    return sanitize(md.parse(text, { async: false }))
  } catch {
    return document.createElement('body')
  }
}

// A literal % (an image named 100%.png) makes decodeURI throw.
function decodeSafe(path: string): string {
  try {
    return decodeURI(path)
  } catch {
    return path
  }
}

// READMEs come from any cloned repo, and this page holds window.api (terminals, file writes):
// keep their HTML, drop everything that could run, navigate the window, or restyle the app.
const UNSAFE = 'script, noscript, style, link, meta, base, iframe, frame, frameset, object, embed, form, template, animate, set'

function sanitize(html: string): HTMLElement {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.body.querySelectorAll(UNSAFE).forEach((el) => el.remove())
  for (const el of doc.body.querySelectorAll('*')) {
    for (const { name, value } of [...el.attributes]) {
      const url = /(^|:)(href|src|action|formaction|srcset|poster|data)$/.test(name)
      // Browsers ignore tabs and newlines inside a URL, so `java\tscript:` still runs.
      const scheme = value.replace(/[\x00-\x20]/g, '')
      // Inline style could pin an element over the whole window.
      if (name.startsWith('on') || name === 'srcdoc' || name === 'style' || (url && /^(javascript|vbscript):/i.test(scheme))) {
        el.removeAttribute(name)
      }
    }
  }
  return doc.body
}
