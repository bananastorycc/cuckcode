import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { Theme } from '../../shared/types'
import { MONO, TERMINAL } from './theme'

// An xterm in host, kept fitted to it, for every terminal: agents', the shell's, plugins' runs.
// Only fitted at a real size: a minimized section's host can be squashed to 0 high, and fitting
// that would shrink the PTY to one row and reflow everything in it.
export function openXterm(host: HTMLDivElement, theme: Theme): { term: XTerm; dispose: () => void } {
  const term = new XTerm({
    fontFamily: MONO,
    fontSize: 13,
    lineHeight: 1.2,
    cursorBlink: true,
    macOptionIsMeta: true,
    scrollback: 5_000,
    theme: TERMINAL[theme]
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.open(host)
  const shown = (): boolean => !!host.offsetWidth && !!host.offsetHeight
  let frame = 0
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      if (shown()) fit.fit()
    })
  })
  observer.observe(host)
  if (shown()) fit.fit()
  return {
    term,
    dispose: () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      term.dispose()
    }
  }
}

export const shellQuote = (s: string): string => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`)
