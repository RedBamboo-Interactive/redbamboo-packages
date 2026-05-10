import { useState, useRef, useCallback, useEffect, useLayoutEffect } from "react"
import type { ImageAttachment } from "../types"

interface ComposerProps {
  onSend: (content: string, images?: ImageAttachment[]) => void
  onInterrupt: () => void
  disabled: boolean
  isStreaming: boolean
  placeholder?: string
  permissionMode?: string
  onTogglePlanMode?: () => void
  pendingQuestion?: boolean
  onAnswerQuestion?: (answer: string) => void
  sessionId?: string | null
  renderInlineAction?: (state: { value: string; isStreaming: boolean; disabled: boolean; hasImages: boolean }) => React.ReactNode
  enableImageAttachments?: boolean
  enableFileAttachments?: boolean
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

export function Composer({
  onSend,
  onInterrupt,
  disabled,
  isStreaming,
  placeholder,
  permissionMode,
  onTogglePlanMode,
  pendingQuestion,
  onAnswerQuestion,
  sessionId,
  renderInlineAction,
  enableImageAttachments = true,
  enableFileAttachments = true,
}: ComposerProps) {
  const [value, setValue] = useState("")
  const [images, setImages] = useState<ImageAttachment[]>([])
  const [dragOver, setDragOver] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const draftsRef = useRef<Record<string, { value: string; images: ImageAttachment[] }>>({})
  const prevSessionRef = useRef<string | null | undefined>(undefined)
  const valueRef = useRef(value)
  const imagesRef = useRef(images)
  const [draftRestoreKey, setDraftRestoreKey] = useState(0)
  valueRef.current = value
  imagesRef.current = images

  useEffect(() => {
    if (prevSessionRef.current !== undefined && prevSessionRef.current !== sessionId) {
      const prevId = prevSessionRef.current
      if (prevId) {
        draftsRef.current[prevId] = { value: valueRef.current, images: imagesRef.current }
      }
      const draft = sessionId ? draftsRef.current[sessionId] : undefined
      setValue(draft?.value ?? "")
      setImages(draft?.images ?? [])
      setDraftRestoreKey(k => k + 1)
    }
    prevSessionRef.current = sessionId
  }, [sessionId])

  useLayoutEffect(() => {
    if (draftRestoreKey > 0 && textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + "px"
    }
  }, [draftRestoreKey])

  useEffect(() => {
    if (sessionId) textareaRef.current?.focus()
  }, [sessionId])

  const imageInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addImages = useCallback(async (files: File[]) => {
    const results = await Promise.all(files.map(readImageFile))
    const valid = results.filter((r): r is ImageAttachment => r !== null)
    if (valid.length) setImages(prev => [...prev, ...valid])
  }, [])

  const handleSubmit = useCallback(() => {
    if (isStreaming) {
      onInterrupt()
      return
    }
    const trimmed = value.trim()
    if (pendingQuestion && onAnswerQuestion) {
      if (!trimmed) return
      onAnswerQuestion(trimmed)
      setValue("")
      setImages([])
      if (sessionId) delete draftsRef.current[sessionId]
      if (textareaRef.current) textareaRef.current.style.height = "auto"
      return
    }
    if ((!trimmed && images.length === 0) || disabled) return
    onSend(trimmed, images.length > 0 ? images : undefined)
    setValue("")
    setImages([])
    if (sessionId) delete draftsRef.current[sessionId]
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
    }
  }, [value, images, disabled, isStreaming, onSend, onInterrupt, pendingQuestion, onAnswerQuestion, sessionId])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && isStreaming) {
      e.preventDefault()
      onInterrupt()
      return
    }
    if (e.key === "Tab" && e.shiftKey && onTogglePlanMode) {
      e.preventDefault()
      onTogglePlanMode()
      return
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items)
    const imageFiles = items
      .filter(item => item.type.startsWith("image/"))
      .map(item => item.getAsFile())
      .filter((f): f is File => f !== null)
    if (imageFiles.length > 0) {
      e.preventDefault()
      await addImages(imageFiles)
    }
  }, [addImages])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/"))
    if (files.length > 0) await addImages(files)
  }, [addImages])

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
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    const parts: string[] = []
    for (const file of files) {
      const text = await file.text()
      parts.push(files.length > 1 ? `--- ${file.name} ---\n${text}` : text)
    }
    setValue(prev => prev + (prev ? "\n" : "") + parts.join("\n\n"))
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + "px"
    }
    if (fileInputRef.current) fileInputRef.current.value = ""
  }, [])

  const inputDisabled = disabled && !isStreaming
  const isPlan = permissionMode === "plan"

  const defaultPlaceholder = inputDisabled
    ? "Session not active"
    : isStreaming
      ? "Press Escape to interrupt, or type a follow-up..."
      : pendingQuestion
        ? "Type your answer here..."
        : "Send a message..."

  return (
    <div className="px-3 pt-3 pb-5 shrink-0">
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
      {enableFileAttachments && (
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
          className={`flex-1 flex flex-col rounded-lg bg-white/[0.06] shadow-lg transition-colors relative ${dragOver ? "ring-2 ring-accent-gold/50" : ""}`}
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
                    className="h-16 w-16 object-cover rounded-md border border-white/10"
                  />
                  <button
                    onClick={() => removeImage(i)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500/80 hover:bg-red-500 text-white text-[10px] flex items-center justify-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                  >
                    <i className="fa-solid fa-xmark" />
                  </button>
                </div>
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
            className="message-input-textarea w-full flex-1 resize-none bg-transparent px-3 py-2 text-sm font-serif placeholder:text-text-muted focus:outline-none disabled:opacity-50"
          />
          {renderInlineAction?.({ value, isStreaming, disabled: inputDisabled, hasImages: images.length > 0 })}
        </div>
        <div className="flex flex-col justify-end gap-1.5 shrink-0 w-16">
          <div className="flex justify-center gap-1">
            {enableImageAttachments && (
              <button
                onClick={() => imageInputRef.current?.click()}
                disabled={inputDisabled}
                className="w-7 h-7 flex items-center justify-center rounded text-text-muted/50 hover:text-text-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Attach image"
              >
                <i className="fa-solid fa-image text-xs" />
              </button>
            )}
            {enableFileAttachments && (
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={inputDisabled}
                className="w-7 h-7 flex items-center justify-center rounded text-text-muted/50 hover:text-text-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Attach file"
              >
                <i className="fa-solid fa-paperclip text-xs" />
              </button>
            )}
          </div>
          {onTogglePlanMode && (
            <button
              onClick={onTogglePlanMode}
              disabled={inputDisabled}
              className={`w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors border ${
                isPlan
                  ? "bg-violet-500/20 text-violet-300 hover:bg-violet-500/30 border-violet-500/30"
                  : "bg-white/[0.06] text-text-muted hover:bg-white/10 border-transparent"
              } disabled:opacity-30 disabled:cursor-not-allowed`}
              title="Toggle plan mode (Shift+Tab)"
            >
              <i className={`fa-solid ${isPlan ? "fa-compass-drafting" : "fa-bolt"} w-3 inline-block text-center`} />
              {isPlan ? "Plan" : "Act"}
            </button>
          )}
          {isStreaming ? (
            <button
              onClick={onInterrupt}
              className="w-full px-3 py-2 rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 transition-colors flex items-center justify-center"
              title="Interrupt (Escape)"
            >
              <i className="fa-solid fa-stop text-sm" />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={disabled || (!value.trim() && images.length === 0)}
              className="w-full px-3 py-2 rounded-md bg-white/10 hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
            >
              <i className="fa-solid fa-paper-plane text-sm" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
