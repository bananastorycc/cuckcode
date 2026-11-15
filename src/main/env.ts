// Its own module, free of node-pty and electron: git.ts reaches it through commitmsg.ts, and
// the search worker imports git.ts, so anything heavy here would load in every search.

// Vars that leak from whatever launched us (npm, Vite, Electron, another terminal,
// an outer Claude Code session) and would change how tools behave inside the shell.
// Claude's are only the markers it sets on its own children (they turn off transcripts and
// put the outer session's permission mode on our agents), not CLAUDE_CODE_* settings a user
// exports on purpose.
const LEAKY =
  /^(npm_|ELECTRON_|VITE_|ITERM_|LC_TERMINAL)|^(NODE_ENV|INIT_CWD|PWD|OLDPWD|TERM_PROGRAM|TERM_PROGRAM_VERSION|TERM_SESSION_ID|COLORFGBG)$|^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_CODE_(ENTRYPOINT|EXECPATH|CHILD_SESSION|SESSION_ID|SESSION_ATTENDED|MESSAGING_SOCKET|MESSAGING_TOKEN))$|^CUCKCODE_/

export function shellEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !LEAKY.test(k)) env[k] = v
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.LANG ??= 'en_US.UTF-8'
  return env
}
