export interface AudioPlayerOptions {
  chimeUrl?: string
  mediaSessionTitle?: string
  mediaSessionArtist?: string
}

export class AudioPlayer {
  private ctx: AudioContext | null = null
  private chimeBuffer: AudioBuffer | null = null
  private currentSource: AudioBufferSourceNode | null = null
  private _isPlaying = false

  get isPlaying(): boolean {
    return this._isPlaying
  }

  async init(options?: AudioPlayerOptions): Promise<void> {
    this.ctx = new AudioContext()

    if (options?.chimeUrl) {
      try {
        const resp = await fetch(options.chimeUrl)
        const data = await resp.arrayBuffer()
        this.chimeBuffer = await this.ctx.decodeAudioData(data)
      } catch {
        // Chime not available — proceed without it
      }
    }

    if ("mediaSession" in navigator && options?.mediaSessionTitle) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: options.mediaSessionTitle,
        artist: options.mediaSessionArtist,
      })
    }
  }

  async playChimeAndAudio(wav: ArrayBuffer, chime = true): Promise<void> {
    if (!this.ctx) return

    if (this.ctx.state === "suspended") {
      await this.ctx.resume()
    }

    this._isPlaying = true

    try {
      if (chime && this.chimeBuffer) {
        await this.playBuffer(this.chimeBuffer)
        await new Promise((r) => setTimeout(r, 200))
      }

      const audioBuffer = await this.ctx.decodeAudioData(wav.slice(0))
      await this.playBuffer(audioBuffer)
    } finally {
      this._isPlaying = false
      this.currentSource = null
    }
  }

  stop(): void {
    if (this.currentSource) {
      try {
        this.currentSource.stop()
      } catch {
        // already stopped
      }
      this.currentSource = null
    }
    this._isPlaying = false
  }

  dispose(): void {
    this.stop()
    if (this.ctx) {
      this.ctx.close().catch(() => {})
      this.ctx = null
    }
    this.chimeBuffer = null
  }

  private playBuffer(buffer: AudioBuffer): Promise<void> {
    return new Promise((resolve) => {
      if (!this.ctx) {
        resolve()
        return
      }
      const source = this.ctx.createBufferSource()
      source.buffer = buffer
      source.connect(this.ctx.destination)
      this.currentSource = source
      source.onended = () => resolve()
      source.start()
    })
  }
}
