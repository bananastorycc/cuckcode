import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Api, MenuCommand } from '../shared/types'

// One IPC listener per channel, fanned out by PTY id, instead of every terminal
// filtering every chunk.
function router(channel: string): (id: string, cb: (data: string) => void) => () => void {
  const subs = new Map<string, Set<(data: string) => void>>()
  ipcRenderer.on(channel, (_e, id: string, data: string) => subs.get(id)?.forEach((cb) => cb(data)))
  return (id, cb) => {
    if (!subs.has(id)) subs.set(id, new Set())
    subs.get(id)!.add(cb)
    return () => subs.get(id)?.delete(cb)
  }
}

function listen<T>(channel: string, cb: (arg: T) => void): () => void {
  const fn = (_e: IpcRendererEvent, arg: T): void => cb(arg)
  ipcRenderer.on(channel, fn)
  return () => ipcRenderer.removeListener(channel, fn)
}

const api: Api = {
  init: () => ipcRenderer.invoke('app:init'),
  save: (settings) => ipcRenderer.send('app:save', settings),
  defaults: () => ipcRenderer.invoke('app:defaults'),
  pickFolder: () => ipcRenderer.invoke('app:pickFolder'),
  repos: (dir) => ipcRenderer.invoke('repos:list', dir),
  setUpRepo: (dir, remote, name) => ipcRenderer.invoke('repos:setUp', dir, remote, name),
  focus: () => ipcRenderer.send('app:focus'),
  watch: (projects) => ipcRenderer.send('app:watch', projects),

  ptyStart: (id, cols, rows) => ipcRenderer.invoke('pty:start', id, cols, rows),
  ptyRestart: (id, cols, rows) => ipcRenderer.invoke('pty:restart', id, cols, rows),
  ptyWrite: (id, data) => ipcRenderer.send('pty:write', id, data),
  ptyResize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
  ptyKill: (id) => ipcRenderer.send('pty:kill', id),

  status: (cwd) => ipcRenderer.invoke('git:status', cwd),
  files: (root) => ipcRenderer.invoke('git:files', root),
  snapshot: (root, file) => ipcRenderer.invoke('git:snapshot', root, file),
  branches: (cwd) => ipcRenderer.invoke('git:branches', cwd),
  log: (cwd, skip) => ipcRenderer.invoke('git:log', cwd, skip),
  commitFiles: (root, sha) => ipcRenderer.invoke('git:commitFiles', root, sha),
  git: (cwd, op, arg) => ipcRenderer.invoke('git:op', cwd, op, arg),
  discard: (root, file) => ipcRenderer.invoke('git:discard', root, file),
  setRemote: (cwd, name, url) => ipcRenderer.invoke('git:setRemote', cwd, name, url),
  writeFile: (path, content) => ipcRenderer.invoke('fs:write', path, content),
  createFile: (path) => ipcRenderer.invoke('fs:create', path),
  rename: (from, to) => ipcRenderer.invoke('fs:rename', from, to),
  trash: (path) => ipcRenderer.invoke('fs:trash', path),
  scratchRead: () => ipcRenderer.invoke('scratch:read'),
  scratchWrite: (text) => ipcRenderer.invoke('scratch:write', text),
  search: (root, q) => ipcRenderer.invoke('search:find', root, q),
  replace: (root, q, replacement, paths) => ipcRenderer.invoke('search:replace', root, q, replacement, paths),
  playVersion: (project, slot) => ipcRenderer.invoke('play:version', project, slot),
  playSave: (project, slot, name, text) => ipcRenderer.invoke('play:save', project, slot, name, text),
  readme: (dir) => ipcRenderer.invoke('readme', dir),
  browse: (dir) => ipcRenderer.invoke('browse:list', dir),
  reveal: (path) => ipcRenderer.send('app:reveal', path),
  plugins: () => ipcRenderer.invoke('plugins:list'),
  pluginRenderers: () => ipcRenderer.invoke('plugins:renderers'),
  pluginInvoke: (id, name, args) => ipcRenderer.invoke('plugin:invoke', id, name, args),
  pluginInstall: (url) => ipcRenderer.invoke('plugin:install', url),
  pluginInfo: (path, fetch) => ipcRenderer.invoke('plugin:info', path, fetch),
  pluginUpdate: (path) => ipcRenderer.invoke('plugin:update', path),
  pluginUninstall: (path) => ipcRenderer.invoke('plugin:uninstall', path),
  relaunch: () => ipcRenderer.send('app:relaunch'),
  usage: () => ipcRenderer.invoke('usage'),
  junieBalance: (license) => ipcRenderer.invoke('junieBalance', license),

  onPtyData: router('pty:data'),
  onPtyExit: router('pty:exit'),
  onFsChange: (cb) => {
    const fn = (_e: IpcRendererEvent, project: string, paths: string[] | null): void => cb(project, paths)
    ipcRenderer.on('fs:change', fn)
    return () => ipcRenderer.removeListener('fs:change', fn)
  },
  onMenu: (cb) => listen<MenuCommand>('menu', cb),
  onFlush: (cb) => listen('app:flush', () => void cb().finally(() => ipcRenderer.send('app:flushed')))
}

contextBridge.exposeInMainWorld('api', api)
