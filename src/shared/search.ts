import type { SearchQuery } from './types'

// One regex for both processes, so the highlighted matches, the replace preview and
// the actual replace never disagree. Throws on an invalid user regex.
export function toRegExp(q: SearchQuery, global = true): RegExp {
  let src = q.regex ? q.text : q.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (q.word) src = `\\b(?:${src})\\b`
  return new RegExp(src, (global ? 'g' : '') + (q.caseSensitive ? '' : 'i'))
}

// Literal replacements must not expand `$1`/`$&`; regex ones should.
export function replaceIn(text: string, re: RegExp, q: SearchQuery, replacement: string): string {
  return q.regex ? text.replace(re, replacement) : text.replace(re, () => replacement)
}
