import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Puzzle, RefreshCw, Save, Trash2, X } from 'lucide-react'
import type { Agent, Config, SavedLayout, Settings as AllSettings, SyncStatus, ThemeChoice } from '../../../shared/types'
import { MAX_SLOTS } from '../../../shared/types'
import { COMMIT_COMMAND, fromPreset, PRESETS as AGENT_PRESETS, RUN_COMMAND } from '../../../shared/agents'
import { message } from '../errors'
import { usePlugins } from '../plugins'
import { apply, current, load, PRESETS, valid } from '../layout'
import { ask } from './Confirm'
import { tildify } from './Header'

interface Props {
  config: Config
  theme: ThemeChoice
  onTheme: (theme: ThemeChoice) => void
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


// Full-window, over everything. Every change saves at once.
export default function Settings({ config, theme, onTheme, layouts, onLayouts, onChange, onClose, onPlugins, onReset, onImport }: Props): React.JSX.Element {
  const set = <K extends keyof Config>(key: K, value: Config[K]): void => onChange({ ...config, [key]: value })
  // Ids key PTYs, so they're made once (from the preset's name) and never follow later renames.
  const presets = [...AGENT_PRESETS, ...usePlugins().flatMap((p) => p.presets)]

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
            <Row label="Theme">
              <select className={`w-28 ${field}`} value={theme} onChange={(e) => onTheme(e.target.value as ThemeChoice)}>
                <option value="auto">Auto</option>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </Row>
            <Row label="Projects folder" hint="Where ⌘T opens projects from, and where pasted git remotes are cloned.">
              <span className="truncate font-mono">{config.projectsDir ? tildify(config.projectsDir) : 'Not set'}</span>
              <button className="btn ml-auto shrink-0" onClick={() => pickInto((dir) => set('projectsDir', dir))}>
                Choose…
              </button>
            </Row>
            <Toggle
              label="Notifications"
              hint="A macOS notification when an agent with Notify on is done or needs your input, unless you're already looking at that project. Off: only the tab lights up."
              checked={config.notifications}
              onChange={(v) => set('notifications', v)}
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
            hint="Pages your agent builds for you to look at or fill in (galleries, review forms, previews), shown over the whole workspace. Agents with Playground on are told about each one by name. None: they aren't told about any."
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
            hint="The terminals in the Agents section's dropdown. The first one starts with each project; the rest start when first picked. Each command runs in your login shell, which stays open after it exits, with $CUCKCODE_NOTIFY (a script its hooks can run to notify) and, with Playground on, $CUCKCODE_PLAYGROUND (the playground instructions) to pass on."
          >
            <List items={config.agents} onChange={(v) => set('agents', v)} render={(agent, _i, update) => <AgentRow agent={agent} update={update} />} />
            <div className="flex flex-wrap gap-1">
              {presets.map((p, i) => (
                <button key={i} className="btn text-muted" onClick={() => set('agents', [...config.agents, fromPreset(p)])}>
                  <Plus className="h-3.5 w-3.5" /> {p.label}
                </button>
              ))}
            </div>
            <Row
              label="Run command"
              hint="Runs plugins' one-shot helpers, with nothing on screen. It runs with sh in the project, gets the prompt on stdin and the project's profile (.claude/profiles/<name>.json) in $CUCKCODE_RUN_PROFILE, with $CUCKCODE_RUN_PLAIN, _THREAD or _RESUME saying which kind of run it is, and prints JSON lines. Empty turns plugins' runs off."
            >
              <input className={`flex-1 ${field}`} value={config.agentRunCommand} placeholder="none" onChange={(e) => set('agentRunCommand', e.target.value)} />
              {config.agentRunCommand !== RUN_COMMAND && (
                <button className="btn shrink-0" onClick={() => set('agentRunCommand', RUN_COMMAND)} title={RUN_COMMAND}>
                  Default
                </button>
              )}
            </Row>
          </Section>

          <Section title="Git" hint="The AI commit buttons (✨) commit with a message this command writes. It runs with sh in the repo, gets the changes on stdin and its instructions in $CUCKCODE_COMMIT_PROMPT, and prints the message. Empty hides the buttons.">
            <Row label="Commit command">
              <input className={`flex-1 ${field}`} value={config.commitCommand} placeholder="none" onChange={(e) => set('commitCommand', e.target.value)} />
              {config.commitCommand !== COMMIT_COMMAND && (
                <button className="btn shrink-0" onClick={() => set('commitCommand', COMMIT_COMMAND)} title={COMMIT_COMMAND}>
                  Default
                </button>
              )}
            </Row>
            <Toggle
              label="Confirm all-repo actions"
              hint="Ask before ✨ commit all and sync all run on every open repo."
              checked={config.confirmAllRepos}
              onChange={(v) => set('confirmAllRepos', v)}
            />
          </Section>

          <Section title="Plugins" hint="Extra features from git repos, such as language support. Install, update and remove them on their own page.">
            <button className="btn self-start" onClick={onPlugins}>
              <Puzzle className="h-3.5 w-3.5" /> Manage plugins… ({config.plugins.filter((p) => p.enabled).length} enabled)
            </button>
          </Section>

          <Section
            title="Sync"
            hint="Your settings, theme, saved layouts, scratchpad and the plugins installed from a URL as one file, to move to another machine or keep in git. Plugin folders you added yourself, open projects and the repo below stay on this machine."
          >
            <ConfigFile onImport={onImport} />
            <ConfigRepo url={config.configRepo} onChange={(v) => set('configRepo', v)} />
          </Section>

          <Section title="Reset" hint="Back to how a fresh install starts. Open projects stay open, installed plugins stay installed, and the config repo stays connected.">
            <div className="flex gap-2">
              <button
                className="btn hover:text-del"
                onClick={async () => {
                  if (!(await ask({ title: 'Reset the layout to Default?', detail: 'The workspace is rearranged; your saved layouts are kept.', action: 'Reset layout' })))
                    return
                  apply(PRESETS[0])
                  onClose()
                }}
              >
                Reset layout
              </button>
              <button
                className="btn hover:text-del"
                onClick={async () =>
                  (await ask({
                    title: 'Reset all settings to their defaults?',
                    detail:
                      "Agents, playgrounds, web pages, folders, saved layouts, the projects folder and the theme all go back to a fresh install (and to the config repo, if you sync), and removed agents' terminals close. This can't be undone.",
                    action: 'Reset everything',
                    danger: true
                  })) && onReset()
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

const SWITCHES: { key: 'notify' | 'awake' | 'mentions' | 'newline' | 'playground'; label: string; hint: string }[] = [
  { key: 'notify', label: 'Notify', hint: 'A bell or OSC 9/777 notification lights up the tab and sends a notification' },
  { key: 'awake', label: 'Keep awake', hint: "Its output keeps the Mac from idle-sleeping until it's been quiet for 30 seconds" },
  { key: 'mentions', label: '@ mentions', hint: 'Dropped files and Send Selection (⌥⌘K) go in as @path#L12-20; off: a quoted path' },
  { key: 'newline', label: '⇧↩ newline', hint: '⇧↩ sends ESC+CR, a newline without submitting' },
  { key: 'playground', label: 'Playground', hint: "Gets $CUCKCODE_PLAYGROUND and is told when you press Done in a playground" }
]

function AgentRow({ agent, update }: { agent: Agent; update: (a: Agent) => void }): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex items-center gap-2">
        <input className={`w-28 ${field}`} value={agent.name} placeholder="name" onChange={(e) => update({ ...agent, name: e.target.value })} />
        <input
          className={`flex-1 ${field}`}
          value={agent.command}
          placeholder="command, e.g. codex"
          title={agent.command}
          onChange={(e) => update({ ...agent, command: e.target.value })}
        />
      </div>
      <div className="flex flex-wrap gap-x-3 pl-30 text-muted">
        {SWITCHES.map((s) => (
          <label key={s.key} className="flex items-center gap-1" title={s.hint}>
            <input type="checkbox" className="accent-accent" checked={agent[s.key]} onChange={(e) => update({ ...agent, [s.key]: e.target.checked })} />
            {s.label}
          </label>
        ))}
      </div>
    </div>
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
  addLabel?: string
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
