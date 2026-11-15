import { powerSaveBlocker } from 'electron'

// Keeps the Mac from idle-sleeping while Claude works, so a long task isn't cut off mid-turn.
// Busy = a Claude terminal printed something recently: its spinner redraws several times a second
// for the whole turn (tool runs included), and an idle prompt prints nothing. The display may
// still sleep; closing the lid still sleeps.

const IDLE_MS = 30_000

let blocker: number | undefined
let idle: NodeJS.Timeout | undefined

export function poke(): void {
  blocker ??= powerSaveBlocker.start('prevent-app-suspension')
  if (idle) idle.refresh()
  else idle = setTimeout(release, IDLE_MS)
}

function release(): void {
  idle = undefined
  if (blocker !== undefined) powerSaveBlocker.stop(blocker)
  blocker = undefined
}
