// The playground kit: a page describes itself as blocks (kit.page({ title, blocks })), the kit
// draws them in cuckcode's look and autosaves every answer to data/answers.json. Plain browser
// JS, no build: playground pages load it from media://kit/kit.js. See README.md for each block.
;(() => {
  const here = document.currentScript?.src || 'media://kit/kit.js'
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = new URL('kit.css', here).href
  ;(document.head || document.documentElement).append(link)

  // cuckcode passes its own theme (?theme=dark), which can differ from the system's.
  const theme = new URLSearchParams(location.search).get('theme')
  if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme

  // Outside a playground (the showcase) there's no bridge: answers live in memory.
  const memory = new Map()
  const store = window.cuckcode || {
    save: async (name, data) => void memory.set(name, JSON.stringify(data)),
    load: async (name) => (memory.has(name) ? JSON.parse(memory.get(name)) : null)
  }

  // ---------- helpers ----------

  function h(tag, props, ...kids) {
    const el = document.createElement(tag)
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v)
      else if (k === 'class') el.className = v
      else if (k === 'style' && typeof v === 'object') for (const [p, x] of Object.entries(v)) el.style.setProperty(p.startsWith('--') ? p : p.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), x)
      else if (k === 'html') el.innerHTML = v
      else if (k === 'value' || k === 'checked' || k === 'selected') el[k] = v
      else el.setAttribute(k, v === true ? '' : v)
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid))
    return el
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

  function inline(s) {
    const codes = []
    s = esc(s).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`)
    s = s
      .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1">')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`)
  }

  // Enough Markdown for notes and reports: headings, lists, quotes, tables, code, rules.
  function md(text) {
    const lines = String(text ?? '').replace(/\r/g, '').split('\n')
    const out = []
    let i = 0
    const table = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
    while (i < lines.length) {
      const line = lines[i]
      let m
      if (!line.trim()) i++
      else if ((m = /^```(\w*)/.exec(line))) {
        const body = []
        for (i++; i < lines.length && !lines[i].startsWith('```'); i++) body.push(lines[i])
        i++
        out.push(codeHtml(body.join('\n'), m[1]))
      } else if ((m = /^(#{1,4})\s+(.*)/.exec(line))) {
        out.push(`<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`)
        i++
      } else if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
        out.push('<hr>')
        i++
      } else if (/^>/.test(line)) {
        const body = []
        for (; i < lines.length && /^>/.test(lines[i]); i++) body.push(lines[i].replace(/^>\s?/, ''))
        out.push(`<blockquote>${md(body.join('\n'))}</blockquote>`)
      } else if (/^\s*([-*]|\d+\.)\s/.test(line)) {
        const ordered = /^\s*\d+\./.test(line)
        const items = []
        for (; i < lines.length && /^\s*([-*]|\d+\.)\s/.test(lines[i]); i++) {
          const item = lines[i].replace(/^\s*([-*]|\d+\.)\s/, '')
          const task = /^\[( |x)\]\s/i.exec(item)
          items.push(task ? `<li class="task"><input type="checkbox" disabled${task[1] === ' ' ? '' : ' checked'}> ${inline(item.slice(4))}</li>` : `<li>${inline(item)}</li>`)
        }
        out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`)
      } else if (/^\|/.test(line) && /^\|?[\s:-]+\|/.test(lines[i + 1] || '')) {
        const head = table(line)
        const rows = []
        for (i += 2; i < lines.length && /^\|/.test(lines[i]); i++) rows.push(table(lines[i]))
        out.push(
          `<div class="k-scroll"><table class="k-table"><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows
            .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
            .join('')}</tbody></table></div>`
        )
      } else {
        const body = []
        for (; i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|\s*([-*]|\d+\.)\s|\|)/.test(lines[i]); i++) body.push(lines[i])
        if (!body.length) body.push(lines[i++])
        out.push(`<p>${inline(body.join(' '))}</p>`)
      }
    }
    return out.join('')
  }

  function codeHtml(code, lang) {
    const diff = lang === 'diff' || lang === 'patch'
    const body = String(code ?? '')
      .split('\n')
      .map((l) => {
        const cls = !diff ? '' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : l.startsWith('@@') ? 'hunk' : ''
        return `<span class="line ${cls}">${esc(l) || ' '}</span>`
      })
      .join('')
    return `<pre class="k-code"${lang ? ` data-lang="${esc(lang)}"` : ''}><code>${body}</code></pre>`
  }

  const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)(\?|#|$)/i
  const VIDEO = /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i
  const AUDIO = /\.(mp3|wav|ogg|oga|m4a|flac|aac)(\?|#|$)/i
  const kindOf = (item) => item.kind || (IMAGE.test(item.src) ? 'image' : VIDEO.test(item.src) ? 'video' : AUDIO.test(item.src) ? 'audio' : item.html ? 'html' : item.code ? 'code' : item.src ? 'image' : 'text')

  function media(item, big) {
    const kind = kindOf(item)
    if (kind === 'video') return h('video', { src: item.src, controls: big, muted: !big, loop: !big, autoplay: !big, playsinline: true, preload: 'metadata' })
    if (kind === 'audio') return h('audio', { src: item.src, controls: true, preload: 'metadata' })
    if (kind === 'html') return frame(item.html, big ? null : item.height || 200)
    if (kind === 'code') return h('div', { class: 'k-media-code', html: codeHtml(item.code, item.lang) })
    if (kind === 'text') return h('div', { class: 'k-md k-media-text', html: md(item.text) })
    return h('img', { src: item.src, alt: item.caption || '', loading: 'lazy', draggable: 'false' })
  }

  // An HTML snippet in its own document, styled by the kit, so its CSS can't leak into the page.
  function frame(html, height) {
    const f = h('iframe', { class: 'k-frame', style: height ? { height: `${height}px` } : null })
    f.srcdoc = docFor(html)
    return f
  }

  const docFor = (html, extra = '') =>
    `<!doctype html><html${document.documentElement.dataset.theme ? ` data-theme="${document.documentElement.dataset.theme}"` : ''}><head><meta charset="utf-8"><link rel="stylesheet" href="${link.href}">${extra}</head><body class="k-snippet">${html}</body></html>`

  const opt = (o) => (o && typeof o === 'object' ? { ...o, value: o.value ?? o.id, label: o.label ?? o.value ?? o.id } : { value: o, label: String(o) })
  const words = (s) => String(s).replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase())

  // ---------- answers ----------

  let answersName = 'answers'
  let answers = {}
  let timer = null
  const chip = h('span', { class: 'k-saved' })

  function persist() {
    clearTimeout(timer)
    timer = null
    chip.textContent = 'Saving…'
    chip.dataset.state = 'saving'
    return store.save(answersName, answers).then(
      () => {
        chip.textContent = 'Saved'
        chip.dataset.state = 'ok'
      },
      (e) => {
        chip.textContent = `Not saved: ${e.message}`
        chip.dataset.state = 'error'
      }
    )
  }

  function set(id, value) {
    answers[id] = value
    clearTimeout(timer)
    chip.textContent = 'Editing…'
    chip.dataset.state = 'saving'
    timer = setTimeout(persist, 300)
  }
  addEventListener('pagehide', () => timer && persist())

  // ---------- overlays ----------

  function toast(text, tone) {
    let box = document.querySelector('.k-toasts')
    if (!box) document.body.append((box = h('div', { class: 'k-toasts' })))
    const t = h('div', { class: `k-toast ${tone || ''}` }, text)
    box.append(t)
    setTimeout(() => t.classList.add('out'), 3200)
    setTimeout(() => t.remove(), 3600)
  }

  // A full-window viewer over a list; keys(e, i) handles extra shortcuts (verdicts in review).
  function lightbox(items, start, { render, keys } = {}) {
    let i = start
    const stage = h('div', { class: 'k-lb-stage' })
    const info = h('div', { class: 'k-lb-info' })
    const box = h('div', { class: 'k-lb', tabindex: '-1' }, stage, info, h('button', { class: 'k-lb-x k-btn ghost', onclick: () => done(), title: 'Close (Esc)' }, '✕'))
    const show = () => {
      const item = items[i]
      stage.replaceChildren(media(item, true))
      info.replaceChildren(h('span', { class: 'k-muted' }, `${i + 1} / ${items.length}`), item.caption ? h('strong', null, item.caption) : null, render ? render(item, i) : null)
    }
    const key = (e) => {
      if (e.target.closest && e.target.closest('input, textarea, select')) return
      if (e.key === 'Escape') done()
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') i = (i + 1) % items.length
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') i = (i - 1 + items.length) % items.length
      else if (!(keys && keys(e, i))) return
      e.preventDefault()
      if (box.isConnected) show()
    }
    function done() {
      removeEventListener('keydown', key)
      box.remove()
    }
    box.addEventListener('click', (e) => e.target === box && done())
    addEventListener('keydown', key)
    document.body.append(box)
    show()
    box.focus()
    return { refresh: show }
  }

  // ---------- blocks ----------

  const blocks = {}
  const block = (type, render) => void (blocks[type] = render)

  // Drag-to-reorder for the direct children of `list`; onDrop(fromIndex, toIndex).
  function sortable(list, onDrop, accept = () => true) {
    let dragged = null
    list.addEventListener('dragstart', (e) => {
      dragged = e.target.closest('[draggable="true"]')
      if (!dragged || dragged.parentElement !== list) return (dragged = null)
      dragged.classList.add('dragging')
      e.dataTransfer.effectAllowed = 'move'
    })
    list.addEventListener('dragend', () => {
      if (dragged) dragged.classList.remove('dragging')
      dragged = null
    })
    list.addEventListener('dragover', (e) => {
      if (!dragged || !accept()) return
      e.preventDefault()
      const after = [...list.children].find((c) => c !== dragged && e.clientY < c.getBoundingClientRect().top + c.offsetHeight / 2)
      list.insertBefore(dragged, after || null)
    })
    list.addEventListener('drop', (e) => {
      if (!dragged) return
      e.preventDefault()
      onDrop([...list.children].indexOf(dragged))
    })
  }

  block('markdown', (b) => h('div', { class: 'k-md', html: md(b.text) }))
  block('text', blocks.markdown)

  block('callout', (b) =>
    h('div', { class: `k-callout ${b.tone || 'info'}` }, h('span', { class: 'k-callout-icon' }, { info: 'i', ok: '✓', warn: '!', danger: '✕' }[b.tone || 'info'] || 'i'), h('div', null, b.heading ? h('strong', null, b.heading) : null, h('div', { class: 'k-md', html: md(b.text) })))
  )

  block('code', (b) => {
    const wrap = h('div', { class: 'k-codebox', html: codeHtml(b.code, b.lang) })
    wrap.append(
      h('button', { class: 'k-btn ghost small k-copy', onclick: (e) => navigator.clipboard.writeText(b.code).then(() => (e.target.textContent = 'Copied')) }, 'Copy')
    )
    return wrap
  })

  block('html', (b) => (b.frame ? frame(b.html, b.height || 240) : h('div', { html: b.html })))

  block('stats', (b) =>
    h(
      'div',
      { class: 'k-stats' },
      (b.items || []).map((s) =>
        h(
          'div',
          { class: `k-stat ${s.tone || ''}` },
          h('div', { class: 'k-stat-label' }, s.label),
          h('div', { class: 'k-stat-value' }, s.value),
          // Green when the change is the good direction: up by default, down with better: 'lower'.
          s.delta != null ? h('div', { class: `k-stat-delta ${String(s.delta).startsWith('-') === (s.better === 'lower') ? 'up' : 'down'}` }, s.delta) : null,
          s.hint ? h('div', { class: 'k-muted small' }, s.hint) : null
        )
      )
    )
  )

  const STEP = { done: '✓', doing: '', todo: '', failed: '✕', skipped: '–' }
  block('steps', (b) =>
    h(
      'ol',
      { class: 'k-steps' },
      (b.items || []).map((s) =>
        h('li', { class: `k-step ${s.status || 'todo'}` }, h('span', { class: 'k-step-dot' }, STEP[s.status || 'todo'] ?? ''), h('div', null, h('div', { class: 'k-step-title', html: inline(s.title) }), s.detail ? h('div', { class: 'k-md k-muted', html: md(s.detail) }) : null))
      )
    )
  )

  block('form', (b, ctx) => {
    const value = { ...Object.fromEntries((b.fields || []).filter((f) => f.default !== undefined).map((f) => [f.id, f.default])), ...(ctx.value || {}) }
    const put = (id, v) => {
      value[id] = v
      ctx.set({ ...value })
    }
    return h(
      'div',
      { class: 'k-form' },
      (b.fields || []).map((f) => {
        const kind = f.kind || (f.options ? 'select' : 'text')
        const v = value[f.id]
        const id = `${ctx.id}-${f.id}`
        let input
        if (kind === 'textarea') input = h('textarea', { id, rows: f.rows || 3, placeholder: f.placeholder, value: v ?? '', oninput: (e) => put(f.id, e.target.value) })
        else if (kind === 'select')
          input = h('select', { id, onchange: (e) => put(f.id, e.target.value) }, h('option', { value: '', disabled: true, selected: v == null }, f.placeholder || 'Choose…'), (f.options || []).map(opt).map((o) => h('option', { value: o.value, selected: String(v) === String(o.value) }, o.label)))
        else if (kind === 'radio' || kind === 'checkbox') {
          const multi = kind === 'checkbox'
          const have = multi ? new Set(v || []) : null
          input = h(
            'div',
            { class: 'k-options' },
            (f.options || []).map(opt).map((o) =>
              h(
                'label',
                { class: 'k-option' },
                h('input', {
                  type: kind,
                  name: id,
                  checked: multi ? have.has(o.value) : v === o.value,
                  onchange: (e) => {
                    if (!multi) return put(f.id, o.value)
                    e.target.checked ? have.add(o.value) : have.delete(o.value)
                    put(f.id, [...have])
                  }
                }),
                h('span', null, o.label, o.hint ? h('span', { class: 'k-muted small' }, ` ${o.hint}`) : null)
              )
            )
          )
        } else if (kind === 'toggle') input = h('label', { class: 'k-switch' }, h('input', { id, type: 'checkbox', checked: !!v, onchange: (e) => put(f.id, e.target.checked) }), h('span'))
        else if (kind === 'range') {
          const out = h('output', { class: 'k-mono' }, `${v ?? f.min ?? 0}${f.unit || ''}`)
          input = h('div', { class: 'k-range' }, h('input', { id, type: 'range', min: f.min ?? 0, max: f.max ?? 10, step: f.step ?? 1, value: v ?? f.min ?? 0, oninput: (e) => (put(f.id, Number(e.target.value)), (out.textContent = `${e.target.value}${f.unit || ''}`)) }), out)
        } else if (kind === 'rating') {
          const max = f.max || 5
          const stars = h('div', { class: 'k-rating' })
          const draw = () => stars.replaceChildren(...Array.from({ length: max }, (_, n) => h('button', { type: 'button', class: n < (value[f.id] || 0) ? 'on' : '', onclick: () => (put(f.id, value[f.id] === n + 1 ? 0 : n + 1), draw()) }, '★')))
          draw()
          input = stars
        } else input = h('input', { id, type: kind, placeholder: f.placeholder, min: f.min, max: f.max, step: f.step, value: v ?? '', oninput: (e) => put(f.id, kind === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value) })
        return h('div', { class: `k-field ${kind}` }, h('label', { class: 'k-label', for: id }, f.label || words(f.id), f.required ? h('span', { class: 'k-req' }, ' *') : null), f.help ? h('div', { class: 'k-help' }, f.help) : null, input)
      })
    )
  })
  block('questions', blocks.form)

  block('choice', (b, ctx) => {
    const multi = !!b.multiple
    const state = { picked: multi ? [] : null, note: '', ...(ctx.value || {}) }
    const options = (b.options || []).map((o, i) => ({ ...o, id: o.id ?? String(i + 1) }))
    const save = () => ctx.set({ ...state })
    const cards = options.map((o) => {
      const card = h(
        'div',
        {
          class: 'k-choice',
          tabindex: '0',
          role: multi ? 'checkbox' : 'radio',
          onclick: (e) => !e.target.closest('textarea, button, a, video, audio') && pick(o.id),
          onkeydown: (e) => (e.key === ' ' || e.key === 'Enter') && e.target === card && (e.preventDefault(), pick(o.id))
        },
        o.src || o.html || o.code ? h('div', { class: 'k-choice-media' }, media(o, false), o.src && kindOf(o) === 'image' ? h('button', { class: 'k-btn ghost small k-zoom', title: 'Enlarge', onclick: () => lightbox(options.filter((x) => x.src), options.filter((x) => x.src).indexOf(o)) }, '⤢') : null) : null,
        h('div', { class: 'k-choice-body' }, h('div', { class: 'k-choice-head' }, h('span', { class: `k-mark ${multi ? 'square' : ''}` }), h('strong', null, o.label || `Option ${o.id}`), o.badge ? h('span', { class: 'k-badge' }, o.badge) : null), o.text ? h('div', { class: 'k-md k-muted', html: md(o.text) }) : null, o.pros || o.cons ? h('div', { class: 'k-proscons' }, (o.pros || []).map((p) => h('div', { class: 'pro' }, '+ ', p)), (o.cons || []).map((p) => h('div', { class: 'con' }, '− ', p))) : null)
      )
      card.dataset.id = o.id
      return card
    })
    const paint = () => cards.forEach((c) => c.setAttribute('aria-checked', String(multi ? state.picked.includes(c.dataset.id) : state.picked === c.dataset.id)))
    function pick(id) {
      if (multi) state.picked = state.picked.includes(id) ? state.picked.filter((x) => x !== id) : [...state.picked, id]
      else state.picked = state.picked === id ? null : id
      paint()
      save()
    }
    paint()
    return h(
      'div',
      null,
      h('div', { class: 'k-choices', style: { '--cols': b.columns || Math.min(options.length, 3) } }, cards),
      b.note === false ? null : h('textarea', { class: 'k-note', rows: 2, placeholder: b.note || 'Anything to add? (optional)', value: state.note, oninput: (e) => ((state.note = e.target.value), save()) })
    )
  })
  block('compare', (b, ctx) => (b.before && b.after ? blocks.wipe(b, ctx) : blocks.choice(b, ctx)))

  block('review', (b, ctx) => {
    const verdicts = b.verdicts === false ? [] : (b.verdicts || ['approve', 'reject']).map(opt)
    const items = (b.items || []).map((it, i) => (typeof it === 'string' ? { src: it } : it)).map((it, i) => ({ ...it, id: it.id ?? it.src ?? String(i + 1) }))
    const state = { ...(ctx.value || {}) }
    const notes = b.notes !== false
    const count = h('span', { class: 'k-muted small' })
    const tiles = new Map()
    const tone = (v) => (/^(approve|yes|keep|ok|good|accept|ship)/i.test(v) ? 'ok' : /^(reject|no|drop|bad|delete|remove)/i.test(v) ? 'danger' : 'neutral')
    const update = (id, patch) => {
      state[id] = { ...state[id], ...patch }
      if (!state[id].verdict && !state[id].note) delete state[id]
      ctx.set({ ...state })
      paint()
    }
    const verdictButtons = (it) =>
      verdicts.length
        ? h(
            'div',
            { class: 'k-seg' },
            verdicts.map((v, n) =>
              h('button', { class: `k-seg-btn ${tone(v.value)}`, 'aria-pressed': String(state[it.id]?.verdict === v.value), title: `${v.label} (${n + 1})`, onclick: (e) => {
                update(it.id, { verdict: state[it.id]?.verdict === v.value ? undefined : v.value })
                // The lightbox's own copy of these buttons isn't one of the tiles paint() knows.
                e.currentTarget.parentElement.querySelectorAll('button').forEach((x, m) => x.setAttribute('aria-pressed', String(state[it.id]?.verdict === verdicts[m].value)))
              } },v.label === v.value ? words(v.label) : v.label)
            )
          )
        : null
    const noteBox = (it) => (notes ? h('textarea', { class: 'k-note', rows: 1, placeholder: 'Note…', value: state[it.id]?.note || '', oninput: (e) => update(it.id, { note: e.target.value }) }) : null)
    const paint = () => {
      for (const [id, t] of tiles) {
        t.dataset.verdict = state[id]?.verdict ? tone(state[id].verdict) : ''
        t.querySelectorAll('.k-seg-btn').forEach((btn, n) => btn.setAttribute('aria-pressed', String(state[id]?.verdict === verdicts[n].value)))
      }
      if (verdicts.length) count.textContent = `${items.filter((it) => state[it.id]?.verdict).length} of ${items.length} reviewed`
    }
    const grid = h(
      'div',
      { class: 'k-gallery', style: { '--min': `${b.size || 220}px` } },
      items.map((it, i) => {
        const tile = h(
          'figure',
          { class: 'k-tile' },
          h('div', { class: 'k-tile-media', onclick: (e) => !e.target.closest('video[controls], audio') && (lightbox(items, i, { render: (x) => h('div', { class: 'k-lb-tools' }, verdictButtons(x), noteBox(x)), keys: (e, n) => {
            const v = verdicts[Number(e.key) - 1]
            if (!v) return false
            update(items[n].id, { verdict: state[items[n].id]?.verdict === v.value ? undefined : v.value })
            return true
          } })) }, media(it, false)),
          h('figcaption', null, it.caption ? h('div', { class: 'k-tile-cap' }, it.caption) : null, it.text ? h('div', { class: 'k-muted small k-md', html: md(it.text) }) : null, verdictButtons(it), noteBox(it))
        )
        tiles.set(it.id, tile)
        return tile
      })
    )
    paint()
    return h('div', null, verdicts.length ? h('div', { class: 'k-row between' }, count, h('span', { class: 'k-muted small' }, 'Click to enlarge · ←/→ to move · ', verdicts.map((v, n) => `${n + 1} ${v.label === v.value ? words(v.label) : v.label}`).join(' · '))) : null, grid)
  })
  block('gallery', (b, ctx) => blocks.review({ verdicts: false, notes: false, ...b }, ctx))

  block('plan', (b, ctx) => {
    const check = b.check !== false
    const notes = b.notes !== false
    let items = ctx.value || (b.items || []).map((it, i) => (typeof it === 'string' ? { title: it } : it)).map((it, i) => ({ id: it.id ?? String(i + 1), title: it.title, detail: it.detail, checked: check ? it.checked ?? true : undefined, note: '' }))
    const save = () => ctx.set(items.map((x) => ({ ...x })))
    const list = h('ol', { class: 'k-plan' })
    const draw = () => {
      list.replaceChildren(
        ...items.map((it, i) => {
          const li = h(
            'li',
            { class: `k-plan-item ${check && !it.checked ? 'off' : ''}`, draggable: b.reorder === false ? 'false' : 'true' },
            b.reorder === false ? h('span', { class: 'k-plan-n' }, i + 1) : h('span', { class: 'k-grip', title: 'Drag to reorder' }, '⋮⋮'),
            check ? h('input', { type: 'checkbox', checked: it.checked, onchange: (e) => ((it.checked = e.target.checked), save(), draw()) }) : null,
            h(
              'div',
              { class: 'k-plan-body' },
              it.added ? h('input', { class: 'k-plan-title', value: it.title, placeholder: 'New step', oninput: (e) => ((it.title = e.target.value), save()) }) : h('div', { class: 'k-plan-title', html: inline(it.title) }),
              it.detail ? h('div', { class: 'k-md k-muted small', html: md(it.detail) }) : null,
              notes ? h('textarea', { class: 'k-note', rows: 1, placeholder: 'Comment…', value: it.note || '', oninput: (e) => ((it.note = e.target.value), save()) }) : null
            ),
            it.added ? h('button', { class: 'k-btn ghost small', title: 'Remove', onclick: () => ((items = items.filter((x) => x !== it)), save(), draw()) }, '✕') : null
          )
          li._item = it
          return li
        })
      )
    }
    // Dragging moves the elements; the new order is read back from them.
    if (b.reorder !== false)
      sortable(list, () => {
        items = [...list.children].map((li) => li._item)
        save()
        draw()
      })
    draw()
    const add = () => {
      items.push({ id: `new-${Date.now()}`, title: '', checked: check || undefined, note: '', added: true })
      save()
      draw()
      list.lastChild.querySelector('input.k-plan-title').focus()
    }
    return h('div', null, list, b.add === false ? null : h('button', { class: 'k-btn ghost small', onclick: add }, '+ Add a step'))
  })
  block('checklist', (b, ctx) => blocks.plan({ reorder: false, notes: false, ...b }, ctx))

  block('buckets', (b, ctx) => {
    const buckets = (b.buckets || ['Now', 'Later', 'Never']).map(opt)
    const items = (b.items || []).map((it, i) => (typeof it === 'string' ? { title: it } : it)).map((it, i) => ({ ...it, id: it.id ?? String(i + 1) }))
    const inbox = { value: '', label: b.inbox || 'Unsorted' }
    // value: { bucket: [ids in order] }; anything not placed sits in the inbox.
    const placed = ctx.value || Object.fromEntries(buckets.map((k) => [k.value, items.filter((it) => it.bucket === k.value).map((it) => it.id)]))
    const all = [inbox, ...buckets]
    const where = (id) => buckets.find((k) => (placed[k.value] || []).includes(id))?.value ?? ''
    const byId = new Map(items.map((it) => [it.id, it]))
    const board = h('div', { class: 'k-board', style: { '--cols': all.length } })
    let dragging = null
    const move = (id, to, before) => {
      for (const k of buckets) placed[k.value] = (placed[k.value] || []).filter((x) => x !== id)
      if (to) {
        const list = placed[to] || (placed[to] = [])
        const at = before ? list.indexOf(before) : -1
        at < 0 ? list.push(id) : list.splice(at, 0, id)
      }
      ctx.set(JSON.parse(JSON.stringify(placed)))
      draw()
    }
    const draw = () => {
      board.replaceChildren(
        ...all.map((k, col) => {
          const ids = k.value ? placed[k.value] || [] : items.map((it) => it.id).filter((id) => !where(id))
          if (!k.value && !ids.length && b.inbox === false) return h('div')
          const column = h(
            'div',
            {
              class: `k-col ${k.value ? '' : 'inbox'}`,
              ondragover: (e) => dragging && (e.preventDefault(), column.classList.add('over')),
              ondragleave: () => column.classList.remove('over'),
              ondrop: (e) => {
                e.preventDefault()
                const card = e.target.closest('.k-card')
                move(dragging, k.value, card && card.dataset.id !== dragging ? card.dataset.id : null)
              }
            },
            h('div', { class: 'k-col-head' }, h('span', null, k.label), h('span', { class: 'k-badge' }, ids.length)),
            ids.map((id) => {
              const it = byId.get(id)
              if (!it) return null
              const card = h(
                'div',
                { class: 'k-card', draggable: 'true', ondragstart: () => ((dragging = id), setTimeout(() => card.classList.add('dragging'))), ondragend: () => ((dragging = null), card.classList.remove('dragging')) },
                h('div', { class: 'k-card-title', html: inline(it.title) }),
                it.detail ? h('div', { class: 'k-md k-muted small', html: md(it.detail) }) : null,
                it.tags ? h('div', { class: 'k-tags' }, it.tags.map((t) => h('span', { class: 'k-badge' }, t))) : null,
                h('div', { class: 'k-card-move' }, col > 0 ? h('button', { class: 'k-btn ghost small', title: `To ${all[col - 1].label}`, onclick: () => move(id, all[col - 1].value) }, '←') : null, col < all.length - 1 ? h('button', { class: 'k-btn ghost small', title: `To ${all[col + 1].label}`, onclick: () => move(id, all[col + 1].value) }, '→') : null)
              )
              card.dataset.id = id
              return card
            })
          )
          return column
        })
      )
    }
    draw()
    return board
  })
  block('triage', blocks.buckets)

  block('table', (b, ctx) => {
    const cols = (b.columns || Object.keys((b.rows || [])[0] || {}).filter((k) => k !== 'id')).map((c) => (typeof c === 'string' ? { key: c, label: words(c) } : { label: words(c.key), ...c }))
    const rows = (b.rows || []).map((r, i) => ({ ...r, _key: String(r.id ?? i + 1) }))
    const mode = b.select || 'none'
    let picked = new Set([].concat(ctx.value ?? []).map(String))
    let sort = null
    let query = ''
    const body = h('tbody')
    const num = (v) => typeof v === 'number' || (/^-?[\d.,]+%?$/.test(String(v)) && !isNaN(parseFloat(String(v).replace(/,/g, ''))))
    const val = (v) => (num(v) ? parseFloat(String(v).replace(/,/g, '')) : String(v ?? '').toLowerCase())
    const head = h('tr')
    const draw = () => {
      let shown = rows.filter((r) => !query || cols.some((c) => String(r[c.key] ?? '').toLowerCase().includes(query)))
      if (sort) shown = [...shown].sort((a, z) => (val(a[sort.key]) > val(z[sort.key]) ? 1 : val(a[sort.key]) < val(z[sort.key]) ? -1 : 0) * sort.dir)
      head.replaceChildren(
        mode === 'none' ? '' : h('th', { class: 'k-sel' }),
        ...cols.map((c) => h('th', { class: `${c.align || (rows.length && num(rows[0][c.key]) ? 'num' : '')} sortable`, onclick: () => ((sort = sort?.key === c.key ? (sort.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 }), draw()) }, c.label, sort?.key === c.key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''))
      )
      body.replaceChildren(
        ...shown.map((r) =>
          h(
            'tr',
            {
              class: picked.has(r._key) ? 'picked' : '',
              onclick: mode === 'none' ? null : (e) => {
                if (e.target.closest('a')) return
                if (mode === 'one') picked = picked.has(r._key) ? new Set() : new Set([r._key])
                else picked.has(r._key) ? picked.delete(r._key) : picked.add(r._key)
                ctx.set(mode === 'one' ? [...picked][0] ?? null : [...picked])
                draw()
              }
            },
            mode === 'none' ? '' : h('td', { class: 'k-sel' }, h('input', { type: mode === 'one' ? 'radio' : 'checkbox', checked: picked.has(r._key), tabindex: '-1' })),
            ...cols.map((c) => h('td', { class: c.align || (num(r[c.key]) ? 'num' : ''), html: c.md ? inline(r[c.key]) : null }, c.md ? null : r[c.key] ?? ''))
          )
        )
      )
    }
    draw()
    const filter = b.filter ?? rows.length > 8
    return h('div', null, filter ? h('input', { class: 'k-filter', type: 'search', placeholder: `Filter ${rows.length} rows…`, oninput: (e) => ((query = e.target.value.toLowerCase()), draw()) }) : null, h('div', { class: 'k-scroll' }, h('table', { class: `k-table ${mode === 'none' ? '' : 'selectable'}` }, h('thead', null, head), body)))
  })

  block('tune', (b, ctx) => {
    const knobs = b.knobs || []
    const initial = Object.fromEntries(knobs.map((k) => [k.id, k.value ?? (k.kind === 'color' ? '#888888' : k.kind === 'toggle' ? false : k.kind === 'select' ? opt(k.options[0]).value : k.min ?? 0)]))
    const value = { ...initial, ...(ctx.value || {}) }
    const templated = /\{\{\s*[\w-]+\s*\}\}/.test(b.preview || '')
    const unit = (k) => (k.unit ?? '')
    const vars = () => knobs.map((k) => `--${k.id}: ${k.kind === 'toggle' ? (value[k.id] ? 1 : 0) : value[k.id]}${typeof value[k.id] === 'number' ? unit(k) : ''};`).join(' ')
    const fill = (s) => String(s || '').replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, id) => (id in value ? `${value[id]}${typeof value[id] === 'number' ? unit(knobs.find((k) => k.id === id) || {}) : ''}` : ''))
    const preview = h('iframe', { class: 'k-frame k-tune-frame', style: { height: `${b.height || 320}px` } })
    const write = () => (preview.srcdoc = docFor(fill(b.preview), `<style id="k-vars">:root{${vars()}}</style><style>${b.css || ''}</style>`))
    const apply = () => {
      ctx.set({ ...value })
      css.textContent = `:root {\n${vars().split('; ').join(';\n').replace(/^/gm, '  ')}\n}`
      const doc = preview.contentDocument
      if (templated || !doc?.getElementById('k-vars')) return write()
      doc.getElementById('k-vars').textContent = `:root{${vars()}}`
    }
    const css = h('pre', { class: 'k-code k-tune-css' })
    const controls = knobs.map((k) => {
      const out = h('output', { class: 'k-mono' })
      const show = () => (out.textContent = k.kind === 'toggle' ? (value[k.id] ? 'on' : 'off') : `${value[k.id]}${typeof value[k.id] === 'number' ? unit(k) : ''}`)
      const on = (v) => ((value[k.id] = v), show(), apply())
      show()
      let input
      if (k.kind === 'color') input = h('input', { type: 'color', value: value[k.id], oninput: (e) => on(e.target.value) })
      else if (k.kind === 'select') input = h('select', { onchange: (e) => on(e.target.value) }, k.options.map(opt).map((o) => h('option', { value: o.value, selected: String(value[k.id]) === String(o.value) }, o.label)))
      else if (k.kind === 'toggle') input = h('label', { class: 'k-switch' }, h('input', { type: 'checkbox', checked: !!value[k.id], onchange: (e) => on(e.target.checked) }), h('span'))
      else if (k.kind === 'text') input = h('input', { type: 'text', value: value[k.id], oninput: (e) => on(e.target.value) })
      else input = h('input', { type: 'range', min: k.min ?? 0, max: k.max ?? 100, step: k.step ?? 1, value: value[k.id], oninput: (e) => on(Number(e.target.value)) })
      return h('div', { class: 'k-knob' }, h('div', { class: 'k-row between' }, h('span', { class: 'k-label' }, k.label || words(k.id)), out), input)
    })
    write()
    css.textContent = `:root {\n${vars().split('; ').join(';\n').replace(/^/gm, '  ')}\n}`
    return h(
      'div',
      { class: 'k-tune' },
      h('div', { class: 'k-tune-knobs' }, controls, h('div', { class: 'k-row' }, h('button', { class: 'k-btn ghost small', onclick: () => (Object.assign(value, initial), ctx.set({ ...value }), redraw()) }, 'Reset'), h('button', { class: 'k-btn ghost small', onclick: () => navigator.clipboard.writeText(css.textContent).then(() => toast('CSS copied')) }, 'Copy CSS')), b.showCss === false ? null : css),
      preview
    )
    function redraw() {
      const fresh = blocks.tune(b, { ...ctx, value: { ...value } })
      document.querySelector(`[data-block="${ctx.id}"] .k-tune`)?.replaceWith(fresh)
    }
  })

  block('annotate', (b, ctx) => {
    let pins = ctx.value || []
    const img = h('img', { src: b.src, draggable: 'false', alt: '' })
    const layer = h('div', { class: 'k-pins' })
    const list = h('ol', { class: 'k-pin-list' })
    const save = () => ctx.set(pins.map((p) => ({ ...p })))
    const draw = (focus) => {
      layer.replaceChildren(...pins.map((p, i) => h('button', { class: 'k-pin', style: { left: `${p.x}%`, top: `${p.y}%` }, title: p.note || 'Pin', onclick: (e) => (e.stopPropagation(), list.children[i]?.querySelector('textarea')?.focus()) }, i + 1)))
      list.replaceChildren(
        ...pins.map((p, i) =>
          h('li', null, h('span', { class: 'k-pin static' }, i + 1), h('textarea', { class: 'k-note', rows: 1, placeholder: 'What about this spot?', value: p.note, oninput: (e) => ((p.note = e.target.value), save(), (layer.children[i].title = p.note)) }), h('button', { class: 'k-btn ghost small', title: 'Remove', onclick: () => ((pins = pins.filter((x) => x !== p)), save(), draw()) }, '✕'))
        )
      )
      if (!pins.length) list.append(h('li', { class: 'k-muted small' }, b.prompt || 'Click the image to drop a pin, then say what you see there.'))
      if (focus) list.lastChild.querySelector('textarea')?.focus()
    }
    const stage = h('div', {
      class: 'k-annotate-stage',
      onclick: (e) => {
        const r = img.getBoundingClientRect()
        const round = (n) => Math.round(Math.min(100, Math.max(0, n)) * 10) / 10
        pins.push({ x: round(((e.clientX - r.left) / r.width) * 100), y: round(((e.clientY - r.top) / r.height) * 100), note: '' })
        save()
        draw(true)
      }
    }, img, layer)
    draw()
    return h('div', { class: 'k-annotate' }, stage, list)
  })

  block('wipe', (b) => {
    const after = h('div', { class: 'k-wipe-after' }, h('img', { src: b.after, draggable: 'false', alt: '' }))
    const handle = h('div', { class: 'k-wipe-handle' })
    const box = h('div', { class: 'k-wipe' }, h('img', { src: b.before, draggable: 'false', alt: '' }), after, handle, h('span', { class: 'k-wipe-tag left' }, b.beforeLabel || 'Before'), h('span', { class: 'k-wipe-tag right' }, b.afterLabel || 'After'))
    const at = (p) => {
      after.style.clipPath = `inset(0 0 0 ${p}%)`
      handle.style.left = `${p}%`
    }
    const follow = (e) => {
      const r = box.getBoundingClientRect()
      at(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)))
    }
    box.addEventListener('pointerdown', (e) => (box.setPointerCapture(e.pointerId), follow(e)))
    box.addEventListener('pointermove', (e) => e.buttons && follow(e))
    at(50)
    return box
  })

  block('diff', (b) => {
    const a = String(b.before ?? '').split('\n')
    const z = String(b.after ?? '').split('\n')
    // Line LCS; fine for the few hundred lines a page shows.
    const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(z.length + 1))
    for (let i = a.length - 1; i >= 0; i--) for (let j = z.length - 1; j >= 0; j--) dp[i][j] = a[i] === z[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    const lines = []
    let i = 0
    let j = 0
    while (i < a.length || j < z.length) {
      if (i < a.length && j < z.length && a[i] === z[j]) {
        lines.push(` ${a[i++]}`)
        j++
      }
      else if (j < z.length && (i >= a.length || dp[i][j + 1] >= dp[i + 1][j])) lines.push(`+${z[j++]}`)
      else lines.push(`-${a[i++]}`)
    }
    return h('div', { class: 'k-codebox', html: codeHtml(lines.join('\n'), 'diff') })
  })

  const PALETTE = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)']
  block('chart', (b) => {
    const labels = b.labels || []
    const series = (b.series || []).map((s, n) => ({ color: PALETTE[n % PALETTE.length], ...s }))
    const W = 640
    const H = b.height || 240
    const pad = { l: 44, r: 12, t: 12, b: 28 }
    const all = series.flatMap((s) => s.values)
    const max = Math.max(0, ...all)
    const min = Math.min(0, ...all)
    const nice = (v) => {
      if (!v) return 0
      const p = Math.pow(10, Math.floor(Math.log10(Math.abs(v))))
      return Math.ceil(v / p) * p
    }
    const top = nice(max) || 1
    const bottom = min < 0 ? -nice(-min) : 0
    const y = (v) => pad.t + ((top - v) / (top - bottom)) * (H - pad.t - pad.b)
    const plotW = W - pad.l - pad.r
    const fmt = (v) => `${Math.abs(v) >= 1000 ? `${+(v / 1000).toFixed(1)}k` : +v.toFixed(2)}${b.unit || ''}`
    const svg = []
    for (let t = 0; t <= 4; t++) {
      const v = bottom + ((top - bottom) * t) / 4
      svg.push(`<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`)
    }
    const step = plotW / Math.max(labels.length, 1)
    labels.forEach((l, i) => svg.push(`<text x="${pad.l + step * i + step / 2}" y="${H - 8}" text-anchor="middle">${esc(l)}</text>`))
    if ((b.kind || 'bar') === 'line') {
      const x = (i) => pad.l + step * i + step / 2
      for (const s of series) {
        svg.push(`<polyline fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" points="${s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/>`)
        s.values.forEach((v, i) => svg.push(`<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${s.color}"><title>${esc(s.name || '')} ${esc(labels[i])}: ${fmt(v)}</title></circle>`))
      }
    } else {
      const group = step * 0.7
      const bw = group / Math.max(series.length, 1)
      series.forEach((s, n) =>
        s.values.forEach((v, i) => {
          const x0 = pad.l + step * i + (step - group) / 2 + bw * n
          svg.push(`<rect x="${x0 + 1}" width="${Math.max(bw - 2, 1)}" y="${Math.min(y(v), y(0))}" height="${Math.abs(y(v) - y(0))}" rx="2" fill="${s.color}"><title>${esc(s.name || '')} ${esc(labels[i])}: ${fmt(v)}</title></rect>`)
        })
      )
    }
    svg.push(`<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(0)}" y2="${y(0)}" class="axis"/>`)
    return h(
      'div',
      { class: 'k-chart' },
      series.length > 1 ? h('div', { class: 'k-legend' }, series.map((s) => h('span', null, h('i', { style: { background: s.color } }), s.name))) : null,
      h('div', { html: `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px">${svg.join('')}</svg>` })
    )
  })

  block('columns', (b, ctx) => h('div', { class: 'k-columns', style: { '--cols': b.blocks?.length || 2 } }, (b.blocks || []).map((x) => ctx.render(x))))

  block('tabs', (b, ctx) => {
    const tabs = b.tabs || []
    const panes = tabs.map((t) => h('div', { class: 'k-tab-pane' }, (t.blocks || []).map((x) => ctx.render(x))))
    const bar = h('div', { class: 'k-tabs', role: 'tablist' })
    const show = (n) => {
      panes.forEach((p, i) => (p.hidden = i !== n))
      bar.querySelectorAll('button').forEach((btn, i) => btn.setAttribute('aria-selected', String(i === n)))
    }
    bar.append(...tabs.map((t, i) => h('button', { role: 'tab', onclick: () => show(i) }, t.label || `Tab ${i + 1}`)))
    show(0)
    return h('div', null, bar, panes)
  })

  // ---------- page ----------

  let auto = 0
  function render(spec) {
    if (spec instanceof Node) return spec
    const type = spec.type || 'markdown'
    const fn = blocks[type]
    const id = spec.id || `${type}${++auto}`
    const ctx = { id, value: answers[id], set: (v) => set(id, v), render, md, h }
    let body
    try {
      body = fn ? fn(spec, ctx) : h('div', { class: 'k-callout danger' }, `Unknown block type "${type}"`)
    } catch (e) {
      body = h('div', { class: 'k-callout danger' }, `Block "${id}" failed: ${e.message}`)
      console.error(e)
    }
    const bare = spec.bare ?? ['columns', 'tabs'].includes(type)
    return h(
      'section',
      { class: `k-block k-block-${type} ${bare ? 'bare' : ''} ${spec.wide ? 'wide' : ''}`, 'data-block': id },
      spec.title ? h('h2', { class: 'k-block-title' }, spec.title) : null,
      spec.text && !['markdown', 'text', 'callout'].includes(type) ? h('div', { class: 'k-md k-muted k-block-desc', html: md(spec.text) }) : null,
      body
    )
  }

  async function page(spec) {
    if (!document.body) await new Promise((ok) => addEventListener('DOMContentLoaded', ok, { once: true }))
    answersName = spec.answers || 'answers'
    answers = (await store.load(answersName).catch(() => null)) || {}
    auto = 0
    if (spec.title) document.title = spec.title
    document.body.classList.add('k-body')
    const done = spec.submit === false ? null : h('button', { class: 'k-btn primary' }, spec.submit || 'Done')
    const doneAt = h('span', { class: 'k-muted small' })
    const stamp = () => (doneAt.textContent = answers._done ? `Sent ${new Date(answers._done).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Tell Claude you're done.` : '')
    if (done)
      done.onclick = () => {
        answers._done = new Date().toISOString()
        persist().then(() => {
          stamp()
          toast("Saved. Tell Claude you're done and it'll read your answers.", 'ok')
        })
      }
    stamp()
    const main = h(
      'main',
      { class: `k-page ${spec.width || ''}` },
      h('header', { class: 'k-header' }, h('div', null, spec.kicker ? h('div', { class: 'k-kicker' }, spec.kicker) : null, spec.title ? h('h1', null, spec.title) : null), chip),
      spec.intro ? h('div', { class: 'k-md k-intro', html: md(spec.intro) }) : null,
      (spec.blocks || []).map(render),
      done ? h('footer', { class: 'k-footer' }, doneAt, done) : null
    )
    document.body.append(main)
    chip.textContent = Object.keys(answers).length ? 'Restored' : ''
    chip.dataset.state = 'ok'
    return main
  }

  window.kit = { page, block, render, h, md, esc, toast, lightbox, set, get answers() { return answers }, save: persist }
})()
