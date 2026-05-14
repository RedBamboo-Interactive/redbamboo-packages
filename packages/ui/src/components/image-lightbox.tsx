import {
  Dialog,
  DialogContent,
} from "./dialog"

export interface ImageLightboxProps {
  src: string
  alt?: string
  onClose: () => void
}

export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
  return (
    <Dialog open={true} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent
        showCloseButton={false}
        className="bg-transparent p-0 ring-0 shadow-none rounded-none w-auto max-w-[90vw] gap-0"
      >
        <img
          data-slot="image-lightbox"
          src={src}
          alt={alt}
          className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg shadow-2xl"
        />
        <button
          onClick={onClose}
          className="absolute top-2 right-2 w-9 h-9 rounded-full bg-overlay-10 hover:bg-overlay-20 flex items-center justify-center text-contrast transition-colors"
        >
          <i className="fa-solid fa-xmark" />
        </button>
      </DialogContent>
    </Dialog>
  )
}
