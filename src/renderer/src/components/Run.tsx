import { useEffect, useRef, useState } from 'react'
import type { Terminal as XTerm } from '@xterm/xterm'
import { X } from 'lucide-react'
import type { RunProps } from '../../../shared/plugin'
import type { RunExit } from '../../../shared/types'
import { usePlay } from '../play'
import { TERMINAL } from '../theme'
import { openXterm, shellQuote } from '../xterm'

const ended = (exit: RunExit): string =>
  exit.refused !== undefined
    ? `\x1b[31m[not run: ${exit.refused}]\x1b[0m`
    : exit.code === null
      ? '\x1b[2m[stopped]\x1b[0m'
      : exit.code
        ? `\x1b[31m[exited with ${exit.code}]\x1b[0m`
        : '\x1b[2m[exited with 0]\x1b[0m'

// A plugin's run (RendererHost.Run): one command in a PTY of its own, named by the plugin and its
// id. Main starts it the first time its id mounts and only ever reattaches after, so a remount,
// a keypress or a re-render never runs it again.
export default function Run({ plugin, id: name, cwd, argv, pin, title, onExit, actions }: RunProps & { plugin: string }): React.JSX.Element {
  const id = `run.${plugin}.${name}`
  const valid = typeof name === 'string' && /^[\w-]+$/.test(name)
  const { theme } = usePlay()
  const host = useRef<HTMLDivElement>(null)
  const term = useRef<XTerm | null>(null)
  const [running, setRunning] = useState(false)
  const exitFn = useRef(onExit)
  exitFn.current = onExit
  // Read once, when the run starts: after that, the id is the run.
  const spec = useRef({ cwd, argv, pin })
  spec.current = { cwd, argv, pin }

  useEffect(() => {
    if (!valid) return
    const { term: t, dispose } = openXterm(host.current!, theme)
    term.current = t
    let gone = false
    let done = false
    const finish = (exit: RunExit): void => {
      if (gone || done) return
      done = true
      setRunning(false)
      t.write(`\r\n${ended(exit)}\r\n`)
      try {
        exitFn.current?.(exit)
      } catch (err) {
        console.error(`plugin ${plugin}:`, err)
      }
    }
    // Reattaching: output and an exit sent before runStart's reply are already in it.
    let replayed = false
    const offData = window.api.onPtyData(id, (data) => replayed && t.write(data))
    const offExit = window.api.onPtyExit(id, (exit) => replayed && finish(exit ?? { code: null }))
    t.onData((data) => !done && window.api.ptyWrite(id, data))
    t.onResize(({ cols, rows }) => window.api.ptyResize(id, cols, rows))
    window.api
      .runStart(id, spec.current, t.cols, t.rows)
      .then(
        ({ replay, exit }) => {
          if (gone) return
          if (replay) t.write(replay)
          if (exit) return finish(exit)
          setRunning(true)
          // Just started: the command may ask something.
          if (!replay) t.focus()
        },
        (err) => finish({ code: null, refused: String(err) })
      )
      .finally(() => (replayed = true))
    return () => {
      gone = true
      offData()
      offExit()
      dispose()
      term.current = null
    }
    // The theme is applied below; the run is the id's alone.
  }, [id, valid])

  useEffect(() => {
    if (term.current) term.current.options.theme = TERMINAL[theme]
  }, [theme])

  if (!valid) return <div className="flex h-full items-center justify-center bg-bg text-xs text-muted">A run&apos;s id must match [\w-]+.</div>
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-line bg-panel px-3 text-xs text-muted">
        <span className="truncate font-mono">{title ?? (Array.isArray(argv) ? argv.map(shellQuote).join(' ') : '')}</span>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          {running && (
            <button className="rounded p-1 hover:bg-hover hover:text-fg" title="Stop" onClick={() => window.api.runStop(id)}>
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 bg-bg py-1 pl-2">
        <div ref={host} className="h-full w-full" />
      </div>
    </div>
  )
}
