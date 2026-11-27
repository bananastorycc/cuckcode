import { readFile } from 'node:fs/promises'
import type { MainHost } from 'cuckcode/plugin'

// The main side: Node, for what a page can't do itself. The renderer calls it with
// host.invoke('lines', path). Never block here: async fs and execFile only.
export function activate(host: MainHost): void {
  host.handle('lines', async (path: string) => (await readFile(path, 'utf8')).split('\n').length)
}
