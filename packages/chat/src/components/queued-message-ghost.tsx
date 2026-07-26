import type { QueuedMessage } from "../lib/message-queue"
import type { ImageAttachment } from "../types"

interface QueuedMessageGhostProps {
  item: QueuedMessage
  onCancel: (id: string) => void
  onEdit: (id: string) => void
  onSendNow: () => void
}

/**
 * A queued follow-up rendered where its user bubble will land once it sends —
 * dashed border + reduced opacity distinguish it from a delivered message.
 * The whole point of the queue is that this is never invisible.
 */
export function QueuedMessageGhost({ item, onCancel, onEdit, onSendNow }: QueuedMessageGhostProps) {
  return (
    <div className="mb-3" data-slot="queued-message">
      <div className="flex justify-end">
        <div
          onClick={() => onEdit(item.id)}
          className="max-w-[80%] cursor-pointer rounded-xl rounded-br-sm border border-dashed border-overlay-20 bg-overlay-6 px-4 py-2.5 opacity-60 transition-opacity hover:opacity-90"
          title="Click to edit"
        >
          {item.images && item.images.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {item.images.map((img: ImageAttachment, i: number) => (
                <img
                  key={i}
                  src={`data:${img.mediaType};base64,${img.base64}`}
                  alt=""
                  className="max-h-32 rounded-md border border-overlay-10"
                />
              ))}
            </div>
          )}
          {item.text && <p className="text-sm whitespace-pre-wrap break-words font-serif">{item.text}</p>}
        </div>
      </div>
      <div className="flex items-center justify-end gap-1 mt-1">
        <span className="text-[10px] text-text-disabled italic mr-1">Queued — sends after this turn</span>
        <button
          onClick={(e) => { e.stopPropagation(); onSendNow() }}
          className="w-5 h-5 flex items-center justify-center rounded text-text-disabled hover:text-amber-400 hover:bg-overlay-6 transition-colors"
          title="Send now (interrupts the current turn)"
        >
          <i className="ph-bold ph-paper-plane-tilt text-[10px]" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onCancel(item.id) }}
          className="w-5 h-5 flex items-center justify-center rounded text-text-disabled hover:text-red-400 hover:bg-overlay-6 transition-colors"
          title="Cancel"
        >
          <i className="ph-bold ph-x text-[10px]" />
        </button>
      </div>
    </div>
  )
}
