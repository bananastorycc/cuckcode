// Quick Open's matcher: the query's characters in order, anywhere in the path, ignoring case
// and spaces. Hits in the file name, at word starts and in runs score higher; among equals,
// shorter paths win.
export function fuzzy(query: string, paths: string[], limit = 50): string[] {
  const q = query.toLowerCase().replace(/\s+/g, '')
  if (!q) return []
  const scored: [number, string][] = []
  for (const path of paths) {
    const s = score(q, path)
    if (s !== null) scored.push([s, path])
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].length - b[1].length || a[1].localeCompare(b[1]))
  return scored.slice(0, limit).map(([, path]) => path)
}

// Tries the file name alone first, so `app` finds App.tsx before src/app/whatever.ts.
function score(q: string, path: string): number | null {
  const base = path.lastIndexOf('/') + 1
  const lower = path.toLowerCase()
  return walk(q, path, lower, base, base) ?? walk(q, path, lower, 0, base)
}

function walk(q: string, path: string, lower: string, from: number, base: number): number | null {
  let total = 0
  let last = -2
  let at = from
  for (const ch of q) {
    const i = lower.indexOf(ch, at)
    if (i < 0) return null
    total += 1
    if (i === last + 1) total += 5
    if (startsWord(path, i)) total += 4
    if (i >= base) total += 3
    last = i
    at = i + 1
  }
  if (lower.startsWith(q, base)) total += 10
  return total - path.length * 0.05
}

function startsWord(path: string, i: number): boolean {
  if (i === 0) return true
  const prev = path[i - 1]
  if ('/_-. '.includes(prev)) return true
  return prev === prev.toLowerCase() && path[i] !== path[i].toLowerCase()
}
