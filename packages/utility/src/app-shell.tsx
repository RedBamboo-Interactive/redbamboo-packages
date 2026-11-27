import { useState, useCallback, useEffect } from "react"
import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  Toaster,
} from "@redbamboo/ui"
import { AuthProvider, useAuth } from "./auth-provider"
import { AppHeader, AppHeaderBrand } from "./app-header"
import { AppMenu } from "./app-menu"
import { AboutDialog } from "./about-dialog"
import { CommandProvider } from "./command-provider"
import { CommandPalette, openCommandPalette } from "./command-palette"
import { useCommand } from "./use-command"
import { useInstallPrompt } from "./use-install-prompt"
import { ShareDialog } from "./share-dialog"
import { AppSwitcher } from "./app-switcher"
import type { SwitcherApp } from "./app-switcher"
import type { AppShellLink, AppShellProps } from "./app-shell-types"
import { SUITE_APPS, currentSuiteApp } from "./suite-registry"
import { reloadApp } from "./reload-app"

const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)

function ShellCommands({
  onAbout,
  onShare,
  onSwitchApp,
  shareEnabled,
  canInstall,
  install,
  switchAppEnabled,
}: {
  onAbout: () => void
  onShare: () => void
  onSwitchApp: () => void
  shareEnabled: boolean
  canInstall: boolean
  install: () => void
  switchAppEnabled: boolean
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

  useCommand("app-shell:command-palette", {
    label: "Command Palette",
    description: "Open this command palette",
    group: "App",
    shortcut: isMac ? "⌘K" : "Ctrl+K",
    action: openCommandPalette,
  })

  useCommand("app-shell:reload", {
    label: "Reload App",
    description: "Reload the app and fetch current frontend assets",
    group: "App",
    keywords: ["reload", "refresh", "update", "pwa"],
    action: reloadApp,
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
    enabled: switchAppEnabled,
  })

  return null
}

function openExternalLink(url: string) {
  window.open(url, "_blank", "noopener,noreferrer")
}

function LinkCommand({ link }: { link: AppShellLink }) {
  useCommand(`app-shell:link-${link.id}`, {
    label: `Open ${link.label}`,
    description: link.description ?? `Open ${link.label} in a new tab`,
    group: "Help",
    keywords: ["help", "docs", "guide", link.label.toLowerCase()],
    action: () => openExternalLink(link.url),
  })
  return null
}

function SuiteAppCommand({ app, enabled }: { app: (typeof SUITE_APPS)[number]; enabled: boolean }) {
  useCommand(`app-shell:open-${app.name.toLowerCase()}`, {
    label: `Open ${app.name}`,
    description: `${app.description} (port ${app.port})`,
    source: { id: app.name.toLowerCase(), label: app.name, icon: app.icon, color: app.color },
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
    description: app.description
      ? `Open ${app.name}. ${app.description}`
      : `Open the ${app.name} app.`,
    source: { id: app.id, label: app.name, icon: app.icon, color: app.color },
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

function AppShellInner({
  config,
  headerContent,
  breadcrumb,
  headerActions,
  menuItems,
  children,
  className,
  switcherApps,
  activeApp,
  appSwitcherStyle,
  onReorder,
  aboutBanner,
}: AppShellProps) {
  const { user } = useAuth()
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [appMenuOpen, setAppMenuOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const { canInstall, install } = useInstallPrompt()

  // The active app owns interaction colour across the whole document. Menus,
  // dialogs and toasts are portalled under <body>, so scoping --brand to the
  // app's content subtree would leave those controls on the host's accent.
  useEffect(() => {
    const appColor = activeApp?.color
    if (!appColor) return

    const root = document.documentElement
    const previousValue = root.style.getPropertyValue("--brand")
    const previousPriority = root.style.getPropertyPriority("--brand")
    root.style.setProperty("--brand", appColor)

    return () => {
      if (previousValue) root.style.setProperty("--brand", previousValue, previousPriority)
      else root.style.removeProperty("--brand")
    }
  }, [activeApp?.color])

  const shareUrl = config.share?.url()
  const dropdownSwitcher = appSwitcherStyle === "dropdown"
  const appSwitcherEnabled = switcherApps === undefined || switcherApps.length > 0

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
  const openShare = useCallback(() => setShareOpen(true), [])

  return (
    <>
      <div
        data-slot="app-shell"
        data-active-app-id={activeApp?.id}
        data-active-app-name={activeApp?.name ?? config.name}
        className={className ?? "flex h-full w-full flex-col"}
      >
        <AppHeader
          brand={brand}
          brandSlot={
            appSwitcherEnabled && dropdownSwitcher ? (
              <AppMenu apps={switcherApps ?? []} open={appMenuOpen} onOpenChange={setAppMenuOpen} onReorder={onReorder}>
                <AppHeaderBrand {...brand} caret />
              </AppMenu>
            ) : undefined
          }
          breadcrumb={breadcrumb}
          navigation={headerContent}
          onBrandClick={appSwitcherEnabled && !dropdownSwitcher ? openSwitcher : undefined}
        >
          {headerActions}
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
              <i className="ph-bold ph-list" />
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
                    <i className="ph-bold ph-qr-code size-4 text-center" />
                    Share
                  </DropdownMenuItem>
                )}
                {canInstall && (
                  <DropdownMenuItem onClick={install}>
                    <i className="ph-bold ph-download size-4 text-center" />
                    Install
                  </DropdownMenuItem>
                )}
                {config.links?.map((link) => (
                  <DropdownMenuItem key={link.id} onClick={() => openExternalLink(link.url)}>
                    <i className={`${link.icon ?? "ph-bold ph-link"} size-4 text-center`} />
                    {link.label}
                    <DropdownMenuShortcut>
                      <i className="ph-bold ph-arrow-square-out" aria-label="Opens in a new tab" />
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem onClick={openCommandPalette}>
                  <i className="ph-bold ph-terminal size-4 text-center" />
                  Command Palette
                  <DropdownMenuShortcut>
                    {isMac ? "⌘K" : "Ctrl+K"}
                  </DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={reloadApp}>
                  <i className="ph-bold ph-arrow-clockwise size-4 text-center" />
                  Reload App
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={openAbout}>
                  <i className="ph-bold ph-info size-4 text-center" />
                  About {config.name}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              {user && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => window.dispatchEvent(new CustomEvent("open-settings", { detail: { section: "account" } }))}
                    className="!p-0"
                  >
                    <div className="flex items-center gap-3 px-3 py-2 w-full">
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
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </AppHeader>

        {children}
      </div>

      {appSwitcherEnabled && (
        <AppSwitcher open={switcherOpen} onOpenChange={setSwitcherOpen} apps={switcherApps} />
      )}

      <ShellCommands
        onAbout={openAbout}
        onShare={openShare}
        onSwitchApp={openSwitcher}
        shareEnabled={!!shareUrl}
        canInstall={canInstall}
        install={install}
        switchAppEnabled={appSwitcherEnabled}
      />
      {config.links?.map((link) => <LinkCommand key={link.id} link={link} />)}
      {switcherApps ? <ProvidedAppCommands apps={switcherApps} /> : <SuiteAppCommands />}
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
        discordInvite={config.discordInvite}
        latestVersion={config.latestVersion}
        open={aboutOpen}
        onOpenChange={setAboutOpen}
        banner={aboutBanner}
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
  const commandSource = {
    id: props.config.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    label: props.config.name,
    icon: props.config.icon,
  }

  return (
    <AuthProvider>
      <CommandProvider source={commandSource}>
        <AppShellInner {...props} />
        {/* The page's only toast stack; toast() and useToast() feed it from anywhere. */}
        <Toaster />
      </CommandProvider>
    </AuthProvider>
  )
}

export { AppShell }
