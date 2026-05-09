import { useEffect } from "react"
import { X } from "lucide-react"

import { cn } from "../utils"
import { Card, CardHeader } from "./card"
import { Button } from "./button"

export type ModalSize = "sm" | "md" | "lg" | "xl"

const SIZE_MAP: Record<ModalSize, string> = {
  sm: "max-w-lg",
  md: "max-w-xl",
  lg: "max-w-2xl",
  xl: "max-w-3xl",
}

export interface ModalBaseProps {
  dataModal: string
  ariaLabel: string
  onClose: () => void
  size?: ModalSize
  dataAttrs?: Record<string, string>
  children: React.ReactNode
}

export function ModalBase({ dataModal, ariaLabel, onClose, size = "xl", dataAttrs, children }: ModalBaseProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-modal="true"
      data-modal={dataModal}
      aria-label={ariaLabel}
      {...dataAttrs}
    >
      <Card className={cn("w-full mx-4 max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-98 slide-in-from-bottom-8 duration-200", SIZE_MAP[size])}>
        {children}
      </Card>
    </div>
  )
}

export interface ModalHeaderProps {
  icon?: React.ReactNode
  title: React.ReactNode
  badges?: React.ReactNode
  subtitle?: React.ReactNode
  onClose: () => void
  closeLabel?: string
}

export function ModalHeader({ icon, title, badges, subtitle, onClose, closeLabel }: ModalHeaderProps) {
  return (
    <CardHeader className="pb-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {icon}
          <div>
            <div className="flex items-center gap-2">
              {title}
              {badges}
            </div>
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
        </div>
        <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label={closeLabel ?? "Close"}>
          <X className="w-4 h-4" />
        </Button>
      </div>
    </CardHeader>
  )
}

export interface ModalSectionProps {
  section: string
  heading?: string
  ariaLabel?: string
  dataAttrs?: Record<string, string>
  children: React.ReactNode
}

export function ModalSection({ section, heading, ariaLabel, dataAttrs, children }: ModalSectionProps) {
  return (
    <div data-section={section} aria-label={ariaLabel} {...dataAttrs}>
      {heading && <h3 className="text-sm font-semibold text-foreground mb-2">{heading}</h3>}
      {children}
    </div>
  )
}

export interface ModalFooterProps {
  children: React.ReactNode
  align?: "start" | "end" | "between"
}

export function ModalFooter({ children, align }: ModalFooterProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 pt-4 mt-2 border-t border-border/50",
        align === "end" && "justify-end",
        align === "between" && "justify-between",
      )}
      data-section="actions"
    >
      {children}
    </div>
  )
}
