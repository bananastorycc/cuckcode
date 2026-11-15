import { chmodSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { writeAtomic } from './atomic'

const dir = mkdtempSync(join(tmpdir(), 'cuckcode-atomic-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('writeAtomic', () => {
  it('creates a new file and leaves no temp file behind', async () => {
    await writeAtomic(join(dir, 'new.txt'), 'hello')
    expect(readFileSync(join(dir, 'new.txt'), 'utf8')).toBe('hello')
    expect(readdirSync(dir)).toEqual(['new.txt'])
  })

  it('keeps permissions', async () => {
    const p = join(dir, 'run.sh')
    writeFileSync(p, 'old')
    chmodSync(p, 0o755)
    await writeAtomic(p, 'new')
    expect(statSync(p).mode & 0o777).toBe(0o755)
    expect(readFileSync(p, 'utf8')).toBe('new')
  })

  it('writes through a symlink, keeping the link', async () => {
    const real = join(dir, 'real.txt')
    const link = join(dir, 'link.txt')
    writeFileSync(real, 'old')
    symlinkSync(real, link)
    await writeAtomic(link, 'new')
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readFileSync(real, 'utf8')).toBe('new')
  })

  it('refuses a read-only file, as a plain write would', async () => {
    const p = join(dir, 'locked.txt')
    writeFileSync(p, 'old')
    chmodSync(p, 0o444)
    await expect(writeAtomic(p, 'new')).rejects.toThrow()
    expect(readFileSync(p, 'utf8')).toBe('old')
    chmodSync(p, 0o644)
  })
})
