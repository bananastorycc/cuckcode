import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// A scratch HOME, so git config and the projects folder stay out of the real one.
const home = mkdtempSync(join(tmpdir(), 'cuckcode-repos-'))
const env = { ...process.env }
let repos: typeof import('./repos')

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' })

beforeAll(async () => {
  Object.assign(process.env, {
    HOME: home,
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@t'
  })
  repos = await import('./repos')
})

afterAll(() => {
  process.env = env
  rmSync(home, { recursive: true, force: true })
})

describe('repos', () => {
  it('lists folders in the projects folder, not files or dotfolders', async () => {
    mkdirSync(join(home, 'repos/b'), { recursive: true })
    mkdirSync(join(home, 'repos/A'))
    mkdirSync(join(home, 'repos/.hidden'))
    writeFileSync(join(home, 'repos/file'), '')
    expect(await repos.list(join(home, 'repos'))).toEqual([join(home, 'repos/A'), join(home, 'repos/b')])
  })

  it('inits an empty remote and pushes a first commit to main', async () => {
    const remote = join(home, 'empty.git')
    git(home, 'init', '--bare', '-q', remote)
    const dir = await repos.setUp(join(home, 'repos'), remote, 'fresh')
    expect(dir).toBe(join(home, 'repos/fresh'))
    expect(git(remote, 'branch', '--format=%(refname:short)').trim()).toBe('main')
    expect(git(dir, 'rev-parse', '--abbrev-ref', '@{u}').trim()).toBe('origin/main')
  })

  it('clones a remote that has commits', async () => {
    const remote = join(home, 'empty.git')
    const dir = await repos.setUp(join(home, 'repos'), remote, 'copy')
    expect(git(dir, 'log', '--format=%s').trim()).toBe('Initial commit')
    await expect(repos.setUp(join(home, 'repos'), remote, 'copy')).rejects.toThrow('already exists')
  })

  it('cleans up when the push fails', async () => {
    await expect(repos.setUp(join(home, 'repos'), join(home, 'nowhere.git'), 'broken')).rejects.toThrow()
    expect(await repos.list(join(home, 'repos'))).not.toContain(join(home, 'repos/broken'))
  })
})

describe('pluginReach', () => {
  const projects = ['/p/open', '/elsewhere/one']
  it('takes open projects and folders in them, and folders in the projects folder', () => {
    expect(repos.pluginReach('/p/open', projects, '/r')).toBe(true)
    expect(repos.pluginReach('/p/open/sub', projects, '/r')).toBe(true)
    expect(repos.pluginReach('/r/any', projects, '/r')).toBe(true)
    expect(repos.pluginReach('/r/any/', projects, '/r/')).toBe(true)
  })

  it('refuses everything else', () => {
    expect(repos.pluginReach('/p/opener', projects, '/r')).toBe(false)
    expect(repos.pluginReach('/p', projects, '/r')).toBe(false)
    expect(repos.pluginReach('/r/../home', projects, '/r')).toBe(false)
    expect(repos.pluginReach('r/any', projects, '/r')).toBe(false)
    expect(repos.pluginReach('/r/any', projects, '')).toBe(false)
  })
})
