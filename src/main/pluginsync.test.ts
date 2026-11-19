import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { syncToUpstream } from './pluginsync'

const roots: string[] = []
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })))

const sh = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8' }).trim()

// An upstream (bare), the author's working copy that pushes to it, and an installed clone.
function setup(): { author: string; clone: string } {
  const root = mkdtempSync(join(tmpdir(), 'pluginsync-'))
  roots.push(root)
  const [bare, author, clone] = ['up.git', 'author', 'clone'].map((n) => join(root, n))
  sh(root, 'init', '-q', '--bare', bare)
  sh(root, 'clone', '-q', bare, author)
  commit(author, 'a.txt', '1', 'First')
  sh(author, 'push', '-q', 'origin', 'HEAD:main')
  sh(root, 'clone', '-q', bare, clone)
  return { author, clone }
}

function commit(cwd: string, file: string, text: string, message: string): void {
  writeFileSync(join(cwd, file), text)
  sh(cwd, 'add', file)
  sh(cwd, 'commit', '-q', '-m', message)
}

describe('syncToUpstream', () => {
  it('fast-forwards, and says nothing when there was nothing new', async () => {
    const { author, clone } = setup()
    expect(await syncToUpstream(clone, true)).toBe('')
    commit(author, 'a.txt', '2', 'Second')
    sh(author, 'push', '-q')
    expect(await syncToUpstream(clone, true)).toMatch(/^Updated to \w+ Second$/)
  })

  it('realigns a clone whose upstream was reworded and force-pushed', async () => {
    const { author, clone } = setup()
    commit(author, 'a.txt', '2', 'Second, badly worded')
    sh(author, 'push', '-q')
    await syncToUpstream(clone, true)
    sh(author, 'commit', '-q', '--amend', '-m', 'Second')
    commit(author, 'b.txt', '3', 'Third')
    sh(author, 'push', '-q', '--force')
    await expect(syncToUpstream(clone, false)).rejects.toThrow() // not ours to realign
    expect(await syncToUpstream(clone, true)).toMatch(/^Updated to \w+ Third \(its history was rewritten upstream/)
    expect(sh(clone, 'rev-parse', 'HEAD')).toBe(sh(author, 'rev-parse', 'HEAD'))
  })

  it('leaves a clone with a commit of its own, or local changes, where it is', async () => {
    const { author, clone } = setup()
    commit(clone, 'mine.txt', 'x', 'Mine')
    commit(author, 'a.txt', '2', 'Second')
    sh(author, 'push', '-q')
    const mine = sh(clone, 'rev-parse', 'HEAD')
    await expect(syncToUpstream(clone, true)).rejects.toThrow()
    expect(sh(clone, 'rev-parse', 'HEAD')).toBe(mine)

    const other = setup()
    commit(other.author, 'a.txt', '2', 'Second, badly worded')
    sh(other.author, 'push', '-q')
    await syncToUpstream(other.clone, true)
    sh(other.author, 'commit', '-q', '--amend', '-m', 'Second')
    sh(other.author, 'push', '-q', '--force')
    writeFileSync(join(other.clone, 'a.txt'), 'edited')
    await expect(syncToUpstream(other.clone, true)).rejects.toThrow()
    expect(sh(other.clone, 'status', '--porcelain')).toBe('M a.txt')
  })
})
