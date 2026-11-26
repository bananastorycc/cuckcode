import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { branches, commitFiles, discard, log, op, parseBranches, parseNameStatus, parseRemotes, parseStatus, pluginOp, repoStatus, setRemote, snapshot, status } from './git'

describe('parseStatus', () => {
  it('parses branch, ahead/behind and every entry type', () => {
    const out = [
      '# branch.oid abc',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 aaa bbb src/with space.ts',
      '1 A. N... 000000 100644 100644 000 ccc added.ts',
      '1 .D N... 100644 100644 000000 ddd ddd gone.ts',
      '2 R. N... 100644 100644 100644 eee eee R100 new.ts',
      'old.ts',
      '? untracked.txt',
      ''
    ].join('\0')
    expect(parseStatus(out)).toEqual({
      head: 'abc',
      branch: 'main',
      ahead: 2,
      behind: 1,
      files: [
        { path: 'src/with space.ts', code: 'M' },
        { path: 'added.ts', code: 'A' },
        { path: 'gone.ts', code: 'D' },
        { path: 'new.ts', code: 'R', from: 'old.ts' },
        { path: 'untracked.txt', code: '?' }
      ]
    })
  })

  it('reports a detached head', () => {
    expect(parseStatus('# branch.head (detached)\0').branch).toBe('detached')
  })

  it('has no head before the first commit', () => {
    expect(parseStatus('# branch.oid (initial)\0# branch.head main\0').head).toBe('')
  })
})

describe('parseNameStatus', () => {
  it('parses every status, renames carrying both paths', () => {
    const out = ['M', 'a b.ts', 'A', 'new.ts', 'D', 'gone.ts', 'R087', 'old.ts', 'moved.ts', 'T', 'link', ''].join('\0')
    expect(parseNameStatus(out, 'abc')).toEqual([
      { path: 'a b.ts', code: 'M', commit: 'abc' },
      { path: 'new.ts', code: 'A', commit: 'abc' },
      { path: 'gone.ts', code: 'D', commit: 'abc' },
      { path: 'moved.ts', code: 'R', from: 'old.ts', commit: 'abc' },
      { path: 'link', code: 'M', commit: 'abc' }
    ])
  })
})

describe('parseBranches', () => {
  it('lists local branches, then remote-only ones, skipping remote HEADs', () => {
    const out = [
      'refs/heads/main\t',
      'refs/remotes/origin/HEAD\trefs/remotes/origin/main',
      'refs/remotes/origin/main\t',
      'refs/remotes/origin/feat/x\t',
      'refs/heads/wip\t',
      'refs/remotes/backup/feat/x\t',
      ''
    ].join('\n')
    expect(parseBranches(out)).toEqual({ local: ['main', 'wip'], remote: ['feat/x'] })
  })
})

describe('parseRemotes', () => {
  it('reads each remote name and URL, dots in names included', () => {
    const out = 'remote.origin.url git@github.com:a/b.git\nremote.my.fork.url https://example.com/b.git\n'
    expect(parseRemotes(out)).toEqual([
      { name: 'origin', url: 'git@github.com:a/b.git' },
      { name: 'my.fork', url: 'https://example.com/b.git' }
    ])
  })
})

describe('against a real repo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuckcode-'))
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir }).toString()
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 'test')
  git('config', 'user.email', 'test@test')
  writeFileSync(join(dir, 'a.txt'), 'one\n')
  git('add', '.')
  git('commit', '-qm', 'init')

  it('snapshots HEAD vs working tree and commits', async () => {
    writeFileSync(join(dir, 'a.txt'), 'two\n')
    writeFileSync(join(dir, 'b.bin'), Buffer.from([1, 0, 2]))

    const s = await status(dir)
    expect(s.branch).toBe('main')
    expect(s.files.map((f) => f.code + f.path)).toEqual(['Ma.txt', '?b.bin'])

    expect(await snapshot(s.root, s.files[0])).toEqual({ kind: 'text', head: 'one\n', work: 'two\n' })
    expect((await snapshot(s.root, s.files[1])).kind).toBe('binary')

    expect((await op(dir, 'commit', 'msg')).ok).toBe(true)
    expect((await status(dir)).files).toEqual([])
    expect((await op(dir, 'push')).output).toBe('No remote configured.')
  })

  it('creates and switches branches', async () => {
    expect(await op(dir, 'branch', 'feat')).toEqual({ ok: true, output: 'Created feat.' })
    expect((await status(dir)).branch).toBe('feat')
    expect((await branches(dir)).local.sort()).toEqual(['feat', 'main'])
    expect((await op(dir, 'switch', 'main')).ok).toBe(true)
    expect((await status(dir)).branch).toBe('main')
    expect((await op(dir, 'branch', 'bad name')).ok).toBe(false)
  })

  it('adds a remote, then changes its URL', async () => {
    expect((await branches(dir)).remotes).toEqual([])
    expect((await setRemote(dir, 'origin', '/nowhere/a.git')).ok).toBe(true)
    expect((await setRemote(dir, 'origin', '/nowhere/b.git')).ok).toBe(true)
    expect((await branches(dir)).remotes).toEqual([{ name: 'origin', url: '/nowhere/b.git' }])
    // Later commits here would try to push to it.
    git('remote', 'remove', 'origin')
  })

  it('lists history and snapshots files as each commit changed them', async () => {
    const commits = await log(dir, 0)
    expect(commits.map((c) => c.subject)).toEqual(['msg', 'init'])
    expect((await status(dir)).head).toBe(commits[0].sha)

    const [file] = await commitFiles(dir, commits[0].sha)
    expect(file).toEqual({ path: 'a.txt', code: 'M', commit: commits[0].sha })
    expect(await snapshot(dir, file)).toEqual({ kind: 'text', head: 'one\n', work: 'two\n' })

    // The root commit has no parent to diff against.
    const [first] = await commitFiles(dir, commits[1].sha)
    expect(first.code).toBe('A')
    expect(await snapshot(dir, first)).toEqual({ kind: 'text', head: null, work: 'one\n' })
    expect(await log(dir, 2)).toEqual([])
  })

  it('snapshots a nested repo directory as non-text', async () => {
    mkdirSync(join(dir, 'nested'))
    expect((await snapshot(dir, { path: 'nested/', code: '?' })).kind).toBe('binary')
  })

  it('discards each kind of change back to HEAD', async () => {
    rmSync(join(dir, 'b.bin'))
    writeFileSync(join(dir, 'new.txt'), 'new\n')
    // A staged rename (porcelain only reports renames in the index).
    git('mv', 'a.txt', 'moved.txt')
    git('commit', '-qm', 'move')
    git('mv', 'moved.txt', 'renamed.txt')

    const trashed: string[] = []
    const trash = async (abs: string): Promise<void> => {
      trashed.push(abs)
      rmSync(abs)
    }
    const s = await status(dir)
    expect(s.files.map((f) => f.code + f.path).sort()).toEqual(['?new.txt', 'Db.bin', 'Rrenamed.txt'])
    for (const f of s.files) expect(await discard(dir, f, trash)).toEqual({ ok: true, output: `Discarded ${f.path}.` })
    expect((await status(dir)).files).toEqual([])
    expect(trashed.sort()).toEqual([join(dir, 'new.txt'), join(dir, 'renamed.txt')])
  })

  it('discards a modified and a newly added file', async () => {
    writeFileSync(join(dir, 'moved.txt'), 'changed\n')
    writeFileSync(join(dir, 'added.txt'), 'added\n')
    git('add', 'added.txt')
    const s = await status(dir)
    expect(s.files.map((f) => f.code + f.path).sort()).toEqual(['Aadded.txt', 'Mmoved.txt'])
    for (const f of s.files) expect((await discard(dir, f, async (abs) => rmSync(abs))).ok).toBe(true)
    expect((await status(dir)).files).toEqual([])
  })
})

describe('overlapping syncs', () => {
  const base = mkdtempSync(join(tmpdir(), 'cuckcode-'))
  const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd }).toString()
  afterAll(() => rmSync(base, { recursive: true, force: true }))

  const commit = (cwd: string, name: string): void => {
    writeFileSync(join(cwd, name), name)
    git(cwd, 'add', '.')
    git(cwd, 'commit', '-qm', name)
  }

  it('both land when they hit the same repo at once', async () => {
    git(base, 'init', '-q', '--bare', '-b', 'main', 'origin.git')
    git(base, 'clone', '-q', 'origin.git', 'a')
    git(base, 'clone', '-q', 'origin.git', 'b')
    const [a, b] = [join(base, 'a'), join(base, 'b')]
    for (const d of [a, b]) {
      git(d, 'config', 'user.name', 'test')
      git(d, 'config', 'user.email', 'test@test')
    }
    commit(a, 'base')
    git(a, 'push', '-q', '-u', 'origin', 'main')
    git(b, 'pull', '-q')
    commit(b, 'theirs')
    git(b, 'push', '-q')
    commit(a, 'ours')

    // Unqueued, one loses the ref lock and the other can't rebase; nothing gets pushed.
    const results = await Promise.all([op(a, 'sync'), op(a, 'sync')])
    expect(results.map((r) => r.ok)).toEqual([true, true])
    expect(git(a, 'rev-list', '--count', '@{u}..HEAD').trim()).toBe('0')
  })
})

describe('git for plugins', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuckcode-'))
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir, stdio: 'pipe' }).toString()
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 'test')
  git('config', 'user.email', 'test@test')
  writeFileSync(join(dir, 'a.txt'), 'one\n')
  git('add', '.')
  git('commit', '-qm', 'Add a')

  const head = (): string => git('log', '-1', '--format=%s').trim()

  it('drafts a message without committing, then commits the one it was given', async () => {
    writeFileSync(join(dir, 'a.txt'), 'two\n')
    // The changes arrive on stdin; the message is the command's output.
    const command = "grep -q '^+two' && printf '<message>Change a to two</message>'"
    expect(await pluginOp(dir, 'draft', '', command)).toEqual({ ok: true, output: 'Change a to two' })
    expect(head()).toBe('Add a')
    expect((await status(dir)).files).toEqual([{ path: 'a.txt', code: 'M' }])

    expect(await pluginOp(dir, 'commit', '  ', '')).toEqual({ ok: false, output: 'No commit message.' })
    expect((await pluginOp(dir, 'commit', 'Edited by hand\n', '')).ok).toBe(true)
    expect(head()).toBe('Edited by hand')
    expect((await status(dir)).files).toEqual([])
  })

  it('says why there is no draft', async () => {
    expect(await pluginOp(dir, 'draft', '', 'echo x')).toEqual({ ok: false, output: 'Nothing to commit.' })
    writeFileSync(join(dir, 'b.txt'), 'b\n')
    expect(await pluginOp(dir, 'draft', '', '')).toEqual({ ok: false, output: 'No commit command set (Settings › Git).' })
    expect((await pluginOp(dir, 'draft', '', 'exit 3')).ok).toBe(false)
    const outside = mkdtempSync(join(tmpdir(), 'cuckcode-'))
    expect(await pluginOp(outside, 'draft', '', 'echo x')).toEqual({ ok: false, output: 'Not a git repository.' })
    rmSync(outside, { recursive: true })
    rmSync(join(dir, 'b.txt'))
  })

  it('refuses ops plugins are not given', async () => {
    expect((await pluginOp(dir, 'switch' as never, 'other', '')).ok).toBe(false)
    expect((await status(dir)).branch).toBe('main')
  })

  it('reports a merge or rebase stopped on a conflict', async () => {
    expect((await repoStatus(dir)).midway).toBeNull()
    git('switch', '-qc', 'other')
    writeFileSync(join(dir, 'a.txt'), 'theirs\n')
    git('commit', '-qam', 'Theirs')
    git('switch', '-q', 'main')
    writeFileSync(join(dir, 'a.txt'), 'ours\n')
    git('commit', '-qam', 'Ours')

    expect(() => git('merge', 'other')).toThrow()
    expect(await repoStatus(dir)).toMatchObject({ branch: 'main', midway: 'merge' })
    git('merge', '--abort')

    expect(() => git('rebase', 'other')).toThrow()
    expect((await repoStatus(dir)).midway).toBe('rebase')
    git('rebase', '--abort')
    expect((await repoStatus(dir)).midway).toBeNull()
  })

  it('has nothing midway outside a repo', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'cuckcode-'))
    expect(await repoStatus(outside)).toMatchObject({ root: '', midway: null })
    rmSync(outside, { recursive: true })
  })
})
