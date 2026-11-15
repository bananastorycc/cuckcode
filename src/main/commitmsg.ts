import { execFile } from 'node:child_process'
import { shellEnv } from './env'

const PROMPT = `Write a git commit message for the changes on stdin (a diff, new files, and the repo's recent subjects).
Match the style of the recent subjects. Imperative mood, subject under 72 characters; add a short body only if the
subject can't carry it. Output only the message: no quotes, no code fences, no preamble.`

// Headless claude, no tools or MCP: it only reads stdin. Haiku because this sits between a click and a commit.
export function commitMessage(cwd: string, changes: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--model', 'haiku', '--tools', '', '--strict-mcp-config', '--no-session-persistence', PROMPT]
    const child = execFile('claude', args, { cwd, env: shellEnv(), timeout: 120_000 }, (err, stdout, stderr) => {
      const msg = stdout.trim().replace(/^```\w*\n?|\n?```$/g, '').trim()
      if (err || !msg) reject(new Error(`claude: ${(stderr || stdout || err?.message || 'no message').trim()}`))
      else resolve(msg)
    })
    // claude can exit (logged out, bad flag) before reading a large diff; the EPIPE would
    // otherwise be an uncaught exception in main. The exit callback reports the failure.
    child.stdin?.on('error', () => {})
    child.stdin?.end(changes)
  })
}
