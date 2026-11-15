import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { replaceIn, toRegExp } from '../shared/search'
import type { SearchMatch, SearchQuery, SearchResult } from '../shared/types'
import { isBinary, listFiles, run } from './git'

const MAX_MATCHES = 2000
const MAX_FILE = 1024 * 1024
const PREVIEW = 300
const CONTEXT = 40

// `git grep` (fast, respects .gitignore) narrows the files; regexes go through PCRE, close
// enough to JS that only the files it lists are scanned.
async function candidates(root: string, q: SearchQuery): Promise<string[]> {
  const args = ['grep', '-l', '-z', '-I', '--untracked', '--exclude-standard', q.regex ? '-P' : '-F']
  if (!q.caseSensitive) args.push('-i')
  if (q.word) args.push('-w')
  // (*ANYCRLF): `$` must match before a CRLF line's \r, as it does once the JS pass strips it.
  const pattern = q.regex ? `(*ANYCRLF)${q.text}` : q.text
  // Exit code 1 means no matches. A regex PCRE rejects but JS accepts falls back to every file.
  const out = await run(root, [...args, '-e', pattern], 30_000).catch((err: Error) =>
    q.regex && err.message.startsWith('fatal:') ? null : ''
  )
  return out === null ? listFiles(root) : out.split('\0').filter(Boolean)
}

async function readText(abs: string): Promise<string | null> {
  const info = await stat(abs).catch(() => null)
  if (!info?.isFile() || info.size > MAX_FILE) return null
  const buf = await readFile(abs).catch(() => null)
  if (!buf || isBinary(buf)) return null
  return buf.toString('utf8')
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

export function matchLine(line: string, n: number, re: RegExp): SearchMatch | null {
  const all: [number, number][] = []
  for (const m of line.matchAll(re)) if (m[0]) all.push([m.index!, m.index! + m[0].length])
  if (!all.length) return null
  const start = Math.max(0, all[0][0] - CONTEXT)
  const end = start + PREVIEW
  const ranges = all.filter(([s]) => s < end).map(([s, e]): [number, number] => [s - start, Math.min(e, end) - start])
  return { line: n, col: all[0][0] + 1, text: line.slice(start, end), ranges }
}

export async function search(root: string, q: SearchQuery): Promise<SearchResult> {
  let re: RegExp
  try {
    re = toRegExp(q)
  } catch (err) {
    return { files: [], truncated: false, error: (err as Error).message }
  }
  const paths = (await candidates(root, q)).sort()
  // Each file is matched as soon as it's read, so only its hits stay in memory, not its text.
  const hits = await mapLimit(paths, 32, async (p) => {
    const text = await readText(join(root, p))
    return text === null ? [] : matchText(text, re)
  })

  const result: SearchResult = { files: [], truncated: false }
  let total = 0
  for (let i = 0; i < paths.length && !result.truncated; i++) {
    const matches: SearchMatch[] = []
    for (const m of hits[i]) {
      matches.push(m)
      if ((total += m.ranges.length) >= MAX_MATCHES) {
        result.truncated = true
        break
      }
    }
    if (matches.length) result.files.push({ path: paths[i], matches })
  }
  return result
}

// One file's hits, capped like the whole search.
function matchText(text: string, re: RegExp): SearchMatch[] {
  const out: SearchMatch[] = []
  const lines = text.split('\n')
  let total = 0
  for (let n = 0; n < lines.length && total < MAX_MATCHES; n++) {
    const m = matchLine(lines[n].replace(/\r$/, ''), n + 1, re)
    if (!m) continue
    out.push(m)
    total += m.ranges.length
  }
  return out
}

export interface Replaced {
  count: number
  files: { path: string; text: string }[] // only the files that changed
}

// Line by line, like the search, so `^`/`$` mean the same thing in both. Writes nothing:
// this runs in the worker, which a runaway regex gets killed in, and a kill mid-write
// would truncate the file.
export async function replacements(root: string, q: SearchQuery, replacement: string, paths: string[]): Promise<Replaced> {
  const re = toRegExp(q)
  const out: Replaced = { count: 0, files: [] }
  await mapLimit(paths, 16, async (path) => {
    const text = await readText(join(root, path))
    if (text === null) return
    const next = text
      .split('\n')
      .map((raw) => {
        const cr = raw.endsWith('\r') ? '\r' : ''
        const line = cr ? raw.slice(0, -1) : raw
        for (const m of line.matchAll(re)) if (m[0]) out.count++
        return replaceIn(line, re, q, replacement) + cr
      })
      .join('\n')
    if (next !== text) out.files.push({ path, text: next })
  })
  return out
}

export async function write(root: string, r: Replaced): Promise<number> {
  await Promise.all(r.files.map((f) => writeFile(join(root, f.path), f.text, 'utf8')))
  return r.count
}

// Returns the number of replacements made.
export async function replace(root: string, q: SearchQuery, replacement: string, paths: string[]): Promise<number> {
  return write(root, await replacements(root, q, replacement, paths))
}
