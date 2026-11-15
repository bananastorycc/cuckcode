import { useEffect, useState } from 'react'
import { Download, FolderOpen, GitBranch, RefreshCw, RotateCcw, Trash2, X } from 'lucide-react'
import type { PluginInfo, PluginStatus } from '../../../shared/plugin'
import type { PluginRef } from '../../../shared/types'
import { usePlugins } from '../plugins'
import { tildify } from './Header'
import { Markdown } from './Readme'

interface Props {
  plugins: PluginRef[]
  onChange: (plugins: PluginRef[]) => void
  onClose: () => void
}

const field = 'min-w-0 select-text rounded-sm border border-line bg-bg px-2 py-1 font-mono text-xs text-fg outline-hidden focus:border-accent'
const name = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

// Plugins are git repos: install one from its URL, update it with a pull (cuckcode also pulls
// each one at launch), read its README here. Changes take effect on relaunch.
export default function Plugins({ plugins, onChange, onClose }: Props): React.JSX.Element {
  const loaded = usePlugins()
  const [launched, setLaunched] = useState<PluginStatus[] | null>(null)
  const [infos, setInfos] = useState<Record<string, PluginInfo | null>>({})
  const [readmes, setReadmes] = useState<Record<string, { name: string; text: string } | null>>({})
  const [selected, setSelected] = useState<string | null>(plugins[0]?.path ?? null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState<string | null>(null) // what's running: 'install', or a plugin's path
  const [error, setError] = useState('')
  // Pulled or installed since launch: the new code runs after a relaunch.
  const [changed, setChanged] = useState(false)

  useEffect(() => {
    window.api.plugins().then(setLaunched, () => setLaunched([]))
  }, [])

  const check = (path: string, fetch: boolean): void => {
    window.api.pluginInfo(path, fetch).then((i) => setInfos((r) => ({ ...r, [path]: i })))
  }
  // Fetched once per opening, so "N new commits" is current; each repo on its own.
  useEffect(() => {
    for (const p of plugins) check(p.path, true)
  }, [])

  useEffect(() => {
    if (!selected || selected in readmes) return
    window.api.readme(selected).then(
      (r) => setReadmes((x) => ({ ...x, [selected]: r })),
      () => setReadmes((x) => ({ ...x, [selected]: null }))
    )
  }, [selected])

  useEffect(() => {
    if (selected && !plugins.some((p) => p.path === selected)) setSelected(plugins[0]?.path ?? null)
  }, [plugins, selected])

  const add = (path: string): void => {
    if (!plugins.some((p) => p.path === path)) onChange([...plugins, { path, enabled: true }])
    setSelected(path)
    setChanged(true)
    check(path, false)
  }

  const install = async (): Promise<void> => {
    const u = url.trim()
    if (!u || busy) return
    setBusy('install')
    setError('')
    try {
      add(await window.api.pluginInstall(u))
      setUrl('')
    } catch (err) {
      setError(String((err as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(null)
    }
  }

  const addFolder = async (): Promise<void> => {
    const dir = await window.api.pickFolder()
    if (dir) add(dir)
  }

  const update = async (path: string): Promise<void> => {
    setBusy(path)
    setError('')
    try {
      await window.api.pluginUpdate(path)
      setChanged(true)
      setReadmes(({ [path]: _, ...rest }) => rest)
    } catch (err) {
      setError(String((err as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(null)
      check(path, false)
      setInfos((r) => (r[path] ? { ...r, [path]: { ...r[path]!, behind: 0 } } : r))
    }
  }

  const remove = async (path: string): Promise<void> => {
    const own = infos[path]?.managed
    if (!confirm(own ? `Remove ${name(path)}? Its folder goes to the Trash.` : `Remove ${name(path)} from cuckcode? The folder stays where it is.`)) return
    await window.api.pluginUninstall(path).catch(() => {})
    onChange(plugins.filter((p) => p.path !== path))
  }

  const status = (path: string): PluginStatus | undefined => launched?.find((s) => s.path === path)
  const restart =
    changed || (!!launched && JSON.stringify(launched.map((s) => [s.path, s.enabled])) !== JSON.stringify(plugins.map((p) => [p.path, p.enabled])))
  const current = plugins.find((p) => p.path === selected) ?? null
  const info = current ? infos[current.path] : undefined
  const readme = current ? readmes[current.path] : undefined

  return (
    <div className="flex h-full flex-col bg-bg text-xs">
      <div className="flex h-8 shrink-0 items-center border-b border-line bg-panel px-3 font-mono text-muted">
        plugins
        <button className="btn ml-auto text-muted" onClick={onClose} title="Close">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <input
          className={`flex-1 ${field}`}
          value={url}
          disabled={busy === 'install'}
          placeholder="Install from a git URL: https://… or git@host:me/plugin.git"
          spellCheck={false}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && install()}
        />
        <button className="btn" disabled={!url.trim() || !!busy} onClick={install}>
          <Download className="h-3.5 w-3.5" /> {busy === 'install' ? 'Installing…' : 'Install'}
        </button>
        <button className="btn text-muted" onClick={addFolder} title="Use a plugin you cloned yourself (it's pulled at launch too, when clean)">
          <FolderOpen className="h-3.5 w-3.5" /> Add folder…
        </button>
      </div>
      {(error || restart) && (
        <div className="flex shrink-0 flex-col gap-1 border-b border-line px-3 py-2">
          {error && <pre className="select-text whitespace-pre-wrap font-mono text-del">{error}</pre>}
          {restart && (
            <div className="flex items-center gap-2 text-muted">
              Changes take effect after a relaunch.
              <button className="btn text-fg" onClick={() => window.api.relaunch()}>
                <RotateCcw className="h-3.5 w-3.5" /> Relaunch
              </button>
            </div>
          )}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <ul className="w-72 shrink-0 overflow-y-auto border-r border-line bg-panel py-1">
          {plugins.map((p) => {
            const s = status(p.path)
            const i = infos[p.path]
            const err = s?.error ?? loaded.find((l) => l.id === s?.id)?.error
            return (
              <li
                key={p.path}
                onClick={() => setSelected(p.path)}
                className={`flex cursor-default items-start gap-2 px-3 py-1.5 ${p.path === selected ? 'bg-hover' : 'hover:bg-hover'}`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 accent-accent"
                  checked={p.enabled}
                  title={p.enabled ? 'Enabled' : 'Disabled'}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onChange(plugins.map((x) => (x.path === p.path ? { ...x, enabled: e.target.checked } : x)))}
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-fg">{s?.name ?? name(p.path)}</span>
                  {err ? (
                    <span className="truncate text-del" title={err}>
                      {err}
                    </span>
                  ) : i?.behind ? (
                    <span className="text-accent">
                      {i.behind} new {i.behind === 1 ? 'commit' : 'commits'}
                    </span>
                  ) : (
                    <span className="truncate text-muted">{i === undefined ? '…' : i ? `${i.commit} · ${ago(i.date)}` : 'not a git repo'}</span>
                  )}
                </div>
              </li>
            )
          })}
          {!plugins.length && <li className="px-3 py-2 text-muted">No plugins yet. Install one from its git URL above.</li>}
        </ul>
        {current ? (
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 flex-col gap-1 border-b border-line px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-fg">{status(current.path)?.name ?? name(current.path)}</span>
                <div className="ml-auto flex items-center gap-1">
                  {info?.remote && (
                    <button className="btn" disabled={!!busy || info.dirty} onClick={() => update(current.path)} title={info.dirty ? 'It has local changes' : 'git pull'}>
                      <RefreshCw className={`h-3.5 w-3.5 ${busy === current.path ? 'animate-spin' : ''}`} />
                      {info.behind ? `Update (${info.behind})` : 'Update'}
                    </button>
                  )}
                  <button className="btn text-muted hover:text-del" onClick={() => remove(current.path)} title="Remove">
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </button>
                </div>
              </div>
              {info?.remote && (
                <span className="flex items-center gap-1 truncate font-mono text-muted">
                  <GitBranch className="h-3 w-3 shrink-0" /> {info.remote}
                </span>
              )}
              <span className="truncate font-mono text-muted">{tildify(current.path)}</span>
              {info && (
                <span className="truncate text-muted">
                  {info.commit} {info.subject} · {ago(info.date)}
                  {info.dirty && <span className="text-mod"> · local changes</span>}
                </span>
              )}
              {status(current.path)?.note && <span className="text-muted">At launch: {status(current.path)!.note}</span>}
              {status(current.path)?.error && <pre className="select-text whitespace-pre-wrap font-mono text-del">{status(current.path)!.error}</pre>}
            </div>
            {readme ? (
              <Markdown dir={current.path} text={readme.text} className="min-h-0 flex-1 overflow-auto px-8 py-6" />
            ) : (
              <div className="flex flex-1 items-center justify-center text-muted">{readme === null ? 'No README.' : ''}</div>
            )}
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-muted">Pick a plugin to see its README.</div>
        )}
      </div>
    </div>
  )
}

function ago(seconds: number): string {
  const d = Math.floor((Date.now() / 1000 - seconds) / 86400)
  return d < 1 ? 'today' : d === 1 ? 'yesterday' : d < 60 ? `${d} days ago` : new Date(seconds * 1000).toLocaleDateString()
}
