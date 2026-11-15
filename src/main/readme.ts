import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const NAME = /^readme(\.(md|markdown|txt))?$/i

// The folder's README, preferring the markdown one when there are several. null when there's none.
export async function readme(dir: string): Promise<{ name: string; text: string } | null> {
  try {
    const names = (await readdir(dir)).filter((n) => NAME.test(n))
    const name = names.find((n) => /\.md$/i.test(n)) ?? names[0]
    return name ? { name, text: await readFile(join(dir, name), 'utf8') } : null
  } catch {
    return null
  }
}
