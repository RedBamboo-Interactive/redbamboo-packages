const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=opus",
  "audio/mp4",
]

function pickMimeType(): string | undefined {
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m))
}

export class AudioRecorder {
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private _isRecording = false

  get isRecording(): boolean {
    return this._isRecording
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    this.chunks = []

    const mimeType = pickMimeType()
    this.recorder = mimeType
      ? new MediaRecorder(this.stream, { mimeType })
      : new MediaRecorder(this.stream)
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }
    this.recorder.start()
    this._isRecording = true
  }

  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      if (!this.recorder || this.recorder.state === "inactive") {
        this._isRecording = false
        const blob = new Blob(this.chunks, { type: this.recorder?.mimeType ?? "audio/webm" })
        this.releaseStream()
        resolve(blob)
        return
      }

      this.recorder.onstop = () => {
        this._isRecording = false
        const blob = new Blob(this.chunks, { type: this.recorder?.mimeType ?? "audio/webm" })
        this.releaseStream()
        resolve(blob)
      }
      this.recorder.stop()
    })
  }

  cancel(): void {
    if (this.recorder && this.recorder.state !== "inactive") {
      this.recorder.onstop = null
      this.recorder.stop()
    }
    this.chunks = []
    this._isRecording = false
    this.releaseStream()
  }

  dispose(): void {
    this.cancel()
  }

  private releaseStream(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop())
      this.stream = null
    }
    this.recorder = null
  }
}
