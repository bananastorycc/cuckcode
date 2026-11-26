import { useEffect, useRef, type ReactNode } from 'react'
import type { Terminal as XTerm } from '@xterm/xterm'
import { RotateCcw } from 'lucide-react'
import type { Theme } from '../../../shared/types'
import { SHELL_ID } from '../../../shared/types'
import { TERMINAL } from '../theme'
import { openXterm, shellQuote } from '../xterm'
import { saveAll } from './CodePane'
import { toast } from './Toasts'

interface Props {
  project: string
  agent: string // the agent's id, or SHELL_ID for the bottom pane
  name: string
  mentions?: boolean // dropped files go in as @path, not a quoted path
  newline?: boolean // ⇧↩ sends ESC+CR, a newline without submitting
  active: boolean
  theme: Theme
  title?: ReactNode // replaces the plain name label, e.g. with a tab switcher
  onNotify?: (message: string) => void
}

// Live terminals by PTY id, so the app can paste into one (Send Selection, a playground's Done).
const terms = new Map<string, XTerm>()

// Resolves once the program in the terminal has turned on bracketed paste, which agents like
// Claude Code do when their prompt is up, or false after `ms`. Text sent to an agent that's still starting is lost.
export function whenReady(id: string, ms = 30_000): Promise<boolean> {
  const until = Date.now() + ms
  return new Promise((resolve) => {
    const check = (): void => {
      if (terms.get(id)?.modes.bracketedPasteMode) resolve(true)
      else if (Date.now() > until) resolve(false)
      else setTimeout(check, 100)
    }
    check()
  })
}

// Pasted, not typed: xterm wraps it in bracketed paste when the program asked for that, so
// the agent takes it as one input rather than keystrokes.
export function pasteInto(id: string, text: string, focus = true): boolean {
  const t = terms.get(id)
  t?.paste(text)
  if (focus) t?.focus()
  return !!t
}

// The drag type FileTree rows carry: the dragged file's absolute path.
export const PATH_DRAG = 'application/x-cuckcode-path'

export default function Terminal({ project, agent, name, mentions, newline, active, theme, title, onNotify }: Props): React.JSX.Element {
  const id = `${agent}:${project}`
  const host = useRef<HTMLDivElement>(null)
  const term = useRef<XTerm | null>(null)
  const exited = useRef(false)
  const notify = useRef(onNotify)
  notify.current = onNotify
  const newlineRef = useRef(newline)
  newlineRef.current = newline

  // A spawn can fail outright (node-pty's helper not executable after an install); say so
  // rather than leave a blank pane.
  const failed = (err: unknown): void => {
    exited.current = true
    term.current?.write(`\r\n\x1b[2m[${String(err)} — press any key to retry]\x1b[0m\r\n`)
  }

  const restart = (): void => {
    const t = term.current
    if (!t) return
    exited.current = false
    t.reset()
    window.api.ptyRestart(id, t.cols, t.rows).catch(failed)
  }

  useEffect(() => {
    const { term: t, dispose } = openXterm(host.current!, theme)
    term.current = t
    terms.set(id, t)

    // Enter (a prompt, a command) writes every unsaved edit first, so the agent reads what's
    // on screen and can't later be overwritten by it. Input queues behind the save to stay in order.
    // An agent's prompt says what it saved, since nothing else would show it happened.
    let queue = Promise.resolve()
    const send = (data: string): void => {
      const submits = data.includes('\r') && data !== '\x1b\r' // ⇧↩ is a newline, not a submit
      queue = queue
        .then(async () => {
          if (!submits) return
          const saved = await saveAll()
          if (!saved.length || agent === SHELL_ID) return
          const rel = (p: string): string => (p.startsWith(`${project}/`) ? p.slice(project.length + 1) : p)
          toast(true, `${project.split('/').pop()}: saved before the prompt`, saved.map(rel).join('\n'))
        })
        // A rejected step would skip every later keystroke, so the input still goes through.
        .catch(() => {})
        .then(() => window.api.ptyWrite(id, data))
    }

    t.attachCustomKeyEventHandler((e) => {
      // Agents like Claude Code read ESC+CR as "newline without submit". Swallow the keypress
      // too, or xterm sends a plain CR from it and submits anyway.
      if (newlineRef.current && e.shiftKey && e.key === 'Enter') {
        if (e.type === 'keydown') send('\x1b\r')
        return false
      }
      if (e.type !== 'keydown') return true
      if (e.metaKey && e.key === 'k') {
        t.clear()
        return false
      }
      return true
    })

    // Agents signal "done / needs input" with a bell or an OSC 9 / OSC 777 notification
    // (Claude Code's preset does it through its hooks and $CUCKCODE_NOTIFY).
    t.onBell(() => notify.current?.(''))
    t.parser.registerOscHandler(9, (data) => {
      if (!/^\d;/.test(data)) notify.current?.(data) // 9;4;… is a progress report, not a notification
      return true
    })
    t.parser.registerOscHandler(777, (data) => {
      const [type, , body] = data.split(';')
      if (type === 'notify') notify.current?.(body ?? '')
      return true
    })

    // Reattaching to a busy session: output sent before ptyStart's reply is already in the
    // replayed tail, and writing it live too would print it twice, out of order.
    let replayed = false
    const offData = window.api.onPtyData(id, (data) => replayed && t.write(data))
    const offExit = window.api.onPtyExit(id, () => {
      exited.current = true
      t.write('\r\n\x1b[2m[process exited — press any key to restart]\x1b[0m\r\n')
    })
    t.onData((data) => {
      if (exited.current) restart()
      else send(data)
    })
    t.onResize(({ cols, rows }) => window.api.ptyResize(id, cols, rows))

    window.api
      .ptyStart(id, t.cols, t.rows)
      .then((replay) => replay && t.write(replay), failed)
      .finally(() => (replayed = true))

    return () => {
      offData()
      offExit()
      dispose()
      terms.delete(id)
      term.current = null
    }
    // Theme is applied by the effect below; recreating the terminal would drop state.
  }, [id])

  useEffect(() => {
    if (term.current) term.current.options.theme = TERMINAL[theme]
  }, [theme])

  useEffect(() => {
    const t = term.current
    if (!active || !t) return
    // The bottom shell shows alongside the top terminal; the top one gets focus.
    if (agent !== SHELL_ID) t.focus()
  }, [active, id, agent])

  return (
    <div className={`absolute inset-0 flex-col ${active ? 'flex' : 'hidden'}`}>
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-line bg-panel px-3 text-xs text-muted">
        {title ?? <span className="font-mono">{name}</span>}
        <button className="btn" onClick={restart} title={`Restart ${name}`}>
          <RotateCcw className="h-3 w-3" />
        </button>
      </div>
      <div
        className="min-h-0 flex-1 bg-bg py-1 pl-2"
        onDragOver={(e) => e.dataTransfer.types.includes(PATH_DRAG) && e.preventDefault()}
        onDrop={(e) => {
          const abs = e.dataTransfer.getData(PATH_DRAG)
          if (!abs) return
          e.preventDefault()
          // Relative to the project, where the terminal starts; with mentions, an @ file mention.
          const path = abs.startsWith(`${project}/`) ? abs.slice(project.length + 1) : abs
          pasteInto(id, mentions ? `@${path} ` : `${shellQuote(path)} `)
        }}
      >
        <div ref={host} className="h-full w-full" />
      </div>
    </div>
  )
}
