/** Extensions the renderer plays as video (shared by chat Markdown and the Artifacts panel). */
const VIDEO_EXTENSIONS = /\.(webm|mp4|mov|avi|mkv|ogg)(\?.*)?$/i

export function isVideoSrc(src?: string): boolean {
  return !!src && VIDEO_EXTENSIONS.test(src)
}
