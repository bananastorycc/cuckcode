import { execFile } from 'node:child_process'
import { shellEnv } from './env'

const PROMPT = `Write a git commit message for the changes on stdin (a diff, new files, and the repo's recent subjects).
Match the style of the recent subjects. Imperative mood, subject under 72 characters; add a short body only if the
subject can't carry it. Output only the message: no quotes, no code fences, no preamble.`

// The configured commit command (Settings › Git), run by sh with the changes on stdin and the
// instructions in $CUCKCODE_COMMIT_PROMPT; whatever it prints is the message.
export function commitMessage(command: string, cwd: string, changes: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!command.trim()) return reject(new Error('No commit command set (Settings › Git).'))
    const env = { ...shellEnv(), CUCKCODE_COMMIT_PROMPT: PROMPT }
    const child = execFile('/bin/sh', ['-c', command], { cwd, env, timeout: 120_000 }, (err, stdout, stderr) => {
      const msg = stdout.trim().replace(/^```\w*\n?|\n?```$/g, '').trim()
      if (err || !msg) reject(new Error(`Commit command: ${(stderr || stdout || err?.message || 'no message').trim()}`))
      else resolve(msg)
    })
    // The command can exit (logged out, bad flag) before reading a large diff; the EPIPE would
    // otherwise be an uncaught exception in main. The exit callback reports the failure.
    child.stdin?.on('error', () => {})
    child.stdin?.end(changes)
  })
}
