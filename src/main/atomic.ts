import { access, chmod, constants, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

// The suffix of the temp files below; the watcher ignores them.
export const TMP_SUFFIX = '.cuckcode-tmp'

let n = 0

// Writes beside the file, then renames over it, so dying mid-write leaves the old file whole
// rather than truncated. A symlink is followed (the link stays, its target is rewritten), the
// file keeps its permissions, and a read-only file still refuses the write.
export async function writeAtomic(path: string, content: string): Promise<void> {
  const target = await realpath(path).catch(() => path)
  const info = await stat(target).catch(() => null)
  if (info) await access(target, constants.W_OK)
  const tmp = join(dirname(target), `.${basename(target)}.${process.pid}-${n++}${TMP_SUFFIX}`)
  try {
    await writeFile(tmp, content, 'utf8')
    if (info) await chmod(tmp, info.mode & 0o7777)
    await rename(tmp, target)
  } catch (err) {
    await rm(tmp, { force: true })
    throw err
  }
}
