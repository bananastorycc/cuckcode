// One CommonJS file per side, as cuckcode loads them, with cuckcode's own recipe (BUILD): the
// renderer leaves the host's modules (React, Monaco) to the host and bundles everything else in.
import { build } from 'esbuild'
import { copyFile, mkdir } from 'node:fs/promises'
import { BUILD } from '../../src/shared/plugin.ts'

await mkdir('dist', { recursive: true })
await Promise.all([
  build({ ...BUILD.main, entryPoints: ['src/main.ts'], outfile: 'dist/main.js' }),
  build({ ...BUILD.renderer, entryPoints: ['src/renderer.tsx'], outfile: 'dist/renderer.js' }),
  copyFile('src/style.css', 'dist/style.css')
])
