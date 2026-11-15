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

// The kit pages load from media://kit/: blocks Claude describes instead of writing a page. The
// repo always sits beside the build (out/main) and the tests (src/main), two levels down.
export const kitDir = join(__dirname, '../../src/kit')

const slotName = (s: PlaygroundSlot, i: number): string => s.name || `playground ${i + 1}`

// Appended to the system prompt of every claude session cuckcode starts. The block summary is
// what spares Claude reading the kit's README or writing a page from scratch.
export function prompt(project: string, slots: PlaygroundSlot[]): string {
  const one = slots.length === 1
  const dir = one ? playDir(project, 1) : `${join(project, '.cuckcode', 'playground')}/<n>`
  const which = one
    ? `It is called "${slotName(slots[0], 0)}"; its folder is ${dir}.`
    : `There are ${slots.length} of them, each its own folder (<n> below): ${slots.map((s, i) => `${i + 1} = "${slotName(s, i)}"`).join(', ')}. Use the one whose name fits the task, or 1 when none does.`
  return `You are running inside cuckcode, which has a "playground": a web page that fills the window in place of this terminal, for anything the user should see, pick or fill in. ${which}

Use it on your own, without being asked, whenever showing beats describing: options to choose between (designs, approaches, names), images or video to review, several questions at once, a plan to approve or reorder, items to triage, a look to tune, data or a report to read, progress on long work. Keep a single quick question in the terminal.

Build pages from the kit's blocks; there's no CSS or JS to write. A whole page, in ${dir}/index.html:

<!doctype html><meta charset="utf-8"><script src="media://kit/kit.js"></script>
<script>kit.page({ title: 'Pick a header', intro: 'Markdown.', blocks: [
  { type: 'choice', id: 'header', options: [{ id: 'a', label: 'Bold', src: 'a.png', text: 'Why' }, { id: 'b', label: 'Calm', src: 'b.png' }] },
  { type: 'form', id: 'details', fields: [{ id: 'tagline', label: 'Tagline' }, { id: 'tone', kind: 'radio', options: ['warm', 'dry'] }] }
] })</script>

Every block takes an optional id (it names the block's answer), title and text (Markdown under the title).
- Ask: form {fields:[{id,label,kind:text|textarea|number|select|radio|checkbox|toggle|range|rating|color|date,options,default,help,placeholder,min,max,step,unit}]} · choice {options:[{id,label,text,src|html|code+lang,pros,cons,badge}],multiple,columns,note} · review {items:[{id,src,caption,text}],verdicts:['approve','reject'],notes} for images, video, audio or html, with a lightbox and number keys · plan {items:[{id,title,detail,checked}]}: tick, drag to reorder, comment, add steps · checklist {items} · buckets {buckets:['Now','Later','Never'],items:[{id,title,detail,tags,bucket}]}: drag to sort · table {columns,rows,select:'one'|'many'}: sort, filter, pick rows · tune {knobs:[{id,label,kind:range|color|select|toggle|text,min,max,step,unit,value,options}],preview:'<html>',css,height}: a live preview where each knob is var(--id) and {{id}} · annotate {src}: the user pins notes on an image.
- Show: markdown {text} · callout {tone:info|ok|warn|danger,heading,text} · code {code,lang} (lang 'diff' colors +/- lines) · diff {before,after} · stats {items:[{label,value,delta,better:'lower',tone,hint}]} · chart {kind:bar|line,labels,series:[{name,values}],unit} · steps {items:[{title,status:done|doing|todo|failed|skipped,detail}]} · gallery {items} · compare {before,after}: an image wipe slider · html {html,frame,height}.
- Arrange: columns {blocks} · tabs {tabs:[{label,blocks}]}. Page options: kicker, width:'wide'|'full', submit (the Done button's label, or false for pages with nothing to answer).

Answers autosave to ${dir}/data/answers.json as {blockId: answer}; _done holds when the user pressed Done. ${join(kitDir, 'README.md')} has each block's answer shape and examples: read it only when this isn't enough. For what blocks can't do, still load kit.js and either register a block (kit.block('name', (spec, ctx) => element), saving with ctx.set(answer); kit.h(tag, props, ...children) and kit.md(text) help) or write your own HTML on the kit's tokens (var(--bg), --panel, --line, --fg, --muted, --accent, --add, --del) and its k-* classes; window.cuckcode.save(name, data) and load(name) keep data/<name>.json.

- Put assets beside index.html (copy or symlink images and video in) and use relative paths. The page reloads whenever its files change, keeping answers, so for long work keep a steps or stats page current as you go.
- For a new task, overwrite index.html and delete data/ first, or the old answers load into the new page. Never write data/ while the user is filling it in.
- After writing it, tell the user in one line what's there; they open it from the header (a dot shows it changed). When they say they're done, read data/answers.json and act on it.
- The folder is git-ignored (via .git/info/exclude).`
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
