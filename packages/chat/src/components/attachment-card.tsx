import type { DraftAttachment, UploadedAttachment } from "../types"

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

function extension(name: string): string {
  const i = name.lastIndexOf(".")
  return i > 0 && i < name.length - 1 ? name.slice(i + 1).toUpperCase() : "FILE"
}

export function AttachmentCard({ attachment, onRemove, onRetry, compact = false }: {
  attachment: UploadedAttachment | DraftAttachment
  onRemove?: () => void
  onRetry?: () => void
  compact?: boolean
}) {
  const draft = "state" in attachment ? attachment : undefined
  const typeLabel = attachment.mediaType || extension(attachment.name)
  return (
    <div
      data-slot="attachment-card"
      className={`group/attachment flex min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 ${compact ? "max-w-56" : "max-w-72"} ${
        draft?.state === "error" ? "border-red-500-a40 bg-red-500-a10" : "border-overlay-10 bg-overlay-6"
      }`}
      title={draft?.error || attachment.name}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-overlay-8 text-text-muted">
        {draft?.state === "uploading" ? (
          <i className="ph-bold ph-spinner-gap animate-spin text-xs" />
        ) : draft?.state === "error" ? (
          <i className="ph-bold ph-warning text-xs text-red-400" />
        ) : (
          <i className="ph-bold ph-file text-sm" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-text-secondary">{attachment.name}</div>
        <div className={`truncate text-[10px] ${draft?.state === "error" ? "text-red-400" : "text-text-muted"}`}>
          {draft?.state === "uploading" ? "Uploading…" : draft?.state === "error" ? draft.error || "Upload failed" : `${typeLabel} · ${formatAttachmentSize(attachment.size)}`}
        </div>
      </div>
      {draft?.state === "error" && onRetry && (
        <button onClick={onRetry} className="h-6 w-6 shrink-0 rounded text-text-muted hover:bg-overlay-8 hover:text-text-primary" title="Retry upload">
          <i className="ph-bold ph-arrow-clockwise text-xs" />
        </button>
      )}
      {onRemove && (
        <button onClick={onRemove} className="h-6 w-6 shrink-0 rounded text-text-muted hover:bg-overlay-8 hover:text-red-400" title="Remove attachment">
          <i className="ph-bold ph-x text-xs" />
        </button>
      )}
    </div>
  )
}
