import { execFile } from 'node:child_process'
import { open, readFile, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { commitMessage, goodSubject } from './commitmsg'
import { mediaKind } from './mime'
import type { Branches, ChangeCode, ChangedFile, Commit, FileSnapshot, GitOp, GitResult, GitStatus, Midway, PluginGitOp, Remote, RepoStatus } from '../shared/types'

const MAX_TEXT = 4 * 1024 * 1024

// GIT_OPTIONAL_LOCKS=0 stops `git status` from rewriting .git/index, which would
// otherwise trigger the watcher and loop. GIT_TERMINAL_PROMPT=0 makes auth failures
// error out instead of hanging on a prompt nobody can see. Read per call, not at import:
// this module loads before index.ts extends PATH, and hooks and credential helpers need it.
const gitEnv = (): NodeJS.ProcessEnv => ({ ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' })

export function run(cwd: string, args: string[], timeout = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, env: gitEnv(), timeout, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || stdout || err.message).trim()))
      else resolve(stdout)
    })
  })
}

export function runBuffer(cwd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, env: gitEnv(), encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout)
    )
  })
}

function codeOf(xy: string): ChangeCode {
  if (xy.includes('D')) return 'D'
  if (xy.includes('R')) return 'R'
  if (xy.includes('A')) return 'A'
  return 'M'
}

// Parses `git status --porcelain=v2 --branch -z`.
export function parseStatus(out: string): Omit<GitStatus, 'root'> {
  const result: Omit<GitStatus, 'root'> = { head: '', branch: '', ahead: 0, behind: 0, files: [] }
  const entries = out.split('\0')
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (!e) continue
    const parts = e.split(' ')
    switch (parts[0]) {
      case '#':
        if (parts[1] === 'branch.oid') result.head = parts[2] === '(initial)' ? '' : parts[2]
        else if (parts[1] === 'branch.head') result.branch = parts[2] === '(detached)' ? 'detached' : parts[2]
        else if (parts[1] === 'branch.ab') {
          result.ahead = Math.abs(parseInt(parts[2], 10))
          result.behind = Math.abs(parseInt(parts[3], 10))
        }
        break
      case '1':
        result.files.push({ path: parts.slice(8).join(' '), code: codeOf(parts[1]) })
        break
      case '2':
        result.files.push({ path: parts.slice(9).join(' '), code: codeOf(parts[1]), from: entries[++i] })
        break
      case 'u':
        result.files.push({ path: parts.slice(10).join(' '), code: 'M' })
        break
      case '?':
        result.files.push({ path: e.slice(2), code: '?' })
        break
    }
  }
  return result
}

const roots = new Map<string, string>()

async function repoRoot(cwd: string): Promise<string> {
  let root = roots.get(cwd)
  if (root === undefined) {
    root = await run(cwd, ['rev-parse', '--show-toplevel']).then((s) => s.trim(), () => '')
    if (root) roots.set(cwd, root)
  }
  return root
}

export async function status(cwd: string): Promise<GitStatus> {
  const root = await repoRoot(cwd)
  if (!root) return { root: '', head: '', branch: '', ahead: 0, behind: 0, files: [] }
  const out = await run(cwd, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'])
  return { root, ...parseStatus(out) }
}

// Tracked + untracked files, minus ignored ones (so no node_modules), for the file tree.
export async function listFiles(root: string): Promise<string[]> {
  const out = await run(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--deduplicate'])
  return out.split('\0').filter(Boolean)
}

export function isBinary(buf: Buffer): boolean {
  return buf.subarray(0, 8000).includes(0)
}

// rev:path, e.g. HEAD:src/a.ts or abc123^:src/a.ts.
async function blobAt(root: string, spec: string): Promise<string | null> {
  return run(root, ['rev-parse', '--verify', '-q', spec]).then((s) => s.trim() || null, () => null)
}

const blobUrl = (root: string, blob: string, ext: string): string =>
  `media://local/?repo=${encodeURIComponent(root)}&blob=${blob}&ext=${ext}`

function textSnapshot(head: Buffer | null, work: Buffer | null): FileSnapshot {
  if ([head, work].some((b) => b && (b.length > MAX_TEXT || isBinary(b)))) return { kind: 'binary', head: null, work: null }
  return { kind: 'text', head: head?.toString('utf8') ?? null, work: work?.toString('utf8') ?? null }
}

// A file as a past commit changed it: head is its first parent's version, work the commit's.
async function commitSnapshot(root: string, file: ChangedFile, sha: string): Promise<FileSnapshot> {
  const ext = extname(file.path).toLowerCase()
  const before = file.code === 'A' ? null : `${sha}^:${file.from ?? file.path}`
  const after = file.code === 'D' ? null : `${sha}:${file.path}`
  const media = mediaKind(ext)
  if (media) {
    // Same blob, same URL: the renderer shows it alone, as unchanged.
    const [a, b] = await Promise.all([before && blobAt(root, before), after && blobAt(root, after)])
    return { kind: media, head: a && blobUrl(root, a, ext), work: b && blobUrl(root, b, ext) }
  }
  const show = (spec: string | null): Promise<Buffer | null> =>
    spec ? runBuffer(root, ['show', spec]).catch(() => null) : Promise.resolve(null)
  return textSnapshot(...(await Promise.all([show(before), show(after)])))
}

export async function snapshot(root: string, file: ChangedFile): Promise<FileSnapshot> {
  if (file.commit) return commitSnapshot(root, file, file.commit)
  const abs = join(root, file.path)
  const headPath = file.from ?? file.path
  const ext = extname(file.path).toLowerCase()
  const info = await stat(abs).catch(() => null)
  const media = mediaKind(ext)

  if (media) {
    const [blob, workBlob] = await Promise.all([
      blobAt(root, `HEAD:${headPath}`),
      info ? run(root, ['hash-object', '--', file.path]).then((s) => s.trim(), () => null) : null
    ])
    const work = info && `media://local/?path=${encodeURIComponent(abs)}&v=${info.mtimeMs}`
    // Unchanged: the same URL on both sides tells the renderer there's nothing to diff.
    const head = blob && (blob === workBlob ? work : blobUrl(root, blob, ext))
    return { kind: media, head, work }
  }

  // A directory here is a submodule or a nested repo: nothing to show as text.
  if (info && (!info.isFile() || info.size > MAX_TEXT)) return { kind: 'binary', head: null, work: null }
  const [work, head] = await Promise.all([
    info ? readFile(abs).catch(() => null) : null,
    file.code === '?' || file.code === 'A' ? null : runBuffer(root, ['show', `HEAD:${headPath}`]).catch(() => null)
  ])
  return textSnapshot(head, work)
}

const LOG_PAGE = 100

function parseLog(out: string): Commit[] {
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, author, date, subject] = line.split('\x1f')
      return { sha, author, date: Number(date), subject }
    })
}

export async function log(cwd: string, skip: number): Promise<Commit[]> {
  const args = ['log', '-n', String(LOG_PAGE), `--skip=${skip}`, '--format=%H%x1f%an%x1f%at%x1f%s', 'HEAD', '--']
  // No commits yet: HEAD doesn't resolve.
  return parseLog(await run(cwd, args).catch(() => ''))
}

// Parses `--name-status -z`: a status letter (R and C carry a score), then one path, or two for R/C.
export function parseNameStatus(out: string, commit: string): ChangedFile[] {
  const files: ChangedFile[] = []
  const parts = out.split('\0')
  for (let i = 0; i < parts.length - 1; ) {
    const s = parts[i++]
    if (!s) continue
    if (s[0] === 'R' || s[0] === 'C') {
      const from = parts[i++]
      const path = parts[i++]
      files.push(s[0] === 'R' ? { path, code: 'R', from, commit } : { path, code: 'A', commit })
    } else {
      const code: ChangeCode = s === 'A' || s === 'D' ? s : 'M'
      files.push({ path: parts[i++], code, commit })
    }
  }
  return files
}

// Merges show what they brought in over their first parent, as `git log --first-parent -p` would.
export async function commitFiles(root: string, sha: string): Promise<ChangedFile[]> {
  const out = await run(root, ['show', '--format=', '--name-status', '-z', '-M', '--diff-merges=first-parent', sha, '--'])
  return parseNameStatus(out, sha)
}

// Local branches, then branches only on a remote, each most recently committed first.
export function parseBranches(out: string): Omit<Branches, 'remotes'> {
  const local: string[] = []
  const remote = new Set<string>()
  for (const line of out.split('\n')) {
    const [ref, symref] = line.split('\t')
    // A symref is a remote's HEAD pointer, not a branch.
    if (!ref || symref) continue
    if (ref.startsWith('refs/heads/')) local.push(ref.slice('refs/heads/'.length))
    else remote.add(ref.split('/').slice(3).join('/'))
  }
  return { local, remote: [...remote].filter((b) => !local.includes(b)) }
}

// Parses `git config --get-regexp ^remote\..*\.url$`: one `remote.<name>.url <url>` per line.
export function parseRemotes(out: string): Remote[] {
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const space = line.indexOf(' ')
      return { name: line.slice('remote.'.length, space - '.url'.length), url: line.slice(space + 1) }
    })
}

export async function branches(cwd: string): Promise<Branches> {
  const format = '--format=%(refname)%09%(symref)'
  const [refs, remotes] = await Promise.all([
    run(cwd, ['for-each-ref', '--sort=-committerdate', format, 'refs/heads', 'refs/remotes']),
    // Exits 1 when there are no remotes.
    run(cwd, ['config', '--get-regexp', '^remote\\..*\\.url$']).catch(() => '')
  ])
  return { ...parseBranches(refs), remotes: parseRemotes(remotes) }
}

export async function setRemote(cwd: string, name: string, url: string): Promise<GitResult> {
  return queued((await repoRoot(cwd)) || cwd, async () => {
    try {
      const exists = (await run(cwd, ['remote'])).split('\n').includes(name)
      await run(cwd, ['remote', exists ? 'set-url' : 'add', name, url])
      return { ok: true, output: `${name} → ${url}` }
    } catch (err) {
      return { ok: false, output: (err as Error).message }
    }
  })
}

// Cheaper than a full status, which scans the whole working tree.
const hasUpstream = (cwd: string): Promise<boolean> =>
  run(cwd, ['rev-parse', '--verify', '-q', '@{u}']).then(() => true, () => false)

// --follow-tags carries release tags (vX.Y.Z) along with the commits they mark.
async function push(cwd: string): Promise<void> {
  if (await hasUpstream(cwd)) {
    await run(cwd, ['push', '--follow-tags'], 60_000)
    return
  }
  const remotes = (await run(cwd, ['remote'])).split('\n').filter(Boolean)
  const remote = remotes.includes('origin') ? 'origin' : remotes[0]
  if (!remote) throw new Error('No remote configured.')
  await run(cwd, ['push', '--follow-tags', '-u', remote, 'HEAD'], 60_000)
}

// A rebase or merge git stopped in the middle of (a conflict), or null.
async function midway(cwd: string): Promise<Midway> {
  const paths = (await run(cwd, ['rev-parse', '--path-format=absolute', '--git-path', 'rebase-merge', '--git-path', 'rebase-apply', '--git-path', 'MERGE_HEAD']))
    .trim()
    .split('\n')
  const [merge, apply, mergeHead] = await Promise.all(paths.map((p) => stat(p).then(() => true, () => false)))
  return merge || apply ? 'rebase' : mergeHead ? 'merge' : null
}

const rebasing = async (cwd: string): Promise<boolean> => (await midway(cwd)) === 'rebase'

// status, plus whether a rebase or merge is in progress.
export async function repoStatus(cwd: string): Promise<RepoStatus> {
  const s = await status(cwd)
  return { ...s, midway: s.root ? await midway(cwd) : null }
}

const hasRemote = async (cwd: string): Promise<boolean> => !!(await run(cwd, ['remote']).catch(() => '')).trim()

// One op per repo at a time. Overlapping syncs (launch, quit, closing a tab, the panels)
// race on the fetch and the rebase, and then both fail with nothing pushed.
const queues = new Map<string, Promise<unknown>>()

function queued<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const next = (queues.get(root) ?? Promise.resolve()).then(fn)
  const tail = next.then(
    () => {},
    () => {}
  )
  queues.set(root, tail)
  void tail.then(() => queues.get(root) === tail && queues.delete(root))
  return next
}

async function sync(cwd: string): Promise<void> {
  if (await hasUpstream(cwd)) {
    // A conflicting pull would leave the repo mid-rebase; back out so the tree is as it was
    // (but never abort a rebase the user already had going).
    const before = await rebasing(cwd)
    try {
      await run(cwd, ['pull', '--rebase', '--autostash'], 60_000)
    } catch (err) {
      if (!before && (await rebasing(cwd))) await run(cwd, ['rebase', '--abort']).catch(() => {})
      throw err
    }
  }
  await push(cwd)
}

const firstLine = (s: string): string => s.trim().split('\n')[0]
const lastLine = (s: string): string => s.trim().split('\n').pop() ?? ''

// commitCommand writes aicommit's message (see commitmsg.ts).
export async function op(cwd: string, kind: GitOp, arg = '', commitCommand = ''): Promise<GitResult> {
  return queued((await repoRoot(cwd)) || cwd, () => apply(cwd, kind, arg, commitCommand))
}

// Puts a file back as HEAD has it. New files (and a rename's new name) go to the Trash rather
// than being deleted, so throwing one away is recoverable. trash is passed in: this module
// stays electron-free for the search worker.
export function discard(root: string, file: ChangedFile, trash: (abs: string) => Promise<void>): Promise<GitResult> {
  return queued(root, async () => {
    try {
      const restore = (path: string): Promise<string> => run(root, ['restore', '--source=HEAD', '--staged', '--worktree', '--', path])
      const unstage = (path: string): Promise<string> => run(root, ['rm', '--cached', '-f', '-q', '--ignore-unmatch', '--', path])
      if (file.code === 'M' || file.code === 'D') await restore(file.path)
      else {
        if (file.code === 'R' && file.from) await restore(file.from)
        if (file.code !== '?') await unstage(file.path)
        await trash(join(root, file.path)).catch((err) => {
          if (file.code === '?') throw err
        })
      }
      return { ok: true, output: `Discarded ${file.path}.` }
    } catch (err) {
      return { ok: false, output: (err as Error).message }
    }
  })
}

async function commit(cwd: string, message: string): Promise<GitResult> {
  // Generous: a timeout kills git mid-write (commit hooks can be slow) and strands index.lock.
  await run(cwd, ['add', '-A'], 60_000)
  const committed = firstLine(await run(cwd, ['commit', '-m', message], 60_000))
  // Every commit goes straight up, so the repo never drifts from its remote.
  if (!(await hasRemote(cwd))) return { ok: true, output: committed }
  try {
    await sync(cwd)
  } catch (err) {
    return { ok: false, output: `${committed} — sync failed: ${(err as Error).message}` }
  }
  return { ok: true, output: `${committed} · synced` }
}

const CHANGES_BUDGET = 80_000
const UNTRACKED_CHARS = 4_000

// The first bytes of a file, without reading the rest (an untracked video can be huge); null if unreadable.
async function readStart(path: string, bytes: number): Promise<Buffer | null> {
  const fh = await open(path, 'r').catch(() => null)
  if (!fh) return null
  try {
    const { buffer, bytesRead } = await fh.read(Buffer.alloc(bytes), 0, bytes, 0)
    return buffer.subarray(0, bytesRead)
  } catch {
    return null
  } finally {
    await fh.close().catch(() => {})
  }
}

// What the commit command sees to write a message: the diff against HEAD, the start of each new file,
// and recent subjects for style. Read-only: staging first would touch the index (and the watcher).
async function changes(cwd: string): Promise<string> {
  const root = (await repoRoot(cwd)) || cwd
  const [summary, diff, untracked, log] = await Promise.all([
    run(root, ['diff', 'HEAD', '--stat']).catch(() => ''),
    run(root, ['diff', 'HEAD']).catch(() => ''),
    run(root, ['ls-files', '-z', '--others', '--exclude-standard']).catch(() => ''),
    run(root, ['log', '-n', '15', '--format=%s']).catch(() => '')
  ])
  // A bad subject that got in anyway isn't a style to match.
  const subjects = log.split('\n').filter(goodSubject).slice(0, 10).join('\n')
  let out = `Recent subjects:\n${subjects}\n\n${summary}\n${diff}`
  for (const path of untracked.split('\0').filter(Boolean)) {
    if (out.length > CHANGES_BUDGET) break
    const buf = await readStart(join(root, path), 8000)
    const body = !buf ? '' : isBinary(buf) ? '(binary)' : buf.subarray(0, UNTRACKED_CHARS).toString('utf8')
    out += `\nNew file ${path}:\n${body}\n`
  }
  return out.length > CHANGES_BUDGET ? out.slice(0, CHANGES_BUDGET) + '\n(truncated)' : out
}

// A message the commit command writes for the changes, without committing: aicommit's first half,
// for a commit that shows its message before making it. Queued like the ops, so it never reads a
// repo halfway through one of them.
export async function draft(cwd: string, commitCommand: string): Promise<GitResult> {
  return queued((await repoRoot(cwd)) || cwd, async () => {
    try {
      const s = await status(cwd)
      if (!s.root) return { ok: false, output: 'Not a git repository.' }
      if (!s.files.length) return { ok: false, output: 'Nothing to commit.' }
      return { ok: true, output: await commitMessage(commitCommand, cwd, await changes(cwd)) }
    } catch (err) {
      return { ok: false, output: (err as Error).message }
    }
  })
}

const PLUGIN_OPS: PluginGitOp[] = ['draft', 'commit', 'sync', 'push', 'pull']

// What RendererHost.git runs: the git panel's own ops, plus draft. The caller has checked the folder.
export function pluginOp(cwd: string, kind: PluginGitOp, message: string, commitCommand: string): Promise<GitResult> {
  if (!PLUGIN_OPS.includes(kind)) return Promise.resolve({ ok: false, output: `Not a plugin git op: ${kind}` })
  if (kind === 'draft') return draft(cwd, commitCommand)
  // An empty message would fail only after add -A had staged everything.
  if (kind === 'commit' && !message.trim()) return Promise.resolve({ ok: false, output: 'No commit message.' })
  return op(cwd, kind, message.trim())
}

async function apply(cwd: string, kind: GitOp, arg: string, commitCommand: string): Promise<GitResult> {
  // git would read a name starting with - as an option.
  if ((kind === 'switch' || kind === 'branch') && (!arg || arg.startsWith('-'))) return { ok: false, output: `Not a branch name: ${arg}` }
  try {
    switch (kind) {
      case 'commit':
        return await commit(cwd, arg)
      case 'aicommit':
        return await commit(cwd, await commitMessage(commitCommand, cwd, await changes(cwd)))
      case 'pull':
        return { ok: true, output: lastLine(await run(cwd, ['pull'], 60_000)) }
      case 'push':
        await push(cwd)
        return { ok: true, output: 'Pushed.' }
      case 'sync':
        await sync(cwd)
        return { ok: true, output: 'Synced.' }
      case 'switch':
        await run(cwd, ['switch', arg], 60_000)
        return { ok: true, output: `On ${arg}.` }
      case 'branch':
        await run(cwd, ['switch', '-c', arg])
        return { ok: true, output: `Created ${arg}.` }
    }
  } catch (err) {
    return { ok: false, output: (err as Error).message }
  }
}
