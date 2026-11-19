import { run as git } from './git'

// Brings a plugin clone up to its upstream: a fast-forward when it can. When the upstream's history
// was rewritten (a reworded or squashed commit, force-pushed), the clone can't fast-forward and would
// stay behind for good, so with `realign` it's moved onto the upstream (reset --hard) instead, but
// only when nothing would be lost: a clean tree, and every local commit's patch
// already upstream, or the clone's files those of an upstream commit. Returns what changed ('' when
// nothing did); throws when it can't update.
export async function syncToUpstream(path: string, realign: boolean, timeout = 30_000): Promise<string> {
  const before = await head(path)
  try {
    await git(path, ['pull', '--ff-only', '-q'], timeout)
  } catch (err) {
    // The pull fetched before it refused; realign only a clone that diverged, never one just offline.
    if (!realign || (await dirty(path)) || !(await diverged(path)) || !(await covered(path))) throw err
    await git(path, ['reset', '-q', '--hard', '@{u}'])
    return `Updated to ${await describe(path)} (its history was rewritten upstream; its own commits were already there)`
  }
  return (await head(path)) !== before ? `Updated to ${await describe(path)}` : ''
}

const head = async (path: string): Promise<string> => (await git(path, ['rev-parse', 'HEAD'])).trim()
const describe = async (path: string): Promise<string> => (await git(path, ['log', '-1', '--format=%h %s'])).trim()
const count = async (path: string, range: string): Promise<number> => Number((await git(path, ['rev-list', '--count', range])).trim())

const dirty = async (path: string): Promise<boolean> => (await git(path, ['status', '--porcelain', '--untracked-files=no'])).trim() !== ''

async function diverged(path: string): Promise<boolean> {
  return (await count(path, '@{u}..HEAD')) > 0 && (await count(path, 'HEAD..@{u}')) > 0
}

// Every local commit is upstream already: the same patch (`git cherry` marks it "-"), or the
// clone's last state is an upstream commit's tree (a squash).
async function covered(path: string): Promise<boolean> {
  const cherry = (await git(path, ['cherry', '@{u}', 'HEAD'])).split('\n').filter(Boolean)
  if (cherry.every((line) => line.startsWith('-'))) return true
  const tree = (await git(path, ['rev-parse', 'HEAD^{tree}'])).trim()
  const trees = (await git(path, ['log', '--format=%T', '@{u}'], 30_000)).split('\n')
  return trees.includes(tree)
}
