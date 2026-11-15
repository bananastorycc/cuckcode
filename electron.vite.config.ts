import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'

// package.json's version is the one source of truth; see Versioning in the README.
const define = { __VERSION__: JSON.stringify(JSON.parse(readFileSync('package.json', 'utf8')).version) }

// Dependencies are externalized in main and preload by default.
export default defineConfig({
  main: { define },
  preload: {},
  renderer: { define, plugins: [react(), tailwindcss()] }
})
