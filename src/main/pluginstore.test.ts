import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { pluginStore } from './pluginstore'

// A plugin's store, in a temp folder (never the app's data).

const root = mkdtempSync(join(tmpdir(), 'cuckcode-store-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('a plugin store', () => {
  it('keeps JSON values by key, in its own folder, and forgets deleted ones', async () => {
    const s = pluginStore(join(root, 'a'))
    expect(await s.get('missing')).toBeUndefined()
    await s.set('notes', { list: [1, 'two'], on: true })
    expect(await s.get('notes')).toEqual({ list: [1, 'two'], on: true })
    expect(JSON.parse(readFileSync(join(root, 'a', 'notes.json'), 'utf8'))).toEqual({ list: [1, 'two'], on: true })
    // Another plugin's folder holds another namespace.
    expect(await pluginStore(join(root, 'b')).get('notes')).toBeUndefined()
    await s.delete('notes')
    await s.delete('notes')
    expect(await s.get('notes')).toBeUndefined()
  })

  it('runs one key in call order, so the last set wins, and leaves no temp files', async () => {
    const s = pluginStore(join(root, 'order'))
    await Promise.all(Array.from({ length: 20 }, (_, i) => s.set('n', i)))
    expect(await s.get('n')).toBe(19)
    void s.set('n', 'last')
    expect(await s.get('n')).toBe('last')
    expect(readdirSync(join(root, 'order'))).toEqual(['n.json'])
  })

  it('refuses keys that could leave its folder, and values that are not JSON', async () => {
    const s = pluginStore(join(root, 'c'))
    for (const key of ['../x', 'a/b', '.hidden', '', 7]) await expect(s.set(key as string, 1)).rejects.toThrow('a key must match')
    await expect(s.set('f', () => 1)).rejects.toThrow("isn't JSON")
    await expect(s.set('u', undefined)).rejects.toThrow("isn't JSON")
  })

  it('refuses to write anywhere but an absolute folder', async () => {
    await expect(pluginStore('a').set('k', 1)).rejects.toThrow('no data folder')
  })

  it("refuses an unloaded plugin's calls", async () => {
    let dead = false
    const s = pluginStore(join(root, 'd'), () => dead)
    await s.set('k', 1)
    dead = true
    await expect(s.get('k')).rejects.toThrow('was unloaded')
    await expect(s.set('k', 2)).rejects.toThrow('was unloaded')
  })
})
