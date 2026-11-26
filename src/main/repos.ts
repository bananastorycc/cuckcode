import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { run } from './git'

// root is the projects folder from settings: opening a project picks from it, and making one puts it there.

const tildify = (path: string): string => (path.startsWith(`${homedir()}/`) ? `~${path.slice(homedir().length)}` : path)

export async function list(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => join(root, e.name))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

// A remote with commits is cloned. An empty one gets a fresh repo: init on main, an empty first
// commit, pushed with upstream set, so every later commit and sync just works.
export async function setUp(root: string, remote: string, name: string): Promise<string> {
  if (!/^[\w.-]+$/.test(name) || name.startsWith('.')) throw new Error(`Bad folder name: ${name}`)
  const dir = join(root, name)
  if (await stat(dir).then(() => true, () => false)) throw new Error(`${tildify(dir)} already exists.`)
  await mkdir(root, { recursive: true })
  const refs = await run(root, ['ls-remote', '--', remote], 60_000)
  try {
    if (refs.trim()) {
      await run(root, ['clone', '--', remote, name], 600_000)
      return dir
    }
    await mkdir(dir)
    await run(dir, ['init', '-b', 'main'])
    await run(dir, ['remote', 'add', '--', 'origin', remote])
    await run(dir, ['commit', '--allow-empty', '-m', 'Initial commit'])
    await run(dir, ['push', '-u', 'origin', 'main'], 60_000)
  } catch (err) {
    // Half set up is worse than nothing: the retry would hit "already exists". git cleans up a
    // failed clone itself, but not one killed by the timeout.
    await rm(dir, { recursive: true, force: true })
    throw err
  }
  return dir
}

// Where a plugin may run git: an open project or a folder in one, or a folder in the projects
// folder. A plugin's bad path then can't add -A and push some other repo, such as one at home.
export function pluginReach(dir: string, projects: string[], projectsDir: string): boolean {
  if (!isAbsolute(dir)) return false
  const d = resolve(dir)
  const within = (root: string): boolean => isAbsolute(root) && (d === resolve(root) || d.startsWith(`${resolve(root)}/`))
  return projects.some(within) || (!!projectsDir && within(projectsDir))
}
