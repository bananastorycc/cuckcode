import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AgentRequest, AgentRunEvent, Api, MenuCommand, RunExit, Settings, SyncStatus } from '../shared/types'

// One IPC listener per channel, fanned out by PTY id, instead of every terminal
// filtering every chunk.
function router<T>(channel: string): (id: string, cb: (data: T) => void) => () => void {
  const subs = new Map<string, Set<(data: T) => void>>()
  ipcRenderer.on(channel, (_e, id: string, data: T) => subs.get(id)?.forEach((cb) => cb(data)))
  return (id, cb) => {
    if (!subs.has(id)) subs.set(id, new Set())
    subs.get(id)!.add(cb)
    return () => {
      const set = subs.get(id)
      if (set?.delete(cb) && !set.size) subs.delete(id)
    }
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
  runStart: (id, spec, cols, rows) => ipcRenderer.invoke('run:start', id, spec, cols, rows),
  runStop: (id) => ipcRenderer.send('run:stop', id),
  agentTaken: (id, taken) => ipcRenderer.send('agent:taken', id, taken),
  agentAnswer: (id, output) => ipcRenderer.invoke('agent:answer', id, output),
  agentRunStart: (plugin, run) => ipcRenderer.invoke('agentrun:start', plugin, run),
  agentRunEvents: (plugin, id) => ipcRenderer.invoke('agentrun:events', plugin, id),
  agentRunStop: (plugin, id) => ipcRenderer.send('agentrun:stop', plugin, id),

  status: (cwd) => ipcRenderer.invoke('git:status', cwd),
  files: (root) => ipcRenderer.invoke('git:files', root),
  snapshot: (root, file) => ipcRenderer.invoke('git:snapshot', root, file),
  branches: (cwd) => ipcRenderer.invoke('git:branches', cwd),
  log: (cwd, skip) => ipcRenderer.invoke('git:log', cwd, skip),
  commitFiles: (root, sha) => ipcRenderer.invoke('git:commitFiles', root, sha),
  git: (cwd, op, arg) => ipcRenderer.invoke('git:op', cwd, op, arg),
  discard: (root, file) => ipcRenderer.invoke('git:discard', root, file),
  setRemote: (cwd, name, url) => ipcRenderer.invoke('git:setRemote', cwd, name, url),
  pluginGitStatus: (dir) => ipcRenderer.invoke('git:pluginStatus', dir),
  pluginGit: (dir, op, message) => ipcRenderer.invoke('git:pluginOp', dir, op, message),
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
  pluginReload: (path) => ipcRenderer.invoke('plugins:reload', path),
  pluginInvoke: (id, name, args) => ipcRenderer.invoke('plugin:invoke', id, name, args),
  pluginStore: (id, op, key, value) => ipcRenderer.invoke('plugin:store', id, op, key, value),
  pluginInstall: (url) => ipcRenderer.invoke('plugin:install', url),
  pluginInfo: (path, fetch) => ipcRenderer.invoke('plugin:info', path, fetch),
  pluginUpdate: (path) => ipcRenderer.invoke('plugin:update', path),
  pluginUninstall: (path) => ipcRenderer.invoke('plugin:uninstall', path),
  exportConfig: () => ipcRenderer.invoke('config:export'),
  importConfig: () => ipcRenderer.invoke('config:import'),
  syncNow: () => ipcRenderer.send('config:syncNow'),
  syncStatus: () => ipcRenderer.invoke('config:syncStatus'),

  onPtyData: router<string>('pty:data'),
  onPtyExit: router<RunExit | undefined>('pty:exit'),
  onAgentRequest: (cb) => listen<AgentRequest>('agent:request', cb),
  onAgentRunEvent: router<AgentRunEvent>('agentrun:event'),
  onAgentRequestEnd: (cb) => listen<string>('agent:requestEnd', cb),
  onFsChange: (cb) => {
    const fn = (_e: IpcRendererEvent, project: string, paths: string[] | null): void => cb(project, paths)
    ipcRenderer.on('fs:change', fn)
    return () => ipcRenderer.removeListener('fs:change', fn)
  },
  onMenu: (cb) => listen<MenuCommand>('menu', cb),
  onRemoteConfig: (cb) => listen<Settings>('config:remote', cb),
  onRemoteScratch: (cb) => listen<string>('scratch:remote', cb),
  onSyncStatus: (cb) => listen<SyncStatus>('config:status', cb),
  onFlush: (cb) => listen('app:flush', () => void cb().finally(() => ipcRenderer.send('app:flushed')))
}

contextBridge.exposeInMainWorld('api', api)
