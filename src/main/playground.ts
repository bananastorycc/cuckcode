import { appendFile, mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { PlaygroundSlot } from '../shared/types'
import { MAX_SLOTS } from '../shared/types'
import { writeAtomic } from './atomic'
import { run } from './git'

// Per-project folders, one per configured slot, that Claude fills with a page (image reviews,
// forms, previews) cuckcode shows over the whole workspace. Answers the page saves land in data/,
// where Claude reads them back.

export const playDir = (project: string, slot: number): string => join(project, '.cuckcode', 'playground', String(slot))

const slotName = (s: PlaygroundSlot, i: number): string => s.name || `playground ${i + 1}`

// Appended to the system prompt of every claude session cuckcode starts.
export function prompt(project: string, slots: PlaygroundSlot[]): string {
  const one = slots.length === 1
  const dir = one ? playDir(project, 1) : `${join(project, '.cuckcode', 'playground')}/<n>`
  const which = one
    ? `It is called "${slotName(slots[0], 0)}"; its folder is ${dir}.`
    : `There are ${slots.length} of them, each its own folder (<n> below): ${slots.map((s, i) => `${i + 1} = "${slotName(s, i)}"`).join(', ')}. Use the one whose name fits the task, or 1 when none does.`
  return `You are running inside cuckcode, an app that shows a "playground" that fills the window in place of this terminal: a web view for anything you want the user to see or interact with (image or video galleries, review/approval forms, previews, small tools). Use it whenever showing beats describing, without being asked. ${which}

- Write the page to ${dir}/index.html, with any assets beside it (copy or symlink images/videos in; reference them by relative path). Plain HTML/CSS/JS, no build step. It reloads whenever its files change, and the user opens it from its button in the header (a dot appears there when you update it). Tell the user when there's something to look at.
- The page gets window.cuckcode: \`await cuckcode.save(name, data)\` writes data as JSON to ${dir}/data/<name>.json, and \`await cuckcode.load(name)\` returns it (or null). Save on every change and restore with load on page load, so nothing typed is lost to a reload. Never write to data/ yourself while the user is filling it in.
- When the user says they're done in the playground, read ${dir}/data/*.json and act on it.
- The folder is git-ignored (via .git/info/exclude). Overwrite index.html freely for each new task; style it for both light and dark (prefers-color-scheme).`
}

// Newest mtime of the page and its assets (not data/, which the page writes itself, so saving
// a form never reloads it); null when there's no page.
export async function version(project: string, slot: number): Promise<number | null> {
  const dir = playDir(project, slot)
  try {
    let newest = (await stat(join(dir, 'index.html'))).mtimeMs
    const entries = await readdir(dir, { recursive: true })
    const mtimes = await Promise.all(
      entries
        .filter((e) => e !== 'data' && !e.startsWith('data/'))
        .map((e) => stat(join(dir, e)).then((s) => s.mtimeMs, () => 0))
    )
    for (const m of mtimes) newest = Math.max(newest, m)
    return newest
  } catch {
    return null
  }
}

export const validName = (name: string): boolean => /^[\w.-]+$/.test(name)

// Pages save on every keystroke, so writes to one file queue up in order (overlapping writeFiles
// interleave into garbage), and each lands whole, so a reader never sees half of one.
const queues = new Map<string, Promise<void>>()

export const validSlot = (slot: number): boolean => Number.isInteger(slot) && slot >= 1 && slot <= MAX_SLOTS

export function save(project: string, slot: number, name: string, text: string): Promise<void> {
  if (!validName(name) || !validSlot(slot)) return Promise.reject(new Error(`Bad name: ${name}`))
  const data = join(playDir(project, slot), 'data')
  const file = join(data, `${name}.json`)
  const write = async (): Promise<void> => {
    await mkdir(data, { recursive: true })
    await writeAtomic(file, text)
  }
  const next = (queues.get(file) ?? Promise.resolve()).then(write, write)
  queues.set(file, next)
  next.finally(() => queues.get(file) === next && queues.delete(file)).catch(() => {})
  return next
}

// Keeps .cuckcode/ out of git status without touching any tracked file. Two claude agents
// starting in one project at once share one check, or both would append the line.
const excluding = new Map<string, Promise<void>>()

export function exclude(project: string): Promise<void> {
  let pending = excluding.get(project)
  if (!pending) {
    pending = addExclude(project).finally(() => excluding.delete(project))
    excluding.set(project, pending)
  }
  return pending
}

async function addExclude(project: string): Promise<void> {
  try {
    let file = (await run(project, ['rev-parse', '--git-path', 'info/exclude'])).trim()
    if (!isAbsolute(file)) file = join(project, file)
    const text = await readFile(file, 'utf8').catch(() => '')
    if (text.split('\n').includes('.cuckcode/')) return
    await mkdir(join(file, '..'), { recursive: true })
    await appendFile(file, `${text && !text.endsWith('\n') ? '\n' : ''}.cuckcode/\n`)
  } catch {
    // Not a git repo.
  }
}
