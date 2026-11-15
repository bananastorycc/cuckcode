import { useEffect, useRef, useState } from 'react'
import type { JunieBalance, JuniePool, Usage, UsageLimit } from '../../../shared/types'

// Plan usage for the Agents section's title bar. One poll for the whole app; the
// endpoints are rate limited, so it's every few minutes, and on coming back to the window.
const POLL_MS = 3 * 60_000
const MIN_GAP_MS = 60_000

// Polls the value for key while there is one (its agent is picked), keeping each key's last
// numbers in between, so switching back shows them at once.
function usePolled<T>(key: string | null, fetch: (key: string) => Promise<T | null>): T | null {
  const [values, setValues] = useState<Record<string, T>>({})
  const fetchRef = useRef(fetch)
  fetchRef.current = fetch
  const last = useRef(new Map<string, number>())
  useEffect(() => {
    if (key === null) return
    const load = (): void => {
      if (Date.now() - (last.current.get(key) ?? 0) < MIN_GAP_MS) return
      last.current.set(key, Date.now())
      // A failed fetch keeps the last numbers rather than blanking the bar.
      fetchRef.current(key).then((v) => v && setValues((r) => ({ ...r, [key]: v })))
    }
    load()
    const timer = setInterval(load, POLL_MS)
    window.addEventListener('focus', load)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', load)
    }
  }, [key])
  return key === null ? null : (values[key] ?? null)
}

export const useUsage = (shown: boolean): Usage | null => usePolled(shown ? 'usage' : null, () => window.api.usage())

// The license of the junie agent in front, or null.
export const useJunieBalance = (license: string | null): JunieBalance | null =>
  usePolled(license || null, (l) => window.api.junieBalance(l))

export function JunieBar({ balance }: { balance: JunieBalance | null }): React.JSX.Element | null {
  if (!balance) return null
  const { monthly, topUp, resetsAt } = balance
  return (
    <div className="flex h-4 min-w-0 flex-wrap items-center justify-end gap-x-2.5 overflow-hidden whitespace-nowrap font-mono leading-4">
      <span className="flex items-center gap-1" title="This license's monthly AI credits">
        monthly
        <PoolLeft pool={monthly} />
      </span>
      <span className="flex items-center gap-1" title="Bought AI credits, shared by every license on the account">
        top-up
        <PoolLeft pool={topUp} />
      </span>
      {resetsAt && (
        <span title={`Monthly credits refill ${new Date(resetsAt).toLocaleString()}`}>
          resets <span className="text-fg">{new Date(resetsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
          <span className="ml-1 opacity-60">{until(resetsAt)}</span>
        </span>
      )}
    </div>
  )
}

// Credits left of the total; the meter fills as they're used, like Claude's limits.
function PoolLeft({ pool }: { pool: JuniePool }): React.JSX.Element {
  const used = pool.total > 0 ? ((pool.total - pool.left) / pool.total) * 100 : 100
  return (
    <>
      <Meter percent={used} />
      <span>
        <span className={tone(used)}>{pool.left.toFixed(2)}</span>
        <span className="opacity-60">/{pool.total.toFixed(0)}</span>
      </span>
    </>
  )
}

export default function UsageBar({ usage }: { usage: Usage | null }): React.JSX.Element | null {
  // Re-render so the countdowns move between polls.
  const [, setNow] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  if (!usage) return null
  const { credits } = usage
  // Per-model limits go last, so a narrow pane drops them before the credit spend.
  const main = usage.limits.filter((l) => l.label === 'session' || l.label === 'week')
  const scoped = usage.limits.filter((l) => !main.includes(l))
  const limit = (l: UsageLimit): React.JSX.Element => (
    <span
      key={l.label}
      className="flex items-center gap-1"
      title={l.resetsAt ? `${l.label}: resets ${new Date(l.resetsAt).toLocaleString()}` : l.label}
    >
      {l.label}
      <Meter percent={l.percent} />
      <span className={tone(l.percent)}>{l.percent}%</span>
      {l.resetsAt && <span className="opacity-60">{until(l.resetsAt)}</span>}
    </span>
  )
  return (
    // Items that don't fit wrap onto a second line that's clipped away, so a narrow pane drops
    // whole items from the end instead of cutting one in half.
    <div className="flex h-4 min-w-0 flex-wrap items-center justify-end gap-x-2.5 overflow-hidden whitespace-nowrap font-mono leading-4">
      {main.map(limit)}
      {credits && (
        <span
          className="flex items-center gap-1"
          title={`Usage credits: ${fmt(credits.used, credits.currency)}${credits.limit === null ? '' : ` of ${fmt(credits.limit, credits.currency)}`} this month`}
        >
          credits
          {credits.limit !== null && <Meter percent={(credits.used / credits.limit) * 100} />}
          <span>
            {fmt(credits.used, credits.currency)}
            {credits.limit !== null && <span className="opacity-60">/{fmt(credits.limit, credits.currency)}</span>}
          </span>
        </span>
      )}
      {scoped.map(limit)}
    </div>
  )
}

function Meter({ percent }: { percent: number }): React.JSX.Element {
  const p = Math.max(0, Math.min(100, percent))
  return (
    <span className="h-1 w-6 overflow-hidden rounded-full bg-line">
      <span className={`block h-full rounded-full ${fill(p)}`} style={{ width: `${p}%` }} />
    </span>
  )
}

const tone = (p: number): string => (p >= 90 ? 'text-del' : p >= 70 ? 'text-mod' : 'text-fg')
const fill = (p: number): string => (p >= 90 ? 'bg-del' : p >= 70 ? 'bg-mod' : 'bg-accent')

function until(iso: string): string {
  const m = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60_000))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 10) return `${h}h${String(m % 60).padStart(2, '0')}m`
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d${h % 24}h`
}

function fmt(n: number, currency: string): string {
  const digits = Number.isInteger(n) ? 0 : 2
  return n.toLocaleString(undefined, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits })
}
