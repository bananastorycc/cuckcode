import { execFile } from 'node:child_process'
import type { JunieBalance, JuniePool } from '../shared/types'

// A license's credits, signed in as Junie's own JetBrains Account login in the keychain.
// Like usage.ts, we never refresh that login: a running junie does, and the server still
// takes it once it has expired.
// Each junie agent runs `junie --auth-license=<its license>`: the license is swapped for its own
// token. Without a license there's nothing to swap, and the refill date needs one.
const EXCHANGE_URL = 'https://api.jetbrains.ai/auth/jetbrains-jwt/provide-access/license/v2'
// The monthly allowance and the bought top-up separately (junie's /stats shows only their sum).
const QUOTA_URL = 'https://api.jetbrains.ai/user/v5/quota/get'
// When the license's credits next refill (a rolling 30 days, not the calendar month).
const REFILL_URL = 'https://api.jetbrains.ai/user/v5/quota/metadata/refill'
// Amounts come in hundred-thousandths of an AI credit (AI Pro's 10 a month is 1,000,000).
const UNITS_PER_CREDIT = 100_000

function run(cmd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    // Capped: a keychain access prompt left unanswered would otherwise hang every poll.
    execFile(cmd, args, { timeout: 10_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : stdout))
  })
}

// Junie names the item `<hash>jb-account-stored`, the hash differing per install, so it's
// found once by its suffix. Listing items reads no passwords.
let account: string | null = null

async function idToken(): Promise<string | null> {
  if (!account) {
    const dump = await run('security', ['dump-keychain'])
    account = dump?.match(/"acct"<blob>="([0-9a-f]{64}jb-account-stored)"/)?.[1] ?? null
    if (!account) return null
  }
  const stored = await run('security', ['find-generic-password', '-s', 'junie-cli', '-a', account, '-w'])
  try {
    // `junie.b64:<base64 JSON>`
    const json = Buffer.from(stored!.trim().replace(/^[^:]*:/, ''), 'base64').toString()
    return JSON.parse(json).jbAccount?.id_token ?? null
  } catch {
    account = null
    return null
  }
}

async function bearer(lic: string): Promise<string | null> {
  if (!lic) return null
  const id = await idToken()
  if (!id) return null
  const res = await fetch(EXCHANGE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${id}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ licenseId: lic }),
    signal: AbortSignal.timeout(15_000)
  })
  return res.ok ? (((await res.json()) as { token?: string }).token ?? null) : null
}

function post(url: string, token: string): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'grazie-authenticate-jwt': token, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(15_000)
  })
}

// Optional: a failure here still shows the balance.
async function nextRefill(token: string): Promise<string | null> {
  try {
    const res = await post(REFILL_URL, token)
    if (!res.ok) return null
    const next = ((await res.json()) as { current?: { next?: number } }).current?.next
    return typeof next === 'number' ? new Date(next).toISOString() : null
  } catch {
    return null
  }
}

interface RawPool {
  maximum?: { amount?: string }
  available?: { amount?: string }
}

function pool(raw: RawPool | undefined): JuniePool | null {
  const total = Number(raw?.maximum?.amount)
  const left = Number(raw?.available?.amount)
  if (!Number.isFinite(total) || !Number.isFinite(left)) return null
  return { left: left / UNITS_PER_CREDIT, total: total / UNITS_PER_CREDIT }
}

export async function junieBalance(license: string): Promise<JunieBalance | null> {
  try {
    const token = await bearer(license)
    if (!token) return null
    const [res, resetsAt] = await Promise.all([post(QUOTA_URL, token), nextRefill(token)])
    if (!res.ok) return null
    const raw = ((await res.json()) as { current?: { tariffQuota?: RawPool; topUpQuota?: RawPool } }).current
    const monthly = pool(raw?.tariffQuota)
    const topUp = pool(raw?.topUpQuota)
    return monthly && topUp ? { monthly, topUp, resetsAt } : null
  } catch {
    return null
  }
}
