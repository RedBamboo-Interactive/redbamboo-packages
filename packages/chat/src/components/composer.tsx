import { useState, useRef, useCallback, useEffect, useLayoutEffect, forwardRef, useImperativeHandle } from "react"
import type { AttachmentTransport, DraftAttachment, ImageAttachment, UploadedAttachment } from "../types"
import { AttachmentCard } from "./attachment-card"
import { acceptedAttachmentFiles } from "../lib/attachment-selection"

interface ComposerProps {
  /**
   * Called for every submit — Enter, the send button, and Ctrl+Enter/Ctrl+click
   * alike. Composer has no notion of a message queue; it just reports "send
   * this" and, when the modifier is held, follows it with `onInterrupt`. The
   * caller (ChatPanel) decides what "send" means — enqueue-and-drain-later.
   */
  onSend: (content: string, images?: ImageAttachment[]) => void
  onSendInput?: (content: string, attachments: UploadedAttachment[]) => void
  onInterrupt: () => void
  disabled: boolean
  isStreaming: boolean
  /** The transitional window after an interrupt is requested but before the turn has unwound — isStreaming is still true here. */
  interrupting?: boolean
  /** The backend's process was force-killed and is being replaced — not safe to drain a queue into yet, even though isStreaming is false. */
  resumePending?: boolean
  placeholder?: string
  permissionMode?: string
  onTogglePlanMode?: () => void
  pendingQuestion?: boolean
  onAnswerQuestion?: (answer: string, payload?: import("../types").QuestionAnswerPayload) => void
  onResume?: () => void | Promise<void>
  sessionId?: string | null
  renderInlineAction?: (state: { value: string; isStreaming: boolean; disabled: boolean; hasImages: boolean; hasAttachments: boolean }) => React.ReactNode
  enableImageAttachments?: boolean
  enableFileAttachments?: boolean
  attachmentTransport?: AttachmentTransport
  draftStorageKey?: string
}

export interface ComposerHandle {
  /** Loads text (and images) into the composer, e.g. pulling a queued ghost back in to edit. */
  loadDraft: (text: string, images?: ImageAttachment[], attachments?: UploadedAttachment[]) => void
}

function readImageFile(file: File): Promise<ImageAttachment | null> {
  const mediaType = file.type as ImageAttachment["mediaType"]
  if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mediaType)) return Promise.resolve(null)
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(",")[1]
      if (base64) resolve({ mediaType, base64 })
      else resolve(null)
    }
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

const DRAFT_SAVE_DELAY = 300

interface StoredDraft { text: string; attachments: UploadedAttachment[] }

function readyAttachments(attachments: DraftAttachment[]): UploadedAttachment[] {
  return attachments
    .filter(attachment => attachment.state === "ready")
    .map(({ clientId: _clientId, state: _state, error: _error, previewUrl: _previewUrl, file: _file, ...attachment }) => attachment)
}

function restoreAttachments(attachments: UploadedAttachment[], transport?: AttachmentTransport): DraftAttachment[] {
  return attachments.map(attachment => ({
    ...attachment,
    clientId: `restored-${attachment.id}`,
    state: "ready",
    previewUrl: attachment.kind === "image"
      ? transport?.getDownloadUrl?.(attachment) ?? attachment.downloadUrl
      : undefined,
  }))
}

function newClientId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `attachment-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function loadDraftFromStorage(key: string, id: string): StoredDraft | null {
  try {
    const raw = localStorage.getItem(`${key}:${id}`)
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as StoredDraft
      if (typeof parsed.text === "string" && Array.isArray(parsed.attachments)) return parsed
    } catch { /* legacy drafts were stored as plain text */ }
    return { text: raw, attachments: [] }
  } catch { return null }
}

function saveDraftToStorage(key: string, id: string, text: string, attachments: UploadedAttachment[]): void {
  try {
    if (text || attachments.length > 0) localStorage.setItem(`${key}:${id}`, JSON.stringify({ text, attachments }))
    else localStorage.removeItem(`${key}:${id}`)
  } catch {}
}

function removeDraftFromStorage(key: string, id: string): void {
  try { localStorage.removeItem(`${key}:${id}`) } catch {}
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer({
  onSend,
  onSendInput,
  onInterrupt,
  disabled,
  isStreaming,
  interrupting,
  resumePending,
  placeholder,
  permissionMode,
  onTogglePlanMode,
  pendingQuestion,
  onAnswerQuestion,
  onResume,
  sessionId,
  renderInlineAction,
  enableImageAttachments = true,
  enableFileAttachments,
  attachmentTransport,
  draftStorageKey,
}, ref) {
  const [value, setValue] = useState("")
  const [images, setImages] = useState<ImageAttachment[]>([])
  const [attachments, setAttachments] = useState<DraftAttachment[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [ctrlHeld, setCtrlHeld] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const draftsRef = useRef<Record<string, { value: string; images: ImageAttachment[]; attachments: DraftAttachment[] }>>({})
  const prevSessionRef = useRef<string | null | undefined>(undefined)
  const valueRef = useRef(value)
  const imagesRef = useRef(images)
  const attachmentsRef = useRef(attachments)
  const removedUploadsRef = useRef(new Set<string>())
  const [draftRestoreKey, setDraftRestoreKey] = useState(0)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  valueRef.current = value
  imagesRef.current = images
  attachmentsRef.current = attachments
  const fileAttachmentsEnabled = enableFileAttachments ?? !!attachmentTransport

  useEffect(() => {
    const isInitial = prevSessionRef.current === undefined
    const isSwitch = !isInitial && prevSessionRef.current !== sessionId

    if (isSwitch) {
      const prevId = prevSessionRef.current
      if (prevId) {
        draftsRef.current[prevId] = { value: valueRef.current, images: imagesRef.current, attachments: attachmentsRef.current }
        if (draftStorageKey) saveDraftToStorage(draftStorageKey, prevId, valueRef.current, readyAttachments(attachmentsRef.current))
      }
      const draft = sessionId ? draftsRef.current[sessionId] : undefined
      const storedText = draftStorageKey && sessionId ? loadDraftFromStorage(draftStorageKey, sessionId) : null
      setValue(draft?.value ?? storedText?.text ?? "")
      setImages(draft?.images ?? [])
      setAttachments(draft?.attachments ?? restoreAttachments(storedText?.attachments ?? [], attachmentTransport))
      setDraftRestoreKey(k => k + 1)
    } else if (isInitial && draftStorageKey && sessionId) {
      const saved = loadDraftFromStorage(draftStorageKey, sessionId)
      if (saved) {
        setValue(saved.text)
        setAttachments(restoreAttachments(saved.attachments, attachmentTransport))
        setDraftRestoreKey(k => k + 1)
      }
    }

    prevSessionRef.current = sessionId
  }, [sessionId, draftStorageKey, attachmentTransport])

  useLayoutEffect(() => {
    if (draftRestoreKey > 0 && textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + "px"
    }
  }, [draftRestoreKey])

  useEffect(() => {
    if (sessionId) textareaRef.current?.focus()
  }, [sessionId])

  // Ctrl held swaps the send button's icon to signal "this will also
  // interrupt" — purely a visual affordance ahead of the click/Enter itself,
  // which reads the modifier straight off its own event. Must clear on keyup
  // AND on blur/visibilitychange, or alt-tabbing away with Ctrl held leaves
  // the icon stuck lit.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.ctrlKey) setCtrlHeld(true) }
    const onKeyUp = (e: KeyboardEvent) => { if (!e.ctrlKey) setCtrlHeld(false) }
    const reset = () => setCtrlHeld(false)
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    window.addEventListener("blur", reset)
    document.addEventListener("visibilitychange", reset)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
      window.removeEventListener("blur", reset)
      document.removeEventListener("visibilitychange", reset)
    }
  }, [])

  useImperativeHandle(ref, () => ({
    loadDraft: (text, imgs, atts) => {
      setValue(text)
      setImages(imgs ?? [])
      setAttachments(restoreAttachments(atts ?? [], attachmentTransport))
      setDraftRestoreKey(k => k + 1)
      textareaRef.current?.focus()
    },
  }), [attachmentTransport])

  useEffect(() => {
    if (!draftStorageKey || !sessionId) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveDraftToStorage(draftStorageKey, sessionId, value, readyAttachments(attachments))
    }, DRAFT_SAVE_DELAY)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [value, attachments, draftStorageKey, sessionId])

  useEffect(() => {
    if (!draftStorageKey) return
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      const id = prevSessionRef.current
      const text = valueRef.current
      if (id && (text || attachmentsRef.current.length > 0))
        saveDraftToStorage(draftStorageKey, id, text, readyAttachments(attachmentsRef.current))
    }
  }, [draftStorageKey])

  const imageInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const uploadDraft = useCallback(async (draft: DraftAttachment) => {
    if (!attachmentTransport || !draft.file) return
    try {
      const uploaded = await attachmentTransport.upload(draft.file)
      if (removedUploadsRef.current.delete(draft.clientId)) {
        if (draft.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(draft.previewUrl)
        await attachmentTransport.delete(uploaded.id).catch(() => {})
        return
      }
      setAttachments(previous => previous.map(item => item.clientId === draft.clientId
        ? { ...uploaded, clientId: item.clientId, state: "ready", previewUrl: item.previewUrl }
        : item))
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed"
      setAttachments(previous => previous.map(item => item.clientId === draft.clientId
        ? { ...item, state: "error", error: message }
        : item))
    }
  }, [attachmentTransport])

  const addUploadedFiles = useCallback(async (files: File[]) => {
    if (!attachmentTransport) return
    const drafts = files.map<DraftAttachment>(file => ({
      id: "",
      clientId: newClientId(),
      kind: file.type.startsWith("image/") ? "image" : "file",
      name: file.name,
      mediaType: file.type || "application/octet-stream",
      size: file.size,
      downloadUrl: "",
      state: "uploading",
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
      file,
    }))
    setAttachments(previous => [...previous, ...drafts])
    await Promise.all(drafts.map(uploadDraft))
  }, [attachmentTransport, uploadDraft])

  const addImages = useCallback(async (files: File[]) => {
    if (attachmentTransport) {
      await addUploadedFiles(files)
      return
    }
    const results = await Promise.all(files.map(readImageFile))
    const valid = results.filter((result): result is ImageAttachment => result !== null)
    if (valid.length) setImages(previous => [...previous, ...valid])
  }, [attachmentTransport, addUploadedFiles])

  const retryAttachment = useCallback((clientId: string) => {
    const draft = attachmentsRef.current.find(item => item.clientId === clientId)
    if (!draft?.file) return
    setAttachments(previous => previous.map(item => item.clientId === clientId
      ? { ...item, state: "uploading", error: undefined }
      : item))
    void uploadDraft({ ...draft, state: "uploading", error: undefined })
  }, [uploadDraft])

  const removeAttachment = useCallback((clientId: string) => {
    const draft = attachmentsRef.current.find(item => item.clientId === clientId)
    setAttachments(previous => previous.filter(item => item.clientId !== clientId))
    if (draft?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(draft.previewUrl)
    if (draft?.state === "uploading") removedUploadsRef.current.add(clientId)
    if (draft?.state === "ready" && draft.id && attachmentTransport) {
      void attachmentTransport.delete(draft.id).catch(() => {})
    }
  }, [attachmentTransport])

  const doInterrupt = useCallback(() => {
    onInterrupt()
    textareaRef.current?.focus()
  }, [onInterrupt])

  // Enter / the send button always ENQUEUE — one code path whether idle or
  // streaming, so idle-drains-instantly and mid-turn-queues never diverge.
  // Ctrl+Enter / Ctrl+click is that same enqueue followed by onInterrupt: not
  // a second delivery path, just this one plus an interrupt.
  const handleSubmit = useCallback((opts?: { interruptToo?: boolean }) => {
    const ready = readyAttachments(attachments)
    const uploadsPending = attachments.some(attachment => attachment.state !== "ready")
    if (uploadsPending) return
    const clearComposer = () => {
      for (const attachment of attachments) {
        if (attachment.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(attachment.previewUrl)
      }
      setValue("")
      setImages([])
      setAttachments([])
      if (sessionId) {
        delete draftsRef.current[sessionId]
        if (draftStorageKey) removeDraftFromStorage(draftStorageKey, sessionId)
      }
      if (textareaRef.current) textareaRef.current.style.height = "auto"
    }
    const deliver = (trimmed: string) => {
      if (ready.length > 0 && onSendInput) onSendInput(trimmed, ready)
      else onSend(trimmed, images.length > 0 ? images : undefined)
      clearComposer()
    }
    if (isStreaming) {
      const trimmed = value.trim()
      if (trimmed || images.length > 0 || ready.length > 0) {
        deliver(trimmed)
        if (opts?.interruptToo) doInterrupt()
      } else {
        // Nothing to queue — Enter/click on an empty box while streaming just stops the turn, like Escape.
        doInterrupt()
      }
      return
    }
    const trimmed = value.trim()
    if (pendingQuestion && onAnswerQuestion) {
      if (!trimmed) return
      // Typing instead of picking is the tool's freeform `response` channel,
      // not a conversation turn — and not an `answers` selection either: at the
      // CLI, `response` outranks and discards any selections sent with it.
      onAnswerQuestion(trimmed, { response: trimmed })
      clearComposer()
      return
    }
    if ((!trimmed && images.length === 0 && ready.length === 0) || disabled) return
    deliver(trimmed)
  }, [value, images, attachments, disabled, isStreaming, onSend, onSendInput, doInterrupt, pendingQuestion, onAnswerQuestion, sessionId, draftStorageKey])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && isStreaming) {
      e.preventDefault()
      doInterrupt()
      return
    }
    if (e.key === "Tab" && e.shiftKey && onTogglePlanMode) {
      e.preventDefault()
      onTogglePlanMode()
      return
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit({ interruptToo: e.ctrlKey })
    }
  }

  useEffect(() => {
    if (!disabled || isStreaming || !onResume) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault()
        onResume()
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [disabled, isStreaming, onResume])

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    if (!enableImageAttachments) return
    const items = Array.from(e.clipboardData.items)
    const imageFiles = items
      .filter(item => item.type.startsWith("image/"))
      .map(item => item.getAsFile())
      .filter((f): f is File => f !== null)
    if (imageFiles.length > 0) {
      e.preventDefault()
      await addImages(imageFiles)
    }
  }, [addImages, enableImageAttachments])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const files = acceptedAttachmentFiles(Array.from(e.dataTransfer.files), enableImageAttachments, fileAttachmentsEnabled)
    if (files.length === 0) return
    if (attachmentTransport) await addUploadedFiles(files)
    else await addImages(files.filter(file => file.type.startsWith("image/")))
  }, [addImages, addUploadedFiles, attachmentTransport, enableImageAttachments, fileAttachmentsEnabled])

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value)
    const el = e.target
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 200) + "px"
  }

  const removeImage = useCallback((index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index))
  }, [])

  const handleImageSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0) await addImages(files)
    if (imageInputRef.current) imageInputRef.current.value = ""
  }, [addImages])

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = acceptedAttachmentFiles(Array.from(e.target.files || []), enableImageAttachments, fileAttachmentsEnabled)
    if (files.length > 0) await addUploadedFiles(files)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }, [addUploadedFiles, enableImageAttachments, fileAttachmentsEnabled])

  const inputDisabled = disabled && !isStreaming
  const isPlan = permissionMode === "plan"
  const hasContent = !!value.trim() || images.length > 0 || attachments.some(attachment => attachment.state === "ready")
  const attachmentBusy = attachments.some(attachment => attachment.state !== "ready")
  const willInterrupt = isStreaming && (!hasContent || ctrlHeld)

  const defaultPlaceholder = inputDisabled
    ? "Session not active"
    : interrupting
      ? "Interrupting the current turn…"
      : isStreaming
        ? "Press Escape to interrupt, or type to queue a follow-up..."
        : resumePending
          ? "Reconnecting to the session…"
          : pendingQuestion
            ? "Type your answer here..."
            : "Send a message..."

  return (
    <div data-slot="composer" className="px-3 pt-3 pb-5 shrink-0">
      {enableImageAttachments && (
        <input
          ref={imageInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          className="hidden"
          onChange={handleImageSelect}
        />
      )}
      {fileAttachmentsEnabled && (
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
      )}
      <div className="max-w-3xl mx-auto flex gap-2 items-stretch">
        <div
          className={`flex-1 flex flex-col rounded-lg bg-overlay-6 shadow-md transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] relative focus-within:scale-[1.005] focus-within:shadow-xl ${dragOver ? "ring-2 ring-accent-gold-a50" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pt-2.5">
              {images.map((img, i) => (
                <div key={i} className="relative group">
                  <img
                    src={`data:${img.mediaType};base64,${img.base64}`}
                    alt=""
                    className="h-16 w-16 object-cover rounded-md border border-overlay-10"
                  />
                  <button
                    onClick={() => removeImage(i)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500-a80 hover:bg-red-500 text-white text-[10px] flex items-center justify-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                  >
                    <i className="ph-bold ph-x" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pt-2.5">
              {attachments.map(attachment => attachment.kind === "image" ? (
                <div key={attachment.clientId} className="relative group">
                  <img
                    src={attachment.previewUrl || attachment.downloadUrl}
                    alt={attachment.name}
                    className={`h-16 w-16 object-cover rounded-md border ${attachment.state === "error" ? "border-red-500-a60" : "border-overlay-10"}`}
                  />
                  {attachment.state === "uploading" && (
                    <div className="absolute inset-0 rounded-md bg-black/50 flex items-center justify-center"><i className="ph-bold ph-spinner animate-spin text-white" /></div>
                  )}
                  {attachment.state === "error" && (
                    <button type="button" onClick={() => retryAttachment(attachment.clientId)} className="absolute inset-0 rounded-md bg-red-950/70 text-[10px] text-white px-1" title={attachment.error}>Retry</button>
                  )}
                  <button type="button" onClick={() => removeAttachment(attachment.clientId)} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500-a80 hover:bg-red-500 text-white text-[10px] flex items-center justify-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity" aria-label={`Remove ${attachment.name}`}>
                    <i className="ph-bold ph-x" />
                  </button>
                </div>
              ) : (
                <AttachmentCard key={attachment.clientId} attachment={attachment} onRemove={() => removeAttachment(attachment.clientId)} onRetry={() => retryAttachment(attachment.clientId)} />
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={inputDisabled}
            placeholder={placeholder || defaultPlaceholder}
            rows={1}
            className="message-input-textarea w-full flex-1 resize-none bg-transparent px-3 py-2 text-sm font-serif placeholder:text-text-muted focus:outline-none disabled:opacity-50 min-h-[6.5rem]"
          />
          {renderInlineAction?.({ value, isStreaming, disabled: inputDisabled, hasImages: images.length > 0, hasAttachments: attachments.length > 0 })}
        </div>
        <div className="flex flex-col justify-end gap-1.5 shrink-0 w-16">
          <div className="flex justify-center gap-1">
            {enableImageAttachments && (
              <button
                onClick={() => imageInputRef.current?.click()}
                disabled={inputDisabled}
                className="w-7 h-7 flex items-center justify-center rounded text-muted-a50 hover:text-text-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Attach image"
              >
                <i className="ph-bold ph-image text-xs" />
              </button>
            )}
            {fileAttachmentsEnabled && (
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={inputDisabled}
                className="w-7 h-7 flex items-center justify-center rounded text-muted-a50 hover:text-text-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Attach file"
              >
                <i className="ph-bold ph-paperclip text-xs" />
              </button>
            )}
          </div>
          {onTogglePlanMode && (
            <button
              onClick={onTogglePlanMode}
              disabled={inputDisabled}
              className={`w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors border ${
                isPlan
                  ? "bg-violet-500-a20 text-violet-300 hover:bg-violet-500-a30 border-violet-500-a30"
                  : "bg-overlay-6 text-text-muted hover:bg-overlay-10 border-transparent"
              } disabled:opacity-30 disabled:cursor-not-allowed`}
              title="Toggle plan mode (Shift+Tab)"
            >
              <i className={`ph-bold ${isPlan ? "ph-compass-tool" : "ph-lightning"} w-3 inline-block text-center`} />
              {isPlan ? "Plan" : "Act"}
            </button>
          )}
          {isStreaming ? (
            <button
              onClick={(e) => handleSubmit({ interruptToo: e.ctrlKey })}
              className={`w-full flex-1 px-3 py-2 rounded-md transition-colors flex items-center justify-center ${
                willInterrupt ? "bg-amber-500-a20 hover:bg-amber-500-a30 text-amber-400" : "bg-overlay-10 hover:bg-overlay-15"
              }`}
              title={!hasContent ? "Interrupt (Escape)" : ctrlHeld ? "Send now (interrupts the current turn)" : "Queue — sends when the current turn ends (Ctrl+Enter to send now)"}
            >
              <i className={`ph-bold ${willInterrupt ? "ph-stop" : "ph-paper-plane"} text-sm`} />
            </button>
          ) : disabled && onResume ? (
            <button
              onClick={onResume}
              className="w-full flex-1 px-3 py-2 rounded-md bg-accent-gold-a20 hover:bg-accent-gold-a30 text-accent-gold transition-colors flex items-center justify-center"
              title="Resume session (Enter)"
            >
              <i className="ph-bold ph-arrow-clockwise text-sm" />
            </button>
          ) : (
            <button
              onClick={() => handleSubmit()}
              disabled={disabled || attachmentBusy || (!value.trim() && images.length === 0 && attachments.length === 0)}
              className="w-full flex-1 px-3 py-2 rounded-md bg-overlay-10 hover:bg-overlay-15 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
            >
              <i className="ph-bold ph-paper-plane text-sm" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
})
