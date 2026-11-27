import type { Agent } from './types'

// Agents to start from in Settings › Agents; plugins add their own. Only defaults: every field
// stays editable, and nothing in cuckcode depends on which preset an agent came from.
export type AgentPreset = Omit<Agent, 'id'> & { label: string }

// Claude Code's hooks signal "done" and "needs input" through $CUCKCODE_NOTIFY, since Claude only
// sends notifications itself in terminals it recognizes. Not idle_prompt: that's a reminder a
// minute after Stop already said so. PermissionRequest (a permission, or approving a plan) and
// AskUserQuestion go to $CUCKCODE_HOOK, for a plugin to answer: both take a reply on stdout
// (hookSpecificOutput), and a hook that prints nothing leaves Claude to ask in its terminal.
// Single-quoted for the shell; Claude's hook runner expands the variables.
const HOOK = [{ type: 'command', command: '"$CUCKCODE_HOOK"' }]
const CLAUDE_HOOKS = JSON.stringify({
  hooks: {
    Stop: [{ hooks: [{ type: 'command', command: '"$CUCKCODE_NOTIFY" "Claude is done"' }] }],
    Notification: [
      { matcher: 'permission_prompt|elicitation_dialog', hooks: [{ type: 'command', command: '"$CUCKCODE_NOTIFY" "Claude needs your input"' }] }
    ],
    PermissionRequest: [{ hooks: HOOK }],
    PreToolUse: [{ matcher: 'AskUserQuestion', hooks: HOOK }]
  }
})

export const CLAUDE: AgentPreset = {
  label: 'Claude Code',
  name: 'claude',
  command: `claude --settings '${CLAUDE_HOOKS}' --append-system-prompt "$CUCKCODE_PLAYGROUND"`,
  notify: true,
  awake: true,
  mentions: true,
  newline: true,
  playground: true
}

export const CUSTOM: AgentPreset = {
  label: 'Command',
  name: 'agent',
  command: '',
  notify: true,
  awake: false,
  mentions: false,
  newline: false,
  playground: false
}

export const PRESETS: AgentPreset[] = [CLAUDE, CUSTOM]

// Headless Claude on Haiku, no tools or MCP: it only reads stdin, and sits between a click and a commit.
export const COMMIT_COMMAND = `claude -p --model haiku --tools '' --strict-mcp-config --no-session-persistence "$CUCKCODE_COMMIT_PROMPT"`

// Plugins' helper runs (RendererHost.runAgent): headless Claude on the profile's settings (the
// model, permissions and env the project gives the job), no MCP, the prompt on stdin. A plain run
// keeps no session; a thread keeps its own, and a resume continues one.
export const RUN_COMMAND =
  'claude -p --output-format stream-json --verbose --strict-mcp-config --settings "$CUCKCODE_RUN_PROFILE"' +
  ' ${CUCKCODE_RUN_PLAIN:+--no-session-persistence} ${CUCKCODE_RUN_RESUME:+--resume "$CUCKCODE_RUN_RESUME"}'

export const agentId = (name: string): string =>
  `${name.toLowerCase().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'agent'}-${Date.now().toString(36)}`

export const fromPreset = ({ label: _, ...p }: AgentPreset, id = agentId(p.name)): Agent => ({ id, ...p })

// Where Send Selection and a playground's Done go: the agent in front when it takes them, else
// the first that does.
export const target = (agents: Agent[], front: string | undefined, takes: (a: Agent) => boolean): Agent | undefined =>
  agents.find((a) => a.id === front && takes(a)) ?? agents.find(takes)
