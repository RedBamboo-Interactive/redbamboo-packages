import { useState, useCallback } from "react"
import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  ToastProvider,
  useToast,
} from "@redbamboo/ui"
import { AuthProvider, useAuth } from "./auth-provider"
import { AppHeader } from "./app-header"
import { AboutDialog } from "./about-dialog"
import { FeedbackDialog } from "./feedback-dialog"
import type { FeedbackSubmission } from "./feedback-dialog"
import { CommandProvider } from "./command-provider"
import { CommandPalette, openCommandPalette } from "./command-palette"
import { useCommand } from "./use-command"
import { useInstallPrompt } from "./use-install-prompt"
import { ShareDialog } from "./share-dialog"
import { AppSwitcher } from "./app-switcher"
import { useAskNova } from "./ask-nova"
import type { AppShellProps } from "./app-shell-types"

const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)

function ShellCommands({
  onAbout,
  onFeedback,
  onShare,
  shareEnabled,
  canInstall,
  install,
}: {
  onAbout: () => void
  onFeedback: () => void
  onShare: () => void
  shareEnabled: boolean
  canInstall: boolean
  install: () => void
}) {
  const { user, logout } = useAuth()

  useCommand("app-shell:sign-out", {
    label: "Sign Out",
    group: "App",
    action: () => logout(),
    enabled: !!user,
  })

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

  useCommand("app-shell:share", {
    label: "Share",
    group: "App",
    keywords: ["qr", "link"],
    action: onShare,
    enabled: shareEnabled,
  })

  useCommand("app-shell:install", {
    label: "Install App",
    group: "App",
    keywords: ["pwa", "download"],
    action: install,
    enabled: canInstall,
  })

  return null
}

const NOVA_PORT = "18803"

function AskNovaCommands({ appName }: { appName: string }) {
  const nova = useAskNova({ app: appName })

  const isNova = typeof window !== "undefined" && window.location.port === NOVA_PORT
  useCommand("ask-nova", {
    label: "Ask Nova about this page",
    group: "AI",
    shortcut: "Ctrl+Shift+N",
    keywords: ["nova", "ai", "ask", "question", "help", "context"],
    action: () => { nova.ask() },
    enabled: !isNova,
  })

  useCommand("ask-nova-selection", {
    label: "Ask Nova about selection",
    group: "AI",
    keywords: ["nova", "ai", "selection", "highlight", "text"],
    action: () => { nova.askWithSelection() },
    enabled: !isNova,
  })

  return null
}

function AppShellInner({
  config,
  headerContent,
  breadcrumb,
  menuItems,
  children,
  className,
}: AppShellProps) {
  const { user, logout } = useAuth()
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const { toast, update } = useToast()
  const { canInstall, install } = useInstallPrompt()

  const shareUrl = config.share?.url()

  const openSwitcher = useCallback(() => setSwitcherOpen(true), [])
  const openAbout = useCallback(() => setAboutOpen(true), [])
  const openFeedback = useCallback(() => setFeedbackOpen(true), [])
  const openShare = useCallback(() => setShareOpen(true), [])

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
        <AppHeader brand={config.brand} breadcrumb={breadcrumb} onBrandClick={openSwitcher}>
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
              {menuItems && (
                <DropdownMenuGroup>
                  {menuItems}
                </DropdownMenuGroup>
              )}
              {menuItems && <DropdownMenuSeparator />}
              <DropdownMenuGroup>
                {shareUrl && (
                  <DropdownMenuItem onClick={openShare}>
                    <i className="fa-solid fa-qrcode size-4 text-center" />
                    Share
                  </DropdownMenuItem>
                )}
                {canInstall && (
                  <DropdownMenuItem onClick={install}>
                    <i className="fa-solid fa-download size-4 text-center" />
                    Install
                  </DropdownMenuItem>
                )}
                {config.onFeedbackSubmit && (
                  <DropdownMenuItem onClick={openFeedback}>
                    <i className="fa-solid fa-message size-4 text-center" />
                    Send Feedback
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={openCommandPalette}>
                  <i className="fa-solid fa-terminal size-4 text-center" />
                  Command Palette
                  <DropdownMenuShortcut>
                    {isMac ? "⌘K" : "Ctrl+K"}
                  </DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={openAbout}>
                  <i className="fa-solid fa-circle-info size-4 text-center" />
                  About {config.name}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              {user && (
                <>
                  <DropdownMenuSeparator />
                  <div className="flex items-center gap-3 px-3 py-2">
                    <div className="size-8 rounded-full bg-primary-a20 flex items-center justify-center text-xs font-medium text-primary shrink-0 overflow-hidden">
                      {user.avatarUrl ? (
                        <img src={user.avatarUrl} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        (user.name?.[0] || user.email[0]).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{user.name || "User"}</div>
                      <div className="text-xs text-muted-foreground truncate">{user.email}</div>
                    </div>
                  </div>
                  <DropdownMenuItem onClick={() => logout()}>
                    <i className="fa-solid fa-right-from-bracket size-4 text-center" />
                    Sign Out
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </AppHeader>

        {children}
      </div>

      <AppSwitcher open={switcherOpen} onOpenChange={setSwitcherOpen} />

      <ShellCommands
        onAbout={openAbout}
        onFeedback={openFeedback}
        onShare={openShare}
        shareEnabled={!!shareUrl}
        canInstall={canInstall}
        install={install}
      />
      <AskNovaCommands appName={config.name} />
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

      {shareUrl && (
        <ShareDialog
          url={shareUrl}
          title={config.share?.title}
          description={config.share?.description}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      )}
    </>
  )
}

function AppShell(props: AppShellProps) {
  return (
    <AuthProvider>
      <CommandProvider>
        <ToastProvider>
          <AppShellInner {...props} />
        </ToastProvider>
      </CommandProvider>
    </AuthProvider>
  )
}

export { AppShell }
