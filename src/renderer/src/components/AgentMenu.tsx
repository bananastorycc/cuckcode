import { useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import type { Agent } from '../../../shared/types'
import { clamp } from '../clamp'

// Stable, so the menu takes focus once when it opens rather than on every hover re-render.
const focus = (el: HTMLElement | null): void => el?.focus()

interface Props {
  agents: Agent[]
  value: string // the agent's id
  onChange: (id: string) => void
}

// The agent switcher in the Agents section's title bar, drawn like BranchMenu rather than a native <select>.
export default function AgentMenu({ agents, value, onChange }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)

  const show = (): void => {
    setIndex(Math.max(0, agents.findIndex((a) => a.id === value)))
    setOpen(true)
  }

  const pick = (id: string | undefined): void => {
    setOpen(false)
    if (id && id !== value) onChange(id)
  }

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex(clamp(index + (e.key === 'ArrowDown' ? 1 : -1), 0, agents.length - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      pick(agents[index]?.id)
    } else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => (open ? setOpen(false) : show())}
        title="Switch agent"
        className={`flex items-center gap-1 rounded-sm px-1.5 font-mono ${
          open ? 'bg-bg text-fg shadow-xs ring-1 ring-line' : 'text-fg hover:bg-hover'
        }`}
      >
        {agents.find((a) => a.id === value)?.name}
        <ChevronDown className={`h-3 w-3 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <div className="no-drag fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            ref={focus}
            tabIndex={-1}
            onKeyDown={onKey}
            className="absolute left-0 top-full z-50 mt-1 min-w-32 rounded-md border border-line bg-panel py-1 shadow-lg outline-hidden"
          >
            {agents.map((a, i) => (
              <button
                key={a.id}
                onMouseEnter={() => setIndex(i)}
                onClick={() => pick(a.id)}
                className={`flex w-full items-center gap-1.5 px-2 py-0.5 text-left font-mono text-xs text-fg outline-hidden ${
                  i === index ? 'bg-hover' : ''
                }`}
              >
                {a.id === value ? <Check className="h-3 w-3 shrink-0 text-accent" /> : <span className="w-3 shrink-0" />}
                {a.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
