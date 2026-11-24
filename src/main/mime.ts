// Content types media:// serves, by lowercase extension. The image and video ones are also
// what the code pane shows as media rather than as a binary file; audio is served for plugins only.
export const TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.webm': 'video/webm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
}

export function mediaKind(ext: string): 'image' | 'video' | null {
  const type = TYPES[ext.toLowerCase()] ?? ''
  return type.startsWith('image/') ? 'image' : type.startsWith('video/') ? 'video' : null
}
