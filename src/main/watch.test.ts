import { describe, expect, it } from 'vitest'
import { isRelevant } from './watch'

describe('isRelevant', () => {
  it('keeps source changes and git state changes', () => {
    for (const p of ['src/a.ts', 'README.md', '.gitignore', '.git/index', '.git/HEAD', '.git/refs/heads/main', '.cuckcode/playground/1/index.html', '.cuckcode/playground/1/img/data/a.png', null]) {
      expect(isRelevant(p)).toBe(true)
    }
  })

  it('drops noise', () => {
    for (const p of ['node_modules/x/index.js', 'pkg/node_modules/y', '.git/objects/ab/cdef', '.git/index.lock', 'vendor/sub/.git/HEAD', 'a/.DS_Store', '.cuckcode/playground/1/data/a.json.tmp', '.cuckcode/playground/10/data/answers.json']) {
      expect(isRelevant(p)).toBe(false)
    }
  })
})
