import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { cleanMessage, commitMessage, goodSubject } from './commitmsg'

describe('cleanMessage', () => {
  it('takes the message between the tags, dropping talk around them', () => {
    expect(cleanMessage('Looking at the diff, it renames a class.\n<message>\nRename the shelf class\n</message>\nDone.')).toBe('Rename the shelf class')
    expect(cleanMessage('<message>Add a\n\nBody line.</message>')).toBe('Add a\n\nBody line.')
  })

  it('takes untagged output as is, without fences or quotes', () => {
    expect(cleanMessage('```\nFix the dock\n```')).toBe('Fix the dock')
    expect(cleanMessage('"Fix the dock"')).toBe('Fix the dock')
  })

  // Shaped like messages a model wrote that got committed.
  it('drops a line echoing the instructions', () => {
    const echoed = 'Make the export list say "none" is allowed for drafts\nMatch the subject style of the recent commits, under 72 characters.\n'
    expect(cleanMessage(echoed)).toBe('Make the export list say "none" is allowed for drafts')
  })

  it('refuses output that thinks out loud before the subject', () => {
    const reasoning =
      'The diff changes the export descriptions to match the new categories, and bumps the report to version 2 so older reports are refused. The subject needs to say what the copy now promises, which is why a body is useful here.\n\nDescribe the export options more precisely'
    expect(cleanMessage(reasoning)).toBeNull()
    expect(cleanMessage('Commit message needed for the staged changes; the diff covers the new settings.')).toBeNull()
    expect(cleanMessage('Here is the commit message:')).toBeNull()
  })

  it('keeps a subject that is about commit messages, and drops a tag left open', () => {
    expect(cleanMessage('Commit messages: retry once on talk')).toBe('Commit messages: retry once on talk')
    expect(cleanMessage('<message>\nFix the dock\n')).toBe('Fix the dock')
  })

  it('keeps a subject or body that only sounds like the instructions, and quotes inside it', () => {
    expect(cleanMessage('Match the style of the Git tab to the Search tab')).toBe('Match the style of the Git tab to the Search tab')
    expect(cleanMessage('<message>Restyle the shelf\n\nTabs now match the style of the header.</message>')).toBe('Restyle the shelf\n\nTabs now match the style of the header.')
    expect(cleanMessage('"Fix" the "dock"')).toBe('"Fix" the "dock"')
  })

  it('keeps a body that is about commit messages', () => {
    expect(cleanMessage('<message>Check AI commit messages\n\nA commit message that is reasoning gets retried.</message>')).toBe('Check AI commit messages\n\nA commit message that is reasoning gets retried.')
  })

  it('tells good subjects for the style examples', () => {
    expect(goodSubject('Harden the shelf against an empty tab bar')).toBe(true)
    expect(goodSubject('The diff changes things')).toBe(false)
    expect(goodSubject('x'.repeat(101))).toBe(false)
  })
})

describe('commitMessage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'commitmsg-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('passes the prompt and the changes to the command', async () => {
    expect(await commitMessage('cat >/dev/null; printf "<message>%s</message>" "$(echo "$CUCKCODE_COMMIT_PROMPT" | grep -c "<message>")"', dir, 'diff')).toBe('1')
  })

  it('tries again once, then refuses to commit what it printed', async () => {
    // First run: reasoning; second: a message (a counter file tells them apart).
    const flaky = `cat >/dev/null; if [ -f n ]; then echo "<message>Fix the dock</message>"; else touch n; echo "The diff changes the dock."; fi`
    expect(await commitMessage(flaky, dir, 'diff')).toBe('Fix the dock')
    await expect(commitMessage('cat >/dev/null; echo "Here is the commit message:"', dir, 'diff')).rejects.toThrow(/no usable message/)
    await expect(commitMessage(' ', dir, 'diff')).rejects.toThrow(/No commit command/)
  })
})
