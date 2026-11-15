import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Puzzle, RefreshCw, Save, Trash2, X } from 'lucide-react'
import type { Agent, AgentType, Config, SavedLayout, Settings as AllSettings, SyncStatus, Theme } from '../../../shared/types'
import { MAX_SLOTS } from '../../../shared/types'
import { apply, current, load, PRESETS, valid } from '../layout'
import { tildify } from './Header'

interface Props {
  config: Config
  theme: Theme
  onTheme: () => void
  layouts: SavedLayout[]
  onLayouts: (layouts: SavedLayout[]) => void
  onChange: (config: Config) => void
  onClose: () => void
  onPlugins: () => void
  onReset: () => void
  onImport: (settings: AllSettings) => void
}

const field = 'min-w-0 select-text rounded-sm border border-line bg-bg px-2 py-1 font-mono text-xs text-fg outline-hidden focus:border-accent'
// Shortcut digits: 1–9, then 0 for the tenth.
const digit = (i: number): string => String((i + 1) % 10)

const TYPES: { type: AgentType; label: string }[] = [
  { type: 'claude', label: 'Claude Code' },
  { type: 'junie', label: 'Junie' },
  { type: 'command', label: 'Command' }
]

// ipcRenderer.invoke wraps it: "Error invoking remote method 'x': Error: <message>"
const message = (err: unknown): string => String((err as Error).message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

// Ids key PTYs, so they're made once and never follow later renames.
const newId = (name: string): string => `${name.toLowerCase().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'agent'}-${Date.now().toString(36)}`

// Full-window, over everything. Every change saves at once.
export default function Settings({ config, theme, onTheme, layouts, onLayouts, onChange, onClose, onPlugins, onReset, onImport }: Props): React.JSX.Element {
  const set = <K extends keyof Config>(key: K, value: Config[K]): void => onChange({ ...config, [key]: value })

  const pickInto = async (apply: (dir: string) => void): Promise<void> => {
    const dir = await window.api.pickFolder()
    if (dir) apply(dir)
  }

  return (
    <div className="flex h-full flex-col bg-bg" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="flex h-8 shrink-0 items-center border-b border-line bg-panel px-3 font-mono text-xs text-muted">
        settings
        <button className="btn ml-auto text-muted" onClick={onClose} title="Close  ⌘,">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-5 text-xs">
          <Section title="General">
            <Toggle label="Dark mode" checked={theme === 'dark'} onChange={onTheme} />
            <Row label="Projects folder" hint="Where ⌘T opens projects from, and where pasted git remotes are cloned.">
              <span className="truncate font-mono">{config.projectsDir ? tildify(config.projectsDir) : 'Not set'}</span>
              <button className="btn ml-auto shrink-0" onClick={() => pickInto((dir) => set('projectsDir', dir))}>
                Choose…
              </button>
            </Row>
            <Toggle
              label="Notifications"
              hint="A macOS notification when Claude is done or needs your input, unless you're already looking at that project."
              checked={config.notifications}
              onChange={(v) => set('notifications', v)}
            />
            <Toggle
              label="Usage meters"
              hint="Claude plan usage and Junie credits in the agent title bar. Reads your logins from the Keychain."
              checked={config.meters}
              onChange={(v) => set('meters', v)}
            />
          </Section>

          <Section
            title="Layout"
            hint="Picking a layout rearranges the workspace and closes Settings. Whatever you change afterwards is kept with the session; a saved layout stays as it was saved until you save over it."
          >
            <Layouts layouts={layouts} onLayouts={onLayouts} onPicked={onClose} />
          </Section>

          <Section title="Panels">
            <Toggle label="README" hint="⌘E shows the project's README over the code." checked={config.readme} onChange={(v) => set('readme', v)} />
            <Toggle
              label="Folders"
              hint="⌘B: a full-window image and video browser over folders you add."
              checked={config.folders.enabled}
              onChange={(v) => set('folders', { ...config.folders, enabled: v })}
            />
            {config.folders.enabled && (
              <List
                items={config.folders.dirs}
                onChange={(dirs) => set('folders', { ...config.folders, dirs })}
                onAdd={() =>
                  pickInto((dir) => !config.folders.dirs.includes(dir) && set('folders', { ...config.folders, dirs: [...config.folders.dirs, dir] }))
                }
                addLabel="Add folder…"
                render={(dir) => <span className="truncate font-mono">{tildify(dir)}</span>}
              />
            )}
          </Section>

          <Section
            title="Playgrounds"
            hint="Pages Claude builds for you to look at or fill in (galleries, review forms, previews), shown over the whole workspace. Claude is told about each one by name. None: Claude isn't told about any."
          >
            <List
              items={config.playgrounds}
              onChange={(v) => set('playgrounds', v)}
              onAdd={config.playgrounds.length < MAX_SLOTS ? () => set('playgrounds', [...config.playgrounds, { name: `playground ${config.playgrounds.length + 1}` }]) : undefined}
              addLabel="Add playground"
              render={(slot, i, update) => (
                <>
                  <Key>⌥⌘{digit(i)}</Key>
                  <input className={`flex-1 ${field}`} value={slot.name} placeholder="name" onChange={(e) => update({ name: e.target.value })} />
                </>
              )}
            />
          </Section>

          <Section title="Web pages" hint="Any URL, shown full-window and kept loaded in the background (a dev server, a dashboard, a web UI).">
            <List
              items={config.webPages}
              onChange={(v) => set('webPages', v)}
              onAdd={config.webPages.length < MAX_SLOTS ? () => set('webPages', [...config.webPages, { name: '', url: '' }]) : undefined}
              addLabel="Add web page"
              render={(page, i, update) => (
                <>
                  <Key>⌃⌘{digit(i)}</Key>
                  <input className={`w-32 ${field}`} value={page.name} placeholder="name" onChange={(e) => update({ ...page, name: e.target.value })} />
                  <input
                    className={`flex-1 ${field}`}
                    value={page.url}
                    placeholder="http://localhost:3000"
                    onChange={(e) => update({ ...page, url: e.target.value })}
                    // A bare host:port is the common case.
                    onBlur={(e) => {
                      const url = e.target.value.trim()
                      if (url && !/^[a-z]+:\/\//i.test(url)) update({ ...page, url: `http://${url}` })
                    }}
                  />
                </>
              )}
            />
          </Section>

          <Section
            title="Agents"
            hint="The terminals in the Agents section's dropdown. The first one starts with each project; the rest start when first picked. Each runs in your login shell, which stays open after it exits."
          >
            <List
              items={config.agents}
              onChange={(v) => set('agents', v)}
              onAdd={() => set('agents', [...config.agents, { id: newId('claude'), name: 'claude', type: 'claude' }])}
              addLabel="Add agent"
              render={(agent, _i, update) => <AgentRow agent={agent} update={update} />}
            />
          </Section>

          <Section title="Plugins" hint="Extra features from git repos, such as language support. Install, update and remove them on their own page.">
            <button className="btn self-start" onClick={onPlugins}>
              <Puzzle className="h-3.5 w-3.5" /> Manage plugins… ({config.plugins.filter((p) => p.enabled).length} enabled)
            </button>
          </Section>

          <Section
            title="Sync"
            hint="Your settings, theme and saved layouts as one file, to move to another machine or keep in git. Installed plugins, open projects and the repo below stay on this machine."
          >
            <ConfigFile onImport={onImport} />
            <ConfigRepo url={config.configRepo} onChange={(v) => set('configRepo', v)} />
          </Section>

          <Section title="Reset" hint="Back to how a fresh install starts. Open projects stay open, installed plugins stay installed, and the config repo stays connected.">
            <div className="flex gap-2">
              <button
                className="btn hover:text-del"
                onClick={() => {
                  if (!confirm('Reset the layout to Default? The workspace is rearranged; your saved layouts are kept.')) return
                  apply(PRESETS[0])
                  onClose()
                }}
              >
                Reset layout
              </button>
              <button
                className="btn hover:text-del"
                onClick={() =>
                  confirm(
                    'Reset all settings to their defaults? Agents, playgrounds, web pages, folders, saved layouts, the projects folder and dark mode all go back to a fresh install (and to the config repo, if you sync), and removed agents\' terminals close. This can\'t be undone.'
                  ) && onReset()
                }
              >
                Reset everything
              </button>
            </div>
          </Section>
        </div>
      </div>
    </div>
  )
}

interface LayoutsProps {
  layouts: SavedLayout[]
  onLayouts: (layouts: SavedLayout[]) => void
  onPicked: () => void
}

// The dock's presets and the layouts saved by name. Saving reads the live dock, under this page.
function Layouts({ layouts, onLayouts, onPicked }: LayoutsProps): React.JSX.Element {
  const [name, setName] = useState('')
  const save = (): void => {
    const n = name.trim()
    const layout = current()
    if (!n || !layout) return
    onLayouts([...layouts.filter((l) => l.name !== n), { name: n, layout }])
    setName('')
  }
  return (
    <>
      <Row label="Presets">
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              className="btn"
              title={p.description}
              onClick={() => {
                apply(p)
                onPicked()
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
      </Row>
      {layouts.map((l, i) => (
        <Row key={l.name} label={i === 0 ? 'Saved' : ''}>
          <button
            className="btn min-w-0"
            disabled={!valid(l.layout)}
            onClick={() => {
              load(l.layout)
              onPicked()
            }}
          >
            <span className="truncate">{l.name}</span>
          </button>
          <button className="btn ml-auto px-1 text-muted hover:text-del" onClick={() => onLayouts(layouts.filter((x) => x.name !== l.name))} title="Delete layout">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </Row>
      ))}
      <Row label="Save current as">
        <input
          className={`flex-1 ${field}`}
          value={name}
          placeholder="name"
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && save()}
        />
        <button className="btn shrink-0" disabled={!name.trim()} onClick={save} title={layouts.some((l) => l.name === name.trim()) ? 'Replace the saved layout' : 'Save'}>
          <Save className="h-3.5 w-3.5" />
        </button>
      </Row>
    </>
  )
}

function ConfigFile({ onImport }: { onImport: (settings: AllSettings) => void }): React.JSX.Element {
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const run = async (step: () => Promise<string | null>): Promise<void> => {
    try {
      const text = await step()
      if (text) setNote({ ok: true, text })
    } catch (err) {
      setNote({ ok: false, text: message(err) })
    }
  }
  return (
    <Row label="File">
      <button className="btn shrink-0" onClick={() => run(async () => ((await window.api.exportConfig()) ? 'Exported.' : null))}>
        Export…
      </button>
      <button
        className="btn shrink-0"
        onClick={() =>
          run(async () => {
            const s = await window.api.importConfig()
            if (!s) return null
            onImport(s)
            return 'Imported.'
          })
        }
      >
        Import…
      </button>
      {note && <span className={`truncate ${note.ok ? 'text-muted' : 'text-del'}`}>{note.text}</span>}
    </Row>
  )
}

// Saved when you leave the field: each new URL means a fresh clone.
function ConfigRepo({ url, onChange }: { url: string; onChange: (url: string) => void }): React.JSX.Element {
  const [draft, setDraft] = useState(url)
  useEffect(() => setDraft(url), [url])
  const [status, setStatus] = useState<SyncStatus | null>(null)
  useEffect(() => {
    void window.api.syncStatus().then(setStatus)
    return window.api.onSyncStatus(setStatus)
  }, [])
  const commit = (): void => {
    const next = draft.trim()
    if (next !== url) onChange(next)
  }
  const shown = url && status && status.state !== 'off'
  return (
    <>
      <Row
        label="Git repo"
        hint="Pulls the file at launch, and commits and pushes it a few seconds after each change. When you first connect, a repo that already has the file replaces this machine's settings; an empty one starts from them. Use a private repo: agent commands and licenses are in the file."
      >
        <input
          className={`flex-1 ${field}`}
          value={draft}
          placeholder="git@github.com:you/cuckcode-config.git"
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && commit()}
        />
        {url && (
          <button className="btn shrink-0" disabled={status?.state === 'syncing'} onClick={() => window.api.syncNow()} title="Pull and push now">
            <RefreshCw className={`h-3.5 w-3.5 ${status?.state === 'syncing' ? 'animate-spin' : ''}`} />
          </button>
        )}
      </Row>
      {shown && (
        <p className={`select-text whitespace-pre-wrap break-words pl-35 ${status.state === 'error' ? 'text-del' : 'text-muted'}`}>
          {status.state === 'syncing' ? 'Syncing…' : status.state === 'ok' ? `Synced at ${new Date(status.at).toLocaleTimeString()}` : status.message}
        </p>
      )}
    </>
  )
}

function AgentRow({ agent, update }: { agent: Agent; update: (a: Agent) => void }): React.JSX.Element {
  return (
    <>
      <input className={`w-28 ${field}`} value={agent.name} placeholder="name" onChange={(e) => update({ ...agent, name: e.target.value })} />
      <select
        className={`w-28 ${field}`}
        value={agent.type}
        onChange={(e) => {
          const type = e.target.value as AgentType
          update({ id: agent.id, name: agent.name, type, ...(type === 'junie' ? { license: '' } : type === 'command' ? { command: '' } : {}) })
        }}
      >
        {TYPES.map((t) => (
          <option key={t.type} value={t.type}>
            {t.label}
          </option>
        ))}
      </select>
      {agent.type === 'junie' && (
        <input
          className={`flex-1 ${field}`}
          value={agent.license ?? ''}
          placeholder="license id (--auth-license)"
          onChange={(e) => update({ ...agent, license: e.target.value.trim() })}
        />
      )}
      {agent.type === 'command' && (
        <input
          className={`flex-1 ${field}`}
          value={agent.command ?? ''}
          placeholder="command, e.g. oterm"
          onChange={(e) => update({ ...agent, command: e.target.value })}
        />
      )}
      {agent.type === 'claude' && <span className="flex-1 truncate text-muted">claude, told about your playgrounds</span>}
    </>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="border-b border-line pb-1 text-sm font-semibold text-fg">{title}</h2>
      {hint && <p className="text-muted">{hint}</p>}
      {children}
    </section>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-3">
        <span className="w-32 shrink-0 text-fg">{label}</span>
        <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
      </div>
      {hint && <p className="pl-35 text-muted">{hint}</p>}
    </div>
  )
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }): React.JSX.Element {
  return (
    <Row label={label} hint={hint}>
      <input type="checkbox" className="accent-accent" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </Row>
  )
}

function Key({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className="w-10 shrink-0 font-mono text-muted">{children}</span>
}

interface ListProps<T> {
  items: T[]
  onChange: (items: T[]) => void
  onAdd?: () => void // absent: full
  addLabel: string
  render: (item: T, i: number, update: (item: T) => void) => React.ReactNode
}

// Rows that can be edited in place, moved up and down, and removed.
function List<T>({ items, onChange, onAdd, addLabel, render }: ListProps<T>): React.JSX.Element {
  const move = (i: number, to: number): void => {
    const next = [...items]
    next.splice(to, 0, ...next.splice(i, 1))
    onChange(next)
  }
  const icon = 'h-3.5 w-3.5'
  return (
    <div className="flex flex-col gap-1">
      {items.map((item, i) => (
        <div key={i} className="group flex items-center gap-2">
          {render(item, i, (next) => onChange(items.map((x, j) => (j === i ? next : x))))}
          <div className="flex shrink-0 items-center text-muted">
            <button className="btn px-1" disabled={i === 0} onClick={() => move(i, i - 1)} title="Move up">
              <ArrowUp className={icon} />
            </button>
            <button className="btn px-1" disabled={i === items.length - 1} onClick={() => move(i, i + 1)} title="Move down">
              <ArrowDown className={icon} />
            </button>
            <button className="btn px-1 hover:text-del" onClick={() => onChange(items.filter((_, j) => j !== i))} title="Remove">
              <Trash2 className={icon} />
            </button>
          </div>
        </div>
      ))}
      {onAdd && (
        <button className="btn self-start text-muted" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5" /> {addLabel}
        </button>
      )}
    </div>
  )
}
