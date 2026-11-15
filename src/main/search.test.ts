import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { SearchQuery } from '../shared/types'
import { replacements, search, write } from './search'

const q = (text: string, opts: Partial<SearchQuery> = {}): SearchQuery => ({
  text,
  regex: false,
  caseSensitive: false,
  word: false,
  ...opts
})

describe('search and replace in a real repo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuckcode-'))
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir }).toString()
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  git('init', '-q', '-b', 'main')
  writeFileSync(join(dir, '.gitignore'), 'ignored.txt\n')
  writeFileSync(join(dir, 'a.txt'), 'foo Foo food\r\nbar $1\n')
  writeFileSync(join(dir, 'b.txt'), 'nothing\n')
  writeFileSync(join(dir, 'ignored.txt'), 'foo\n')
  writeFileSync(join(dir, 'c.bin'), Buffer.from('foo\0'))
  git('add', 'a.txt', '.gitignore')

  it('finds tracked and untracked text files, skipping ignored and binary ones', async () => {
    const r = await search(dir, q('foo'))
    expect(r.files.map((f) => f.path)).toEqual(['a.txt'])
    expect(r.files[0].matches).toEqual([{ line: 1, col: 1, text: 'foo Foo food', ranges: [[0, 3], [4, 7], [8, 11]] }])
  })

  it('honours case, whole word and regex', async () => {
    expect((await search(dir, q('Foo', { caseSensitive: true }))).files[0].matches[0].ranges).toEqual([[4, 7]])
    expect((await search(dir, q('foo', { word: true }))).files[0].matches[0].ranges).toEqual([[0, 3], [4, 7]])
    expect((await search(dir, q('fo+d$', { regex: true }))).files[0].matches[0].ranges).toEqual([[8, 12]])
    expect((await search(dir, q('(', { regex: true }))).error).toBeTruthy()
  })

  it('computes replacements without touching the disk', async () => {
    const r = await replacements(dir, q('foo'), 'x', ['a.txt', 'b.txt'])
    expect(r).toEqual({ count: 3, files: [{ path: 'a.txt', text: 'x x xd\r\nbar $1\n' }] })
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('foo Foo food\r\nbar $1\n')
  })

  it('replaces literally or with groups, keeping CRLF', async () => {
    const replace = async (query: SearchQuery, replacement: string): Promise<number> =>
      write(dir, await replacements(dir, query, replacement, ['a.txt']))
    expect(await replace(q('$1'), '$&')).toBe(1)
    expect(await replace(q('(f)oo', { regex: true, word: true }), '$1u')).toBe(2)
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('fu Fu food\r\nbar $&\n')
  })
})
