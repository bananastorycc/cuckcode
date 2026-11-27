import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { BUILD, HOST_MODULES } from '../shared/plugin'
import { installDeps, PLUGIN_API, stale } from './plugins'

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

  it('leaves a folder of your own to npm install, as before, once', async () => {
    const dir = setup(true)
    expect(await installDeps(dir, read(dir), false)).toBe('')
    expect(installed(dir)).toBe('2.0.0')
    expect(git(dir, 'status', '--porcelain')).toBe('M package-lock.json')
    const at = stamp(dir)
    expect(await installDeps(dir, read(dir), false)).toBe('')
    expect(stamp(dir)).toBe(at)
  }, 60_000)

  it('reinstalls a plugin without a lockfile when its package.json changes', async () => {
    const dir = setup(false)
    rmSync(join(dir, 'package-lock.json'))
    git(dir, 'commit', '-q', '-am', 'No lockfile')
    expect(await installDeps(dir, read(dir), true)).toBe('')
    expect(installed(dir)).toBe('1.0.0')
    json(join(dir, 'package.json'), pkg('2.0.0'))
    later(join(dir, 'package.json'), 10)
    expect(await installDeps(dir, read(dir), true)).toBe('')
    expect(installed(dir)).toBe('2.0.0')
  }, 60_000)
})

// Sets path's mtime s seconds from now.
function later(path: string, s: number): void {
  const t = Date.now() / 1000 + s
  utimesSync(path, t, t)
}

describe('build staleness', () => {
  const m = { id: 'x', name: 'x', main: 'dist/main.js', renderer: 'dist/renderer.js' }
  // A plugin whose bundles are newer than everything else.
  function built(): string {
    const dir = mkdtempSync(join(tmpdir(), 'pluginbuild-'))
    roots.push(dir)
    for (const d of ['src', 'dist', 'node_modules']) mkdirSync(join(dir, d))
    for (const f of ['cuckcode-plugin.json', 'package.json', 'package-lock.json', 'build.mjs', 'tsconfig.json', 'README.md', 'src/a.ts', 'node_modules/.package-lock.json'])
      writeFileSync(join(dir, f), '{}')
    for (const f of ['dist/main.js', 'dist/renderer.js']) {
      writeFileSync(join(dir, f), '')
      later(join(dir, f), 60)
    }
    return dir
  }

  it('keeps bundles newer than their inputs', async () => {
    const dir = built()
    expect(await stale(dir, m)).toBe(false)
    // Not something the build reads.
    later(join(dir, 'README.md'), 120)
    expect(await stale(dir, m)).toBe(false)
  })

  it('rebuilds when only the lockfile changed', async () => {
    const dir = built()
    later(join(dir, 'package-lock.json'), 120)
    expect(await stale(dir, m)).toBe(true)
  })

  it('rebuilds when the build script, tsconfig, installed dependencies or sources changed', async () => {
    for (const f of ['build.mjs', 'tsconfig.json', 'node_modules/.package-lock.json', 'src/a.ts', 'package.json', 'cuckcode-plugin.json']) {
      const dir = built()
      later(join(dir, f), 120)
      expect(await stale(dir, m), f).toBe(true)
    }
  })

  it('builds a bundle that is missing', async () => {
    const dir = built()
    rmSync(join(dir, 'dist/renderer.js'))
    expect(await stale(dir, m)).toBe(true)
  })
})

describe('the plugin entry', () => {
  // What a build gets as $CUCKCODE_PLUGIN_API, and the path authors' tsconfigs map cuckcode/plugin to.
  it('is the repo root plugin.ts, with the build recipe', async () => {
    expect(PLUGIN_API).toBe(join(__dirname, '../../plugin.ts'))
    const api = await import(PLUGIN_API)
    expect(api.BUILD).toEqual(BUILD)
    expect(api.HOST_MODULES).toEqual(HOST_MODULES)
  })
})
