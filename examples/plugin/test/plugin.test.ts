import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import * as main from '../src/main'
import * as renderer from '../src/renderer'
import { fakeRenderer } from './fakehost'

const dir = mkdtempSync(join(tmpdir(), 'cuckcode-example-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('the example plugin', () => {
  it('registers its panel for the manifest command, and a file tree item', async () => {
    const fake = fakeRenderer()
    await renderer.activate(fake.host)
    expect(fake.panels.map((p) => [p.id, p.command])).toEqual([['pins', 'pins']])
    expect(fake.menus.map((m) => [m.where, m.title])).toEqual([['files', 'Pin / Unpin']])
  })

  it('pins and unpins the right-clicked path, in its store, and shows the panel', async () => {
    const fake = fakeRenderer()
    await renderer.activate(fake.host)
    fake.menus[0].run('/p/a.ts')
    fake.menus[0].run('/p/b.ts')
    await Promise.resolve()
    expect(fake.store.data.get('pins')).toEqual(['/p/a.ts', '/p/b.ts'])
    expect(fake.shown).toEqual(['pins', 'pins'])
    fake.menus[0].run('/p/a.ts')
    await Promise.resolve()
    expect(fake.store.data.get('pins')).toEqual(['/p/b.ts'])
  })

  it('starts from what the store kept, as after a reload or relaunch', async () => {
    const fake = fakeRenderer()
    await fake.store.set('pins', ['/p/kept.ts'])
    await renderer.activate(fake.host)
    fake.menus[0].run('/p/new.ts')
    await Promise.resolve()
    expect(fake.store.data.get('pins')).toEqual(['/p/kept.ts', '/p/new.ts'])
  })

  it("counts a file's lines on the main side, through invoke", async () => {
    const fake = fakeRenderer()
    main.activate(fake.main)
    const file = join(dir, 'three.txt')
    writeFileSync(file, 'a\nb\nc')
    expect(await fake.host.invoke('lines', file)).toBe(3)
    await expect(fake.host.invoke('lines', join(dir, 'missing'))).rejects.toThrow('ENOENT')
  })
})
