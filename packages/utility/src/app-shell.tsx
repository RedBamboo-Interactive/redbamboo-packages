import { useState, useCallback, useRef, useEffect } from "react"
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import { AppHeader, AppHeaderBrand } from "./app-header"
import { AppMenu } from "./app-menu"
import { AboutDialog } from "./about-dialog"
import { FeedbackDialog } from "./feedback-dialog"
import type { FeedbackSubmission } from "./feedback-dialog"
import { submitFeedbackViaSession } from "./submit-feedback"
import { CommandProvider } from "./command-provider"
import { CommandPalette, openCommandPalette } from "./command-palette"
import { useCommand } from "./use-command"
import { useInstallPrompt } from "./use-install-prompt"
import { ShareDialog } from "./share-dialog"
import { AppSwitcher } from "./app-switcher"
import type { SwitcherApp } from "./app-switcher"
import { askNova, scrapeDOMContext } from "./ask-nova"
import type { AskNovaContext } from "./ask-nova"
import type { AppShellProps } from "./app-shell-types"
import { SUITE_APPS, NOVA_PORT, currentSuiteApp } from "./suite-registry"

const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)

function ShellCommands({
  onAbout,
  onFeedback,
  onShare,
  onSwitchApp,
  shareEnabled,
  feedbackEnabled,
  canInstall,
  install,
}: {
  onAbout: () => void
  onFeedback: () => void
  onShare: () => void
  onSwitchApp: () => void
  shareEnabled: boolean
  feedbackEnabled: boolean
  canInstall: boolean
  install: () => void
}) {
  const { user, logout } = useAuth()

  useCommand("app-shell:sign-out", {
    label: "Sign Out",
    description: "Log out of the current account",
    group: "App",
    action: () => logout(),
    enabled: !!user,
  })

  useCommand("app-shell:about", {
    label: "About",
    description: "Show app version and details",
    group: "App",
    action: onAbout,
  })

  useCommand("app-shell:feedback", {
    label: "Report Feedback",
    description: "Report a problem or suggest an improvement",
    group: "App",
    action: onFeedback,
    enabled: feedbackEnabled,
  })

  useCommand("app-shell:command-palette", {
    label: "Command Palette",
    description: "Open this command palette",
    group: "App",
    shortcut: isMac ? "⌘K" : "Ctrl+K",
    action: openCommandPalette,
  })

  useCommand("app-shell:share", {
    label: "Share",
    description: "Show a shareable link and QR code for remote access",
    group: "App",
    keywords: ["qr", "link"],
    action: onShare,
    enabled: shareEnabled,
  })

  useCommand("app-shell:install", {
    label: "Install App",
    description: "Install as a desktop app (PWA)",
    group: "App",
    keywords: ["pwa", "download"],
    action: install,
    enabled: canInstall,
  })

  useCommand("app-shell:switch-app", {
    label: "Switch App…",
    description: "Open the Red Suite app switcher",
    group: "Apps",
    keywords: ["apps", "suite", "switcher"],
    action: onSwitchApp,
  })

  return null
}

function SuiteAppCommand({ app, enabled }: { app: (typeof SUITE_APPS)[number]; enabled: boolean }) {
  useCommand(`app-shell:open-${app.name.toLowerCase()}`, {
    label: `Open ${app.name}`,
    description: `${app.description} (port ${app.port})`,
    group: "Apps",
    keywords: ["switch", "app", app.name.toLowerCase()],
    action: () => {
      const hostname = window.location.hostname || "localhost"
      window.open(`${window.location.protocol}//${hostname}:${app.port}`, "_blank", "noopener,noreferrer")
    },
    enabled,
  })
  return null
}

function SuiteAppCommands() {
  const current = currentSuiteApp()
  return (
    <>
      {SUITE_APPS.map((app) => (
        <SuiteAppCommand key={app.port} app={app} enabled={app.port !== current?.port} />
      ))}
    </>
  )
}

function ProvidedAppCommand({ app }: { app: SwitcherApp }) {
  useCommand(`app-shell:open-${app.id}`, {
    label: `Open ${app.name}`,
    description: app.description,
    group: "Apps",
    keywords: ["switch", "app", app.name.toLowerCase()],
    action: () => app.onSelect?.(),
    enabled: !app.disabled && !app.active && !!app.onSelect,
  })
  return null
}

function ProvidedAppCommands({ apps }: { apps: SwitcherApp[] }) {
  return (
    <>
      {apps.map((app) => (
        <ProvidedAppCommand key={app.id} app={app} />
      ))}
    </>
  )
}

function AskNovaCommands({ appName }: { appName: string }) {
  const [modalContext, setModalContext] = useState<AskNovaContext | null>(null)
  const [capturingScreenshot, setCapturingScreenshot] = useState(false)
  const isNova = typeof window !== "undefined" && window.location.port === String(NOVA_PORT)

  const openModal = useCallback(() => {
    const domContext = scrapeDOMContext()
    setModalContext({
      app: appName,
      url: window.location.href,
      title: document.title,
      route: window.location.pathname + window.location.search,
      selection: window.getSelection()?.toString()?.trim() || undefined,
      extra: Object.keys(domContext).length > 0 ? domContext : undefined,
    })
    setCapturingScreenshot(true)

    setTimeout(() => {
      import("html-to-image")
        .then(({ toPng }) =>
          toPng(document.body, {
            pixelRatio: Math.min(1, 1280 / window.innerWidth),
            height: window.innerHeight,
            canvasHeight: window.innerHeight,
            filter: (node) => !(node instanceof HTMLElement && (node.hasAttribute("data-radix-portal") || node.hasAttribute("data-base-ui-portal"))),
          })
        )
        .then(dataUrl => {
          const base64 = dataUrl.split(",")[1]
          if (base64) {
            setModalContext(prev =>
              prev ? { ...prev, screenshot: { mediaType: "image/png", base64 } } : prev
            )
          }
        })
        .catch(() => {})
        .finally(() => setCapturingScreenshot(false))
    }, 500)
  }, [appName])

  useCommand("ask-nova", {
    label: "Ask Nova about this page",
    group: "AI",
    shortcut: "Ctrl+Shift+N",
    keywords: ["nova", "ai", "ask", "question", "help", "context"],
    action: openModal,
    enabled: !isNova,
  })

  useCommand("ask-nova-selection", {
    label: "Ask Nova about selection",
    group: "AI",
    keywords: ["nova", "ai", "selection", "highlight", "text"],
    action: openModal,
    enabled: !isNova,
  })

  return (
    <AskNovaModal
      context={modalContext}
      capturingScreenshot={capturingScreenshot}
      onClose={() => { setModalContext(null); setCapturingScreenshot(false) }}
    />
  )
}

function AskNovaModal({ context, capturingScreenshot, onClose }: { context: AskNovaContext | null; capturingScreenshot?: boolean; onClose: () => void }) {
  const [question, setQuestion] = useState("")
  const [sending, setSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const isOpen = !!context
  useEffect(() => {
    if (isOpen) {
      setQuestion("")
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
  }, [isOpen])

  const handleSubmit = useCallback(async () => {
    if (!context || !question.trim() || sending) return
    setSending(true)
    await askNova({ ...context, question: question.trim() })
    setSending(false)
    onClose()
  }, [context, question, sending, onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }, [handleSubmit])

  const breadcrumbs = context?.extra?.breadcrumbs as string | undefined
  const displayUrl = context?.route || context?.url || ""

  return (
    <Dialog open={!!context} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent showCloseButton={false} className="sm:max-w-lg p-0 gap-0">
        <DialogHeader className="px-4 py-3 border-b border-border-subtle">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-pink-500-a10">
              <i className="fa-solid fa-star text-sm text-pink-400" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-sm">Ask Nova</DialogTitle>
              <p className="text-[10px] text-text-muted font-mono truncate">{breadcrumbs || displayUrl}</p>
            </div>
          </div>
        </DialogHeader>

        <div className="p-3" style={{ display: "flex", gap: "0.5rem", alignItems: "stretch" }}>
          {context?.screenshot ? (
            <img
              src={`data:${context.screenshot.mediaType};base64,${context.screenshot.base64}`}
              alt=""
              className="rounded-lg object-cover object-top"
              style={{ width: "5rem", alignSelf: "stretch" }}
            />
          ) : capturingScreenshot ? (
            <div className="rounded-lg bg-overlay-10 animate-pulse" style={{ width: "5rem", alignSelf: "stretch" }} />
          ) : null}
          <div className="flex-1 flex flex-col rounded-lg bg-overlay-6 shadow-md">
            <textarea
              ref={textareaRef}
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="What would you like to know?"
              rows={2}
              className="w-full flex-1 resize-none bg-transparent px-3 py-2 text-sm font-serif placeholder:text-text-muted focus:outline-none"
              style={{ minHeight: "4.5rem" }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", flexShrink: 0 }}>
            <button
              onClick={handleSubmit}
              disabled={!question.trim() || sending}
              className="rounded-md bg-overlay-10 hover:bg-overlay-15 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
              style={{ width: "2.75rem", flex: "1 1 0" }}
            >
              <i className={`fa-solid ${sending ? "fa-spinner fa-spin" : "fa-paper-plane"} text-sm`} />
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AppShellInner({
  config,
  headerContent,
  breadcrumb,
  menuItems,
  children,
  className,
  switcherApps,
  activeApp,
  appSwitcherStyle,
}: AppShellProps) {
  const { user, logout } = useAuth()
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [appMenuOpen, setAppMenuOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const { toast, update } = useToast()
  const { canInstall, install } = useInstallPrompt()

  const shareUrl = config.share?.url()
  const dropdownSwitcher = appSwitcherStyle === "dropdown"

  const brand = activeApp
    ? {
        icon: activeApp.icon,
        nameParts: activeApp.nameParts ?? ([activeApp.name, ""] as [string, string]),
        color: activeApp.color,
      }
    : config.brand

  const openSwitcher = useCallback(
    () => (dropdownSwitcher ? setAppMenuOpen(true) : setSwitcherOpen(true)),
    [dropdownSwitcher],
  )
  const openAbout = useCallback(() => setAboutOpen(true), [])
  const openFeedback = useCallback(() => setFeedbackOpen(true), [])
  const openShare = useCallback(() => setShareOpen(true), [])

  const feedbackHandler = config.onFeedbackSubmit ?? submitFeedbackViaSession

  const captureScreenshot = useCallback(async (): Promise<string | undefined> => {
    try {
      const { toPng } = await import("html-to-image")
      const dataUrl = await toPng(document.body, {
        pixelRatio: Math.min(1, 1280 / window.innerWidth),
        height: window.innerHeight,
        canvasHeight: window.innerHeight,
        filter: (node) => !(node instanceof HTMLElement && (node.hasAttribute("data-radix-portal") || node.hasAttribute("data-base-ui-portal"))),
      })
      return dataUrl.split(",")[1]
    } catch {
      return undefined
    }
  }, [])

  const handleFeedbackSubmit = useCallback(
    (submission: FeedbackSubmission) => {
      const id = toast({ title: "Sending feedback...", variant: "loading" })

      feedbackHandler(submission)
        .then((result) => {
          update(id, {
            title: "Feedback sent",
            description: result.title,
            variant: "success",
            action: result.issueUrl
              ? { label: "View", onClick: () => window.open(result.issueUrl, "_blank") }
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
    [feedbackHandler, toast, update],
  )

  return (
    <>
      <div
        data-slot="app-shell"
        className={className ?? "flex h-full w-full flex-col"}
      >
        <AppHeader
          brand={brand}
          brandSlot={
            dropdownSwitcher ? (
              <AppMenu apps={switcherApps ?? []} open={appMenuOpen} onOpenChange={setAppMenuOpen}>
                <AppHeaderBrand {...brand} caret />
              </AppMenu>
            ) : undefined
          }
          breadcrumb={breadcrumb}
          onBrandClick={dropdownSwitcher ? undefined : openSwitcher}
        >
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
                <DropdownMenuItem onClick={openFeedback}>
                  <i className="fa-solid fa-bug size-4 text-center" />
                  Report Feedback
                </DropdownMenuItem>
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

      <AppSwitcher open={switcherOpen} onOpenChange={setSwitcherOpen} apps={switcherApps} />

      <ShellCommands
        onAbout={openAbout}
        onFeedback={openFeedback}
        onShare={openShare}
        onSwitchApp={openSwitcher}
        shareEnabled={!!shareUrl}
        feedbackEnabled={true}
        canInstall={canInstall}
        install={install}
      />
      {switcherApps ? <ProvidedAppCommands apps={switcherApps} /> : <SuiteAppCommands />}
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

      <FeedbackDialog
        app={{ name: config.name, version: config.version }}
        customMetadata={config.feedbackMetadata}
        captureScreenshot={captureScreenshot}
        onSubmit={handleFeedbackSubmit}
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
      />

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
