export type { Command, CommandPaletteProps } from "./types"
export type { CommandProviderProps } from "./command-provider"
export type {
  AppShellConfig,
  AppShellBrand,
  AppShellShare,
  AppShellProps,
} from "./app-shell-types"
export type { ShareDialogProps } from "./share-dialog"

export { CommandProvider, useCommandStore, useCommandList } from "./command-provider"
export { useCommand } from "./use-command"
export { CommandPalette, openCommandPalette } from "./command-palette"
export { AppShell } from "./app-shell"
export { ShareDialog } from "./share-dialog"
export { useInstallPrompt } from "./use-install-prompt"

export { AboutDialog } from "./about-dialog"
export type { AboutApp, AboutDialogProps } from "./about-dialog"

export {
  FeedbackDialog,
  FeedbackButton,
  collectSystemInfo,
} from "./feedback-dialog"
export type {
  FeedbackCategory,
  FeedbackSubmission,
  FeedbackResult,
  SystemInfo,
  FeedbackDialogProps,
  FeedbackButtonProps,
} from "./feedback-dialog"

export { AppHeader, AppHeaderBrand } from "./app-header"
export type { AppHeaderProps, AppHeaderBrandProps } from "./app-header"

export { JsonHighlight } from "./json-highlight"

export { createLocalStore, useLocalStore } from "./local-store"
export type { LocalStore } from "./local-store"

export { createRemoteConnection, applyConnectionParams } from "./remote-connection"
export type { ConnectionConfig, RemoteConnectionStore } from "./remote-connection"

export { ConnectPrompt } from "./connect-prompt"
export type { ConnectPromptProps } from "./connect-prompt"

export { RemoteAccessProvider, useRemoteAccess } from "./remote-access-provider"
export type { RemoteAccessStatus, RemoteAccessContextValue } from "./remote-access-provider"

export { useServiceDiscovery } from "./use-service-discovery"
export type { ServiceManifest, CapabilityInfo, EndpointInfo } from "./use-service-discovery"
