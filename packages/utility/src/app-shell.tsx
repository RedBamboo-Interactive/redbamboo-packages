import { useState, useCallback } from "react"
import {
  AppHeader,
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  AboutDialog,
  FeedbackDialog,
  ToastProvider,
  useToast,
} from "@redbamboo/ui"
import type { FeedbackSubmission } from "@redbamboo/ui"
import { CommandProvider } from "./command-provider"
import { CommandPalette, openCommandPalette } from "./command-palette"
import { useCommand } from "./use-command"
import type { AppShellProps } from "./app-shell-types"

const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)

function ShellCommands({
  onAbout,
  onFeedback,
}: {
  onAbout: () => void
  onFeedback: () => void
}) {
  useCommand("app-shell:about", {
    label: "About",
    group: "App",
    action: onAbout,
  })

  useCommand("app-shell:feedback", {
    label: "Send Feedback",
    group: "App",
    action: onFeedback,
  })

  useCommand("app-shell:command-palette", {
    label: "Command Palette",
    group: "App",
    shortcut: isMac ? "⌘K" : "Ctrl+K",
    action: openCommandPalette,
  })

  return null
}

function AppShellInner({
  config,
  headerContent,
  menuItems,
  children,
  className,
}: AppShellProps) {
  const [aboutOpen, setAboutOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const { toast, update } = useToast()

  const openAbout = useCallback(() => setAboutOpen(true), [])
  const openFeedback = useCallback(() => setFeedbackOpen(true), [])

  const handleFeedbackSubmit = useCallback(
    (submission: FeedbackSubmission) => {
      if (!config.onFeedbackSubmit) return

      const id = toast({ title: "Sending feedback...", variant: "loading" })

      config.onFeedbackSubmit(submission)
        .then((result) => {
          update(id, {
            title: "Feedback sent",
            description: result.title,
            variant: "success",
            action: result.issueUrl
              ? { label: "View on GitHub", onClick: () => window.open(result.issueUrl, "_blank") }
              : undefined,
          })
        })
        .catch((err: unknown) => {
          update(id, {
            title: "Feedback failed",
            description: err instanceof Error ? err.message : "Unknown error",
            variant: "error",
          })
        })
    },
    [config.onFeedbackSubmit, toast, update],
  )

  return (
    <>
      <div
        data-slot="app-shell"
        className={className ?? "flex h-full w-full flex-col"}
      >
        <AppHeader brand={config.brand}>
          {headerContent}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  data-slot="app-shell-menu-trigger"
                />
              }
            >
              <i className="fa-solid fa-bars" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={openAbout}>
                  <i className="fa-solid fa-circle-info size-4 text-center" />
                  About {config.name}
                </DropdownMenuItem>
                {config.onFeedbackSubmit && (
                  <DropdownMenuItem onClick={openFeedback}>
                    <i className="fa-solid fa-message size-4 text-center" />
                    Send Feedback
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={openCommandPalette}>
                  <i className="fa-solid fa-terminal size-4 text-center" />
                  Command Palette
                  <DropdownMenuShortcut>
                    {isMac ? "⌘K" : "Ctrl+K"}
                  </DropdownMenuShortcut>
                </DropdownMenuItem>
              </DropdownMenuGroup>
              {menuItems && (
                <>
                  <DropdownMenuSeparator />
                  {menuItems}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </AppHeader>

        {children}
      </div>

      <ShellCommands onAbout={openAbout} onFeedback={openFeedback} />
      <CommandPalette />

      <AboutDialog
        app={{
          name: config.name,
          version: config.version,
          description: config.description,
          icon: config.icon,
        }}
        appGitHub={config.github?.app}
        companyGitHub={config.github?.company}
        latestVersion={config.latestVersion}
        open={aboutOpen}
        onOpenChange={setAboutOpen}
      />

      {config.onFeedbackSubmit && (
        <FeedbackDialog
          app={{ name: config.name, version: config.version }}
          customMetadata={config.feedbackMetadata}
          onSubmit={handleFeedbackSubmit}
          open={feedbackOpen}
          onOpenChange={setFeedbackOpen}
        />
      )}
    </>
  )
}

function AppShell(props: AppShellProps) {
  return (
    <CommandProvider>
      <ToastProvider>
        <AppShellInner {...props} />
      </ToastProvider>
    </CommandProvider>
  )
}

export { AppShell }
