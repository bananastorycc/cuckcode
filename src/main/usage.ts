import { execFile } from 'node:child_process'
import type { Usage, UsageLimit } from '../shared/types'

// The same endpoint `claude /usage` reads, with the OAuth token Claude Code keeps in the
// keychain. We never refresh the token ourselves: a running claude does, and until then
// the bar just keeps its last numbers.
const URL = 'https://api.anthropic.com/api/oauth/usage'

function token(): Promise<string | null> {
  return new Promise((resolve) => {
    // Capped: a keychain access prompt left unanswered would otherwise hang every poll.
    const args = ['find-generic-password', '-s', 'Claude Code-credentials', '-w']
    execFile('security', args, { timeout: 10_000 }, (err, stdout) => {
      try {
        resolve(err ? null : (JSON.parse(stdout).claudeAiOauth?.accessToken ?? null))
      } catch {
        resolve(null)
      }
    })
  })
}

interface Money {
  amount_minor: number
  exponent: number
}

interface Raw {
  limits?: {
    kind: string
    percent: number
    resets_at: string | null
    scope: { model?: { display_name?: string | null } | null; surface?: string | null } | null
  }[]
  spend?: { enabled: boolean; used: Money & { currency: string }; limit: Money | null } | null
}

const money = (m: Money): number => m.amount_minor / 10 ** m.exponent

function label(l: NonNullable<Raw['limits']>[number]): string {
  if (l.kind === 'session') return 'session'
  if (l.kind === 'weekly_all') return 'week'
  return l.scope?.model?.display_name ?? l.scope?.surface ?? l.kind
}

export async function usage(): Promise<Usage | null> {
  const t = await token()
  if (!t) return null
  try {
    const res = await fetch(URL, {
      headers: { Authorization: `Bearer ${t}`, 'anthropic-beta': 'oauth-2025-04-20' },
      signal: AbortSignal.timeout(15_000)
    })
    if (!res.ok) return null
    const raw = (await res.json()) as Raw
    const limits: UsageLimit[] = (raw.limits ?? []).map((l) => ({
      label: label(l),
      percent: l.percent,
      resetsAt: l.resets_at
    }))
    const s = raw.spend
    const credits = s?.enabled
      ? { used: money(s.used), limit: s.limit ? money(s.limit) : null, currency: s.used.currency }
      : null
    return { limits, credits }
  } catch {
    return null
  }
}
