import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { installDeps } from './plugins'

// Offline: the dependency is a local tarball, in two versions.

const roots: string[] = []
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })))

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim()

const json = (path: string, value: unknown): void => writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
const pkg = (version: string): { name: string; version: string; dependencies: Record<string, string> } =>
  ({ name: 'plugin', version: '1.0.0', dependencies: { dep: `file:../dep-${version}.tgz` } })

// A plugin repo whose committed lockfile is for dep 1; with `mismatch`, package.json asks for dep 2.
function setup(mismatch: boolean): string {
  const root = mkdtempSync(join(tmpdir(), 'plugindeps-'))
  roots.push(root)
  for (const v of ['1.0.0', '2.0.0']) {
    mkdirSync(join(root, v, 'package'), { recursive: true })
    json(join(root, v, 'package/package.json'), { name: 'dep', version: v })
    execFileSync('tar', ['-czf', join(root, `dep-${v}.tgz`), '-C', join(root, v), 'package'])
  }
  const dir = join(root, 'plugin')
  mkdirSync(dir)
  json(join(dir, 'package.json'), pkg('1.0.0'))
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n')
  execFileSync('npm', ['install', '--package-lock-only', '--no-audit', '--no-fund'], { cwd: dir })
  if (mismatch) json(join(dir, 'package.json'), pkg('2.0.0'))
  git(dir, 'init', '-q')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'Plugin')
  return dir
}

const read = (dir: string): ReturnType<typeof pkg> => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
const installed = (dir: string): string => JSON.parse(readFileSync(join(dir, 'node_modules/dep/package.json'), 'utf8')).version
const stamp = (dir: string): number => statSync(join(dir, 'node_modules/.package-lock.json')).mtimeMs

describe('installDeps', () => {
  it('installs a clone of ours from its lockfile, once', async () => {
    const dir = setup(false)
    expect(await installDeps(dir, read(dir), true)).toBe('')
    expect(installed(dir)).toBe('1.0.0')
    expect(git(dir, 'status', '--porcelain')).toBe('')
    const at = stamp(dir)
    expect(await installDeps(dir, read(dir), true)).toBe('')
    expect(stamp(dir)).toBe(at)
  }, 60_000)

  it('installs a clone of ours whose lockfile is out of date without touching its files, and says so', async () => {
    const dir = setup(true)
    expect(await installDeps(dir, read(dir), true)).toMatch(/out of date/)
    expect(installed(dir)).toBe('2.0.0')
    expect(git(dir, 'status', '--porcelain')).toBe('')
    const at = stamp(dir)
    expect(await installDeps(dir, read(dir), true)).toBe('')
    expect(stamp(dir)).toBe(at)
  }, 60_000)

  it('leaves a folder of your own to npm install, as before', async () => {
    const dir = setup(true)
    expect(await installDeps(dir, read(dir), false)).toBe('')
    expect(installed(dir)).toBe('2.0.0')
    expect(git(dir, 'status', '--porcelain')).toBe('M package-lock.json')
  }, 60_000)
})
