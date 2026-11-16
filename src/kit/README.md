# Playground kit

Playground pages are built from blocks. A page names its blocks and their content, and the kit draws them in cuckcode's look, light or dark, and autosaves every answer. The Templates button in a playground shows them all (`showcase.html`).

```html
<!doctype html><meta charset="utf-8"><script src="media://kit/kit.js"></script>
<script>kit.page({ title: 'Pick a header', blocks: [ /* blocks */ ] })</script>
```

## Page

`kit.page({ title, kicker, intro, blocks, width, submit, answers })`

- `kicker`: a small label above the title. `intro`: Markdown under it.
- `width`: `'wide'` (1280px) or `'full'`; the default is 920px.
- `submit`: the Done button's label, or `false` to drop it (pages with nothing to answer). Done saves, closes the playground and sends the project's Claude a message to read the answers.
- `answers`: the data file's name (default `answers`, i.e. `data/answers.json`).

Answers are saved 300ms after each change, as `{ "<block id>": answer, "_done": "<ISO time>" }`. `_done` is set when the user presses Done. Restored on reload, so Claude can rewrite the page while the user works. A block without an `id` gets `<type><n>` (by position), so give an id to every block whose answer you'll read.

Every block also takes `title`, `text` (Markdown under the title) and `wide`.

## Asking

### form (or questions)
```js
{ type: 'form', id: 'setup', fields: [
  { id: 'name', label: 'Project name', placeholder: 'Lighthouse', required: true },
  { id: 'audience', kind: 'radio', options: ['devs', { value: 'teams', label: 'Small teams', hint: '2–10' }] },
  { id: 'platforms', kind: 'checkbox', options: ['macOS', 'Linux'], default: ['macOS'] },
  { id: 'db', kind: 'select', options: ['SQLite', 'Postgres'] },
  { id: 'offline', kind: 'toggle', default: true },
  { id: 'density', kind: 'range', min: 1, max: 5, step: 1, unit: '', default: 3, help: '1 is airy' },
  { id: 'confidence', kind: 'rating', max: 5 },
  { id: 'notes', kind: 'textarea', rows: 4 }
] }
```
Kinds: `text` (default), `textarea`, `number`, `email`, `url`, `date`, `time`, `color`, `select`, `radio`, `checkbox`, `toggle`, `range`, `rating`. Fields with `options` but no kind are selects.
Answer: `{ name: 'x', audience: 'devs', platforms: ['macOS'], offline: true, density: 3, confidence: 4 }`, only the fields touched, plus their defaults.

### choice
```js
{ type: 'choice', id: 'header', multiple: false, columns: 3, note: 'Why?', options: [
  { id: 'a', label: 'Bold', src: 'a.png', text: 'Markdown', pros: ['Stands out'], cons: ['Loud'], badge: 'Recommended' },
  { id: 'b', label: 'Calm', html: '<button>…</button>', height: 120 },
  { id: 'c', label: 'Terse', code: 'const x = 1', lang: 'ts' }
] }
```
A preview is `src` (image, video, audio), `html` (its own document with the kit's tokens, `height` in px) or `code`. `note: false` hides the note box.
Answer: `{ picked: 'a', note: '' }`; with `multiple`, `picked` is an array.

### review
```js
{ type: 'review', id: 'art', verdicts: ['approve', 'reject'], notes: true, size: 220, items: [
  { id: 'hero', src: 'img/hero.png', caption: 'hero.png', text: 'Markdown' },
  'img/other.png'
] }
```
Items are images, video, audio, `html`, `code` or `text` (Markdown); `kind` forces one. Clicking enlarges into a lightbox: ←/→ move, number keys give that verdict, Esc closes. Images open fitted whole to the window; pinch or ⌘-scroll zooms at the pointer, scrolling or dragging pans, double-click toggles fit and a closer look, and + / − / 0 (or the bar's buttons, 1:1 for actual size) zoom in, out and back to fit. Verdicts starting approve/keep/yes show green, reject/drop/no red, the rest blue. `verdicts: false` makes a plain gallery. `size` is the tile's minimum width.
Answer: `{ hero: { verdict: 'approve', note: 'crop tighter' } }`, only items touched.

### plan / checklist
```js
{ type: 'plan', id: 'plan', items: [{ id: 'db', title: 'Add a table', detail: 'Markdown', checked: true }, 'Write docs'] }
```
Tick to keep, drag to reorder, comment, add steps. `check: false`, `reorder: false`, `notes: false`, `add: false` turn each off. `checklist` is a plan without reordering, notes or adding.
Answer: the whole list, in order: `[{ id, title, detail, checked, note, added? }]`.

### buckets (or triage)
```js
{ type: 'buckets', id: 'triage', buckets: ['Now', 'Later', 'Never'], inbox: 'Unsorted', items: [
  { id: '12', title: 'Crash on empty file', detail: 'Markdown', tags: ['bug'], bucket: 'Now' }
] }
```
Drag cards between columns (or use the ←/→ buttons on hover). Items without a `bucket` start in the inbox column.
Answer: `{ Now: ['12'], Later: [], Never: [] }`; anything not listed is unsorted.

### table
```js
{ type: 'table', id: 'deps', select: 'many', filter: true,
  columns: ['name', { key: 'size', label: 'Size (kB)', align: 'num', md: false }],
  rows: [{ id: 'react', name: 'react', size: 7.4 }] }
```
Click headers to sort. `select` is `'none'` (default), `'one'` or `'many'`; `filter` defaults on above 8 rows. `columns` defaults to the first row's keys. `md: true` renders a column's cells as inline Markdown.
Answer: the picked row ids (`row.id`, else its 1-based position): an array, or one id with `'one'`.

### tune
```js
{ type: 'tune', id: 'card', height: 320, showCss: true,
  knobs: [
    { id: 'radius', label: 'Radius', min: 0, max: 32, step: 1, value: 12, unit: 'px' },
    { id: 'brand', kind: 'color', value: '#d97706' },
    { id: 'font', kind: 'select', options: ['system-ui', 'Georgia'] },
    { id: 'shadow', kind: 'toggle', value: true },
    { id: 'title', kind: 'text', value: 'Hello' }
  ],
  css: '.card { border-radius: var(--radius); background: var(--brand) }',
  preview: '<div class="card">{{title}}</div>' }
```
Knobs default to `range`. Each knob is `var(--<id>)` in the preview (toggles are 1 or 0) and `{{id}}` in its HTML. The preview is its own document with the kit's styles; the CSS of the current values can be copied.
Answer: `{ radius: 12, brand: '#d97706', font: 'system-ui', shadow: true, title: 'Hello' }`.

### annotate
```js
{ type: 'annotate', id: 'pins', src: 'screenshot.png', prompt: 'Click what looks off.' }
```
Answer: `[{ x: 42.5, y: 10, note: 'misaligned' }]`, x and y in % of the image.

## Showing

- `markdown` (or `text`): `{ text }`. Headings, bold, italic, code, links, images, lists, task lists, quotes, tables, rules.
- `callout`: `{ tone: 'info' | 'ok' | 'warn' | 'danger', heading, text }`.
- `code`: `{ code, lang }`, with a copy button. `lang: 'diff'` colors `+`/`-`/`@@` lines.
- `diff`: `{ before, after }`, a line diff of two texts.
- `stats`: `{ items: [{ label, value, delta: '-12%', better: 'lower', tone: 'ok' | 'warn' | 'danger', hint }] }`. A delta is green when it moves the good way: up, or down with `better: 'lower'`.
- `chart`: `{ kind: 'bar' | 'line', labels: [...], series: [{ name, values: [...] }], unit, height }`.
- `steps`: `{ items: [{ title, status: 'done' | 'doing' | 'todo' | 'failed' | 'skipped', detail }] }`. For progress, rewrite the page as statuses change.
- `gallery`: a `review` without verdicts or notes.
- `compare`: `{ before: 'a.png', after: 'b.png', beforeLabel, afterLabel }`, an image wipe slider. Given `options` instead, it's a `choice`.
- `html`: `{ html }` inline, or `{ html, frame: true, height }` in its own document.

## Arranging

- `columns`: `{ blocks: [...] }` side by side (stacked on narrow windows).
- `tabs`: `{ tabs: [{ label, blocks: [...] }] }`.

## Custom

Blocks can't do it? Keep `kit.js` and add your own:

```js
kit.block('swatches', (spec, ctx) => {
  // ctx: { id, value (the saved answer), set(answer), render(block), h, md }
  return kit.h('div', { class: 'k-row' }, spec.colors.map((c) =>
    kit.h('button', { class: 'k-btn', style: { background: c }, onclick: () => ctx.set(c) }, c)))
})
kit.page({ blocks: [{ type: 'swatches', id: 'color', colors: ['#fff', '#000'] }] })
```

`kit.h(tag, props, ...children)` makes elements (`on<event>` props are listeners, `class`, `style` objects, `html`). `kit.md(text)` is Markdown to HTML. `kit.toast(text)`, `kit.lightbox(items, index)`. `kit.answers` and `kit.set(id, value)` reach the answers directly.

For a page entirely your own, still load `kit.js` for the theme. The tokens are `--bg`, `--panel`, `--hover`, `--line`, `--fg`, `--muted`, `--accent`, `--accent-fg`, `--add`, `--del`, `--mod`, `--new`, `--c1`–`--c6` (chart series), `--radius`, `--shadow`, `--font` and `--mono`. Classes include `k-btn` (`primary`, `ghost`, `small`), `k-block`, `k-md`, `k-table`, `k-code`, `k-badge`, `k-row` and `k-muted`. `window.cuckcode.save(name, data)` writes `data/<name>.json`, and `await window.cuckcode.load(name)` reads it back (null when missing).
