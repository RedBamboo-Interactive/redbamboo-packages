import { cn } from "../utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog"
import { Badge } from "./badge"
import { Separator } from "./separator"

export interface AboutApp {
  name: string
  version: string
  description?: string
  icon?: string
}

export interface AboutDialogProps {
  app: AboutApp
  appGitHub?: string
  companyGitHub?: string
  latestVersion?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

function fmtVersion(v: string) {
  return v.startsWith("v") ? v : `v${v}`
}

function AboutDialog({
  app,
  appGitHub,
  companyGitHub,
  latestVersion,
  open,
  onOpenChange,
}: AboutDialogProps) {
  const hasUpdate = latestVersion && latestVersion !== app.version

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-slot="about-dialog">
        <DialogHeader>
          <div className="flex items-center gap-3">
            {app.icon && (
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                <i className={cn(app.icon, "text-lg text-primary")} />
              </div>
            )}
            <div>
              <DialogTitle>{app.name}</DialogTitle>
              <Badge variant="secondary" className="mt-1.5 text-[0.7rem]">
                {fmtVersion(app.version)}
              </Badge>
            </div>
          </div>
          {app.description && (
            <DialogDescription>{app.description}</DialogDescription>
          )}
        </DialogHeader>

        {hasUpdate && (
          <div className="flex items-center gap-2 rounded-lg border border-accent-teal/30 bg-accent-teal/5 px-3 py-2 text-sm text-accent-teal">
            <i className="fa-solid fa-circle-up text-xs" />
            <span>
              Version <strong>{fmtVersion(latestVersion)}</strong> available
            </span>
          </div>
        )}

        <Separator />

        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">RedBamboo Interactive</p>
            <p className="text-xs text-muted-foreground">
              Open-source tools for creators and developers
            </p>
          </div>

          {(appGitHub || companyGitHub) && (
            <div className="flex flex-col gap-1.5">
              {appGitHub && (
                <a
                  href={appGitHub}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  <i className="fa-brands fa-github" />
                  {app.name}
                </a>
              )}
              {companyGitHub && (
                <a
                  href={companyGitHub}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  <i className="fa-brands fa-github" />
                  RedBamboo Interactive
                </a>
              )}
            </div>
          )}
        </div>

        <DialogFooter showCloseButton>
          <p className="mr-auto text-xs text-muted-foreground">MIT License</p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { AboutDialog }
