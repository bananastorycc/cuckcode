import { createReadStream } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { Readable } from 'node:stream'
import { runBuffer } from './git'
import type { BrowseEntry } from '../shared/types'
import { mediaKind, TYPES } from './mime'
import { kitDir, playDir, validSlot } from './playground'

// Serves media:// URLs built by git.snapshot():
//   media://local/?path=<abs>&v=<mtime>          working tree file
//   media://local/?repo=<root>&blob=<sha>&ext=.x  blob from git (content-addressed, cached)
//   media://play/<encoded project>/<path>         a file in that project's playground
//   media://kit/<path>                             the playground kit (src/kit), shared by every page
// Range support is required for <video> seeking.

const isMedia = (ext: string): boolean => mediaKind(ext) !== null

// One level of a folder: subfolders and media files, no dotfiles. Unreadable entries are dropped.
export async function browse(dir: string): Promise<BrowseEntry[]> {
  const dirents = await readdir(dir, { withFileTypes: true })
  const entries = await Promise.all(
    dirents
      .filter((d) => !d.name.startsWith('.') && (d.isDirectory() || d.isSymbolicLink() || isMedia(extname(d.name))))
      .map(async (d): Promise<BrowseEntry | null> => {
        try {
          // stat, not the dirent: a symlinked folder should open as a folder.
          const s = await stat(join(dir, d.name))
          if (!s.isDirectory() && !(s.isFile() && isMedia(extname(d.name)))) return null
          return { name: d.name, dir: s.isDirectory(), mtime: s.mtimeMs, size: s.size }
        } catch {
          return null
        }
      })
  )
  return entries.filter((e): e is BrowseEntry => e !== null)
}

// Gives playground pages window.cuckcode; saves and done go through the parent (the renderer).
const BRIDGE = `<script>
window.cuckcode = (() => {
  let n = 0
  const waiting = new Map()
  const root = location.pathname.split('/').slice(0, 3).join('/') + '/'
  addEventListener('message', (e) => {
    const d = e.data
    if (e.source !== parent || !d || d.cuckcode !== 'saved' || !waiting.has(d.id)) return
    const [ok, fail] = waiting.get(d.id)
    waiting.delete(d.id)
    d.error ? fail(new Error(d.error)) : ok()
  })
  return {
    save: (name, data) =>
      new Promise((ok, fail) => {
        const id = ++n
        waiting.set(id, [ok, fail])
        parent.postMessage({ cuckcode: 'save', id, root, name, text: JSON.stringify(data, null, 2) }, '*')
      }),
    // The user finished: cuckcode tells the agent, in words of its own (the page can't pick them).
    done: () => parent.postMessage({ cuckcode: 'done' }, '*'),
    load: (name) =>
      fetch(root + 'data/' + encodeURIComponent(name) + '.json', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
  }
})()
</script>`

// After <head> (or the doctype): anything before the doctype drops the page into quirks mode.
export function withBridge(html: string): string {
  const at = /<head(\s[^>]*)?>/i.exec(html) ?? /<!doctype[^>]*>/i.exec(html)
  const i = at ? at.index + at[0].length : 0
  return html.slice(0, i) + BRIDGE + html.slice(i)
}

// The file a play URL (media://play/<project>/<slot>/…) names, or null if it points outside that
// slot's playground. Symlinks inside it are followed on read, so linked-in images work.
export function playPath(url: URL): string | null {
  const [, id, slot, ...rest] = url.pathname.split('/')
  if (!id || !validSlot(Number(slot))) return null
  return inside(playDir(decodeURIComponent(id), Number(slot)), rest)
}

// The kit file a media://kit/… URL names, or null outside the kit.
export const kitPath = (url: URL, dir = kitDir): string | null => inside(dir, url.pathname.split('/').slice(1))

function inside(dir: string, parts: string[]): string | null {
  const file = normalize(join(dir, ...parts.map(decodeURIComponent)))
  return file.startsWith(dir + '/') ? file : null
}

// Capped by size, not count: a few videos from history would otherwise pin hundreds of MB.
const BLOB_CACHE = 128 * 1024 * 1024
const blobs = new Map<string, Buffer>()
const loading = new Map<string, Promise<Buffer>>()
let cached = 0

export function parseRange(header: string | null, size: number): [number, number] | null {
  const m = header && /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (!m[1] && !m[2])) return null
  let start: number
  let end: number
  if (!m[1]) {
    start = Math.max(0, size - parseInt(m[2], 10))
    end = size - 1
  } else {
    start = parseInt(m[1], 10)
    end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1
  }
  return start <= end && start < size ? [start, end] : null
}

async function load(url: URL): Promise<{ data: Buffer; ext: string }> {
  if (url.host === 'play') {
    const file = playPath(url)
    if (!file) throw new Error('outside playground')
    const ext = extname(file).toLowerCase()
    const data = await readFile(file)
    return { data: ext === '.html' ? Buffer.from(withBridge(data.toString('utf8'))) : data, ext }
  }
  if (url.host === 'kit') {
    const file = kitPath(url)
    if (!file) throw new Error('outside the kit')
    return { data: await readFile(file), ext: extname(file).toLowerCase() }
  }
  const repo = url.searchParams.get('repo') ?? ''
  const blob = url.searchParams.get('blob') ?? ''
  let data = blobs.get(blob)
  if (!data) {
    // A <video> fires several range requests at once; they share one cat-file, and the
    // blob is counted once, or `cached` drifts up for good and the cache stops holding anything.
    let pending = loading.get(blob)
    if (!pending) {
      pending = runBuffer(repo, ['cat-file', 'blob', blob]).finally(() => loading.delete(blob))
      loading.set(blob, pending)
    }
    data = await pending
    if (blobs.has(blob)) return { data, ext: url.searchParams.get('ext') ?? '' }
    blobs.set(blob, data)
    cached += data.length
    // Oldest first, always keeping the one just loaded.
    for (const [k, v] of blobs) {
      if (cached <= BLOB_CACHE || k === blob) break
      blobs.delete(k)
      cached -= v.length
    }
  }
  return { data, ext: url.searchParams.get('ext') ?? '' }
}

// Working-tree files are streamed, only the requested range: a video's first request is an
// open-ended bytes=0-, and buffering it would pull the whole file into main.
async function localResponse(path: string, header: string | null): Promise<Response> {
  const info = await stat(path)
  // A folder would fail mid-stream instead of as a clean 404.
  if (!info.isFile()) throw new Error('not a file')
  const { size } = info
  const range = parseRange(header, size)
  const [start, end] = range ?? [0, size - 1]
  const body =
    size === 0 ? null : (Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>)
  return respond(body, size, range, TYPES[extname(path).toLowerCase()])
}

// The whole thing (200) or the requested range of it (206); `body` is already just that range.
function respond(
  body: BodyInit | null,
  size: number,
  range: [number, number] | null,
  type = 'application/octet-stream',
  extra: Record<string, string> = {}
): Response {
  const [start, end] = range ?? [0, size - 1]
  const headers = { 'Content-Type': type, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes', ...extra }
  if (!range) return new Response(body, { headers })
  return new Response(body, { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}` } })
}

export async function mediaResponse(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url)
    const path = url.host === 'local' && url.searchParams.get('path')
    if (path) return await localResponse(path, request.headers.get('range'))
    const { data, ext } = await load(url)
    // Agents rewrite playground files in place under the same names; the kit changes with updates.
    const fresh: Record<string, string> = url.host === 'play' || url.host === 'kit' ? { 'Cache-Control': 'no-store' } : {}
    const range = parseRange(request.headers.get('range'), data.length)
    const body = (range ? data.subarray(range[0], range[1] + 1) : data) as Uint8Array<ArrayBuffer>
    return respond(body, data.length, range, TYPES[ext], fresh)
  } catch {
    return new Response('Not found', { status: 404 })
  }
}
