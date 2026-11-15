// Entry point of the installed cuckcode.app. The bundle holds only this file; the real
// app lives in the git checkout. Each launch: pull, npm install if the lockfile changed,
// rebuild if sources changed, then run <repo>/out/main. Plain JS: it must run without a build.
const { app, BrowserWindow, dialog, protocol } = require('electron')
const { execFile } = require('node:child_process')
const { existsSync, readdirSync, rmSync, renameSync, statSync } = require('node:fs')
const { homedir } = require('node:os')
const { join } = require('node:path')

const repo = require('../package.json').repo ?? join(__dirname, '..')
const run = (cmd, args, timeout = 600_000) =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, { cwd: repo, timeout, env: process.env, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(new Error(`${cmd} ${args.join(' ')}\n\n${(stderr || stdout || err.message).trim()}`)) : resolve(stdout.trim())
    )
  )
const mtime = (p) => (existsSync(p) ? statSync(p).mtimeMs : 0)
const newestIn = (p) =>
  !existsSync(p) ? 0 : statSync(p).isDirectory() ? Math.max(0, ...readdirSync(p).map((f) => newestIn(join(p, f)))) : mtime(p)

process.env.PATH = ['/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local/bin'), process.env.PATH].join(':')
if (!app.requestSingleInstanceLock()) app.exit(0)
app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0]
  win?.show()
  win?.focus()
})
// Must happen before 'ready'; the real main skips its own registration once ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }
])

let splash = null
const status = (text) =>
  splash?.webContents.executeJavaScript(`document.getElementById('s').textContent = ${JSON.stringify(text)}`).catch(() => {})

function showSplash() {
  splash = new BrowserWindow({ width: 300, height: 90, frame: false, resizable: false, show: false, transparent: true })
  const html = `<body style="margin:0;height:100vh;display:flex;flex-direction:column;justify-content:center;align-items:center;
    font:13px system-ui,-apple-system,sans-serif;border-radius:12px;background:light-dark(#fff,#161b22);color:light-dark(#1f2328,#c9d1d9);color-scheme:light dark">
    <b>cuckcode</b><span id="s" style="opacity:.6;margin-top:6px">Checking for updates…</span></body>`
  splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  splash.once('ready-to-show', () => splash?.show())
}

async function update() {
  try {
    await run('git', ['fetch', '-q'], 5_000)
    if (Number(await run('git', ['rev-list', '--count', 'HEAD..@{u}'])) > 0) {
      status('Pulling…')
      await run('git', ['pull', '-q', '--rebase', '--autostash']).catch(() => run('git', ['rebase', '--abort']).catch(() => {}))
    }
  } catch {
    // Offline or no upstream: launch what's here.
  }

  if (mtime(join(repo, 'package-lock.json')) > mtime(join(repo, 'node_modules/.package-lock.json'))) {
    status('Installing dependencies…')
    await run('npm', ['install', '--no-audit', '--no-fund'])
  }

  // Oldest of the three: `npm run dev` rewrites out/main and out/preload but never out/renderer,
  // so out/main alone can look fresh while the UI is stale.
  const outputs = ['out/main/index.js', 'out/preload/index.js', 'out/renderer/index.html']
  const built = Math.min(...outputs.map((p) => mtime(join(repo, p))))
  const inputs = ['src', 'package.json', 'electron.vite.config.ts']
  if (Math.max(...inputs.map((p) => newestIn(join(repo, p)))) > built) {
    status('Building…')
    const next = join(repo, 'out.next')
    rmSync(next, { recursive: true, force: true })
    await run(join(repo, 'node_modules/.bin/electron-vite'), ['build', '--outDir', next])
    rmSync(join(repo, 'out'), { recursive: true, force: true })
    renameSync(next, join(repo, 'out'))
  }
}

app.whenReady().then(async () => {
  const timer = setTimeout(showSplash, 400) // only flash a splash if updating takes a while
  try {
    await update()
  } catch (err) {
    clearTimeout(timer)
    const hasBuild = existsSync(join(repo, 'out/main/index.js'))
    const { response } = await dialog.showMessageBox({
      type: 'error',
      message: 'cuckcode update failed',
      detail: String(err.message).slice(0, 2000),
      buttons: hasBuild ? ['Launch previous build', 'Quit'] : ['Quit']
    })
    if (!hasBuild || response === 1) return app.exit(1)
  }
  clearTimeout(timer)

  const repoElectron = require(join(repo, 'node_modules/electron/package.json')).version
  if (repoElectron !== process.versions.electron) {
    dialog.showMessageBoxSync({
      type: 'warning',
      message: 'Electron version changed',
      detail: `The repo now uses Electron ${repoElectron}; this app is ${process.versions.electron}. Run \`npm run app\` in ${repo} to reinstall.`
    })
  }

  app.once('browser-window-created', (_e, win) => win.once('ready-to-show', () => splash?.destroy()))
  require(join(repo, 'out/main/index.js'))
})
