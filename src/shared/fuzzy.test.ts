import { describe, expect, it } from 'vitest'
import { fuzzy } from './fuzzy'

describe('fuzzy', () => {
  it('prefers the file name over the folders', () => {
    expect(fuzzy('app', ['src/app/index.ts', 'src/renderer/App.tsx'])[0]).toBe('src/renderer/App.tsx')
  })

  it('prefers a run over scattered letters', () => {
    expect(fuzzy('git', ['src/g/i/t.ts', 'src/main/git.ts'])[0]).toBe('src/main/git.ts')
  })

  it('matches word starts across the path', () => {
    expect(fuzzy('rcgp', ['src/renderer/src/components/GitPanel.tsx', 'README.md'])).toEqual([
      'src/renderer/src/components/GitPanel.tsx'
    ])
  })

  it('ignores case and spaces, and drops non-matches', () => {
    expect(fuzzy('code pane', ['CodePane.tsx', 'Header.tsx'])).toEqual(['CodePane.tsx'])
  })

  it('prefers the shorter of two equal matches', () => {
    expect(fuzzy('index', ['src/main/index.ts', 'index.ts'])[0]).toBe('index.ts')
  })

  it('returns nothing for an empty query, and respects the limit', () => {
    expect(fuzzy(' ', ['a.ts'])).toEqual([])
    expect(fuzzy('a', ['a1', 'a2', 'a3'], 2)).toHaveLength(2)
  })
})
