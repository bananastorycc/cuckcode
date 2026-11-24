import { execFile } from 'node:child_process'
import { shellEnv } from './env'

const PROMPT = `Write a git commit message for the changes on stdin (a diff, new files, and the repo's recent subjects).
Match the style of the recent subjects. Imperative mood, subject under 72 characters; add a short body only if the
subject can't carry it. Put the message, and nothing else, between <message> and </message>: no quotes, no code
fences, no notes about the diff or these instructions.`

const SUBJECT_MAX = 100 // past the asked-for 72, but a real subject that ran long still goes in
// How a model's talk about the task starts, where a subject should be (seen: "The diff changes ...",
// "Commit message needed for ...", "Here is ...").
const META = /^(the|this) (diff|change|commit)\b|^(commit message\b|here('s| is)|i('ll| will)|based on|looking at|sure\b|okay\b)/i
// The prompt's own words, echoed back as a line of the message (seen: "Match the subject style of the
// recent commits, under 72 characters.").
// Narrow on purpose: "Match the style of the header" is a fine subject of its own.
const ECHO = /\b(under 72 characters|match the (subject )?style of the recent|imperative mood|the recent subjects)\b/i

// A subject that's fine to commit, and to show the next message as the style to match.
export const goodSubject = (s: string): boolean => !!s.trim() && s.length <= SUBJECT_MAX && !META.test(s.trim())

// The message from the command's output: what's between the last <message> tags (all of it when
// there are none), without code fences, quotes around it or lines echoing the prompt. null when
// what's left doesn't start with a subject (a model thinking out loud first).
export function cleanMessage(output: string): string | null {
  const tagged = [...output.matchAll(/<message>([\s\S]*?)<\/message>/g)].pop()
  // A lone tag (the model stopped before closing it) isn't part of the message either.
  let msg = (tagged ? tagged[1] : output).replace(/<\/?message>/g, '').trim().replace(/^```\w*\n?|\n?```$/g, '').trim()
  // Only quotes around the whole message: `"Fix" the "dock"` keeps its own.
  if (/^"[^"]*"$/.test(msg)) msg = msg.slice(1, -1).trim()
  const lines = msg.split('\n').filter((line) => !ECHO.test(line))
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  msg = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return goodSubject(msg.split('\n')[0]) ? msg : null
}

// The configured commit command (Settings › Git), run by sh with the changes on stdin and the
// instructions in $CUCKCODE_COMMIT_PROMPT; its cleaned output is the message. Output that isn't a
// commit message gets one more try, then an error to write it yourself, rather than a commit nobody
// wants in the history (fixing one later means rewriting pushed history).
export async function commitMessage(command: string, cwd: string, changes: string): Promise<string> {
  if (!command.trim()) throw new Error('No commit command set (Settings › Git).')
  let output = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    output = await runCommand(command, cwd, changes)
    const msg = cleanMessage(output)
    if (msg) return msg
  }
  throw new Error(`Commit command: no usable message (write one yourself). It printed:\n${output.trim().slice(0, 500)}`)
}

function runCommand(command: string, cwd: string, changes: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = { ...shellEnv(), CUCKCODE_COMMIT_PROMPT: PROMPT }
    const child = execFile('/bin/sh', ['-c', command], { cwd, env, timeout: 120_000 }, (err, stdout, stderr) => {
      if (err || !stdout.trim()) reject(new Error(`Commit command: ${(stderr || stdout || err?.message || 'no message').trim()}`))
      else resolve(stdout)
    })
    // The command can exit (logged out, bad flag) before reading a large diff; the EPIPE would
    // otherwise be an uncaught exception in main. The exit callback reports the failure.
    child.stdin?.on('error', () => {})
    child.stdin?.end(changes)
  })
}
