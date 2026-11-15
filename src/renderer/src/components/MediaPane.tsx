import { useEffect, useRef, useState } from 'react'
import type { FileSnapshot } from '../../../shared/types'

// Side-by-side HEAD vs working tree (or a commit's parent vs the commit), or the file alone when unchanged. For
// video, the working copy is the master (native controls: play, scrub, speed); the HEAD copy mirrors it.
export default function MediaPane({ snap, labels = ['HEAD', 'Working tree'] }: { snap: FileSnapshot; labels?: [string, string] }): React.JSX.Element {
  const head = useRef<HTMLVideoElement>(null)
  const work = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const master = work.current
    const follower = head.current
    if (!master || !follower) return
    const sync = (): void => {
      follower.currentTime = master.currentTime
      follower.playbackRate = master.playbackRate
      if (master.paused) follower.pause()
      else follower.play().catch(() => {})
    }
    const events = ['play', 'pause', 'seeked', 'ratechange']
    events.forEach((e) => master.addEventListener(e, sync))
    return () => events.forEach((e) => master.removeEventListener(e, sync))
  }, [snap.head, snap.work])

  const master = snap.work ? 'work' : 'head'

  // Opened with no changes (e.g. from the tree): just the file.
  if (snap.head === snap.work) {
    return (
      <div className="absolute inset-0 grid bg-bg">
        <Side label="" src={snap.work} video={snap.kind === 'video'} videoRef={work} controls />
      </div>
    )
  }

  return (
    <div className="absolute inset-0 grid grid-cols-2 divide-x divide-line bg-bg">
      {(['head', 'work'] as const).map((side) => (
        <Side
          key={side}
          label={labels[side === 'head' ? 0 : 1]}
          src={snap[side]}
          video={snap.kind === 'video'}
          videoRef={side === 'head' ? head : work}
          controls={side === master}
        />
      ))}
    </div>
  )
}

interface SideProps {
  label: string
  src: string | null
  video: boolean
  videoRef: React.RefObject<HTMLVideoElement | null>
  controls: boolean
}

function Side({ label, src, video, videoRef, controls }: SideProps): React.JSX.Element {
  const [size, setSize] = useState('')
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex h-7 shrink-0 items-center justify-between px-3 text-[0.85rem] text-muted">
        <span>{label}</span>
        <span className="font-mono">{src && size}</span>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-3">
        {!src ? (
          <span className="text-xs text-muted">absent</span>
        ) : video ? (
          <video
            ref={videoRef}
            src={src}
            controls={controls}
            loop
            muted
            playsInline
            onLoadedMetadata={(e) => setSize(`${e.currentTarget.videoWidth}×${e.currentTarget.videoHeight}`)}
            className="max-h-full max-w-full"
          />
        ) : (
          <img
            src={src}
            onLoad={(e) => setSize(`${e.currentTarget.naturalWidth}×${e.currentTarget.naturalHeight}`)}
            className="max-h-full max-w-full object-contain"
          />
        )}
      </div>
    </div>
  )
}
