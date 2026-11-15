import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { browse, mediaResponse, parseRange, playPath, withBridge } from './media'
import { validName } from './playground'

describe('parseRange', () => {
  it('handles open, closed, suffix and invalid ranges', () => {
    expect(parseRange('bytes=0-', 100)).toEqual([0, 99])
    expect(parseRange('bytes=10-19', 100)).toEqual([10, 19])
    expect(parseRange('bytes=90-500', 100)).toEqual([90, 99])
    expect(parseRange('bytes=-10', 100)).toEqual([90, 99])
    expect(parseRange('bytes=200-', 100)).toBeNull()
    expect(parseRange(null, 100)).toBeNull()
  })
})

describe('playground', () => {
  const play = (path: string): string | null => playPath(new URL(`media://play/${encodeURIComponent('/p/x y')}/2/${path}`))

  it('maps URLs into the playground and nowhere else', () => {
    expect(play('index.html')).toBe('/p/x y/.cuckcode/playground/2/index.html')
    expect(play('img/a%20b.png')).toBe('/p/x y/.cuckcode/playground/2/img/a b.png')
    expect(play('..%2F..%2Fsecret')).toBeNull()
    expect(play('%2E%2E/%2E%2E/secret')).toBeNull()
    expect(play('')).toBeNull()
    expect(playPath(new URL('media://play/%2Fp/11/index.html'))).toBeNull()
    expect(playPath(new URL('media://play/%2Fp/x/index.html'))).toBeNull()
  })

  it('injects the bridge after <head>, never before the doctype', () => {
    expect(withBridge('<!doctype html><html><head><title>t</title>')).toMatch(/^<!doctype html><html><head><script>/)
    expect(withBridge('<!DOCTYPE html><p>hi')).toMatch(/^<!DOCTYPE html><script>/)
    expect(withBridge('<p>hi')).toMatch(/^<script>/)
    expect(withBridge('<header>x</header>')).toMatch(/^<script>/)
  })

  it('accepts only plain names for saved data', () => {
    expect(validName('review-1.final')).toBe(true)
    expect(validName('../x')).toBe(false)
    expect(validName('a/b')).toBe(false)
    expect(validName('')).toBe(false)
  })
})

describe('local files', () => {
  it('serves a requested range of a working file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cuckcode-media-'))
    const file = join(dir, 'clip.webm')
    await writeFile(file, '0123456789')
    const url = `media://local/?path=${encodeURIComponent(file)}&v=1`

    const part = await mediaResponse(new Request(url, { headers: { range: 'bytes=2-5' } }))
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(part.headers.get('content-type')).toBe('video/webm')
    expect(await part.text()).toBe('2345')

    const whole = await mediaResponse(new Request(url))
    expect(whole.status).toBe(200)
    expect(await whole.text()).toBe('0123456789')
  })

  it('404s a folder or a missing file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cuckcode-media-'))
    for (const path of [dir, join(dir, 'gone.png')]) {
      const res = await mediaResponse(new Request(`media://local/?path=${encodeURIComponent(path)}`))
      expect(res.status).toBe(404)
    }
  })

  it('lists subfolders and media only', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cuckcode-browse-'))
    await mkdir(join(dir, 'sub'))
    await mkdir(join(dir, '.hidden'))
    for (const name of ['a.png', 'b.WEBP', 'c.webm', 'notes.txt', '.d.png']) await writeFile(join(dir, name), 'x')
    const names = (await browse(dir)).map((e) => `${e.name}${e.dir ? '/' : ''}`).sort()
    expect(names).toEqual(['a.png', 'b.WEBP', 'c.webm', 'sub/'])
  })
})
