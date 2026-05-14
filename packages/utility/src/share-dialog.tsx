import { useMemo } from "react"
import { QRCodeSVG } from "qrcode.react"
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Input,
} from "@redbamboo/ui"

export interface ShareDialogProps {
  url: string
  title?: string
  description?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

function ShareDialog({
  url,
  title = "Share",
  description,
  open,
  onOpenChange,
}: ShareDialogProps) {
  const qr = useMemo(
    () => (
      <QRCodeSVG
        value={url}
        size={180}
        bgColor="#ffffff"
        fgColor="#262830"
        level="M"
      />
    ),
    [url],
  )

  function copyUrl() {
    navigator.clipboard.writeText(url)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-slot="share-dialog" className="sm:max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary-a10">
              <i className="fa-solid fa-qrcode text-lg text-primary" />
            </div>
            <div>
              <DialogTitle>{title}</DialogTitle>
              {description && (
                <DialogDescription>{description}</DialogDescription>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4">
          <div className="rounded-xl bg-white p-4">{qr}</div>
          <div className="flex w-full items-center gap-2">
            <Input
              readOnly
              value={url}
              className="flex-1 truncate font-mono text-[10px]"
            />
            <Button variant="outline" size="sm" onClick={copyUrl}>
              <i className="fa-solid fa-copy" />
              Copy
            </Button>
          </div>
        </div>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  )
}

export { ShareDialog }
