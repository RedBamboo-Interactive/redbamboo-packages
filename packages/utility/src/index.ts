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
export { AppSwitcher } from "./app-switcher"
export type { AppSwitcherProps, SwitcherApp, SwitcherAppStatus } from "./app-switcher"
export { AppMenu } from "./app-menu"
export type { AppMenuProps } from "./app-menu"

export type {
  LeafAppPlugin,
  LeafPluginCommand,
  LeafPluginCommandContext,
  LeafPluginSettingsPanel,
} from "./leaf-plugin"
export { ShareDialog } from "./share-dialog"
export { useInstallPrompt } from "./use-install-prompt"

export { AboutDialog } from "./about-dialog"
export type { AboutApp, AboutDialogProps } from "./about-dialog"

export {
  FeedbackDialog,
  collectSystemInfo,
} from "./feedback-dialog"
export type {
  FeedbackCategory,
  FeedbackContext,
  FeedbackSubmission,
  FeedbackResult,
  SystemInfo,
  FeedbackDialogProps,
} from "./feedback-dialog"

export { submitFeedbackViaSession } from "./submit-feedback"

export { AppHeader, AppHeaderBrand } from "./app-header"
export type { AppHeaderProps, AppHeaderBrandProps } from "./app-header"

export { JsonHighlight } from "./json-highlight"

export { createLocalStore, useLocalStore } from "./local-store"
export type { LocalStore } from "./local-store"

export { createRemoteConnection, applyConnectionParams, autoConnect } from "./remote-connection"
export type { ConnectionConfig, RemoteConnectionStore } from "./remote-connection"

export { ConnectPrompt } from "./connect-prompt"
export type { ConnectPromptProps } from "./connect-prompt"

export { RemoteAccessProvider, useRemoteAccess } from "./remote-access-provider"
export type { RemoteAccessStatus, RemoteAccessContextValue } from "./remote-access-provider"

export { AuthProvider, useAuth } from "./auth-provider"
export type { AuthUser, AuthContextValue } from "./auth-types"

export { useServiceDiscovery } from "./use-service-discovery"
export type { ServiceManifest, CapabilityInfo, EndpointInfo, ParameterInfo, ProxyInfo } from "./use-service-discovery"

export { SUITE_APPS, SUITE_PORTS, NOVA_PORT, getSuiteApp, currentSuiteApp } from "./suite-registry"
export type { SuiteApp } from "./suite-registry"

export { apiFetch, ApiFetchError } from "./api-fetch"
export type { ApiFetchOptions, ApiErrorBody } from "./api-fetch"

export { TunnelSettingsPanel } from "./tunnel-settings-panel"
export type { TunnelSettingsPanelProps, TunnelStatus } from "./tunnel-settings-panel"

export { createMediaStore, useMediaQuery } from "./media-store"
export type { MediaStore } from "./media-store"

export type {
  LogLevel,
  LogEntry,
  LogFilter,
  LogsResponse,
  LogSummaryResponse,
  LogStreamEvent,
} from "./log-types"
export { LOG_LEVELS, LOG_LEVEL_SEVERITY, LOG_LEVEL_COLORS } from "./log-types"

export { useLogStream } from "./use-log-stream"
export type { UseLogStreamOptions, UseLogStreamReturn } from "./use-log-stream"

export { LogPanel } from "./log-panel"
export type { LogPanelProps } from "./log-panel"

export { createWebSocket } from "./create-websocket"
export type {
  WsEvent,
  CreateWebSocketOptions,
  WebSocketHandle,
} from "./create-websocket"

export { WsEventContext, useWsSubscribe, useWsSubscribeByType } from "./ws-events"
export type { WsEventContextValue } from "./ws-events"

export { WsEventProvider } from "./ws-event-provider"
export type { WsEventProviderProps } from "./ws-event-provider"

export { useLayoutPersistence } from "./use-layout-persistence"
export type { UseLayoutPersistenceReturn } from "./use-layout-persistence"

export { buildBreadcrumbs, useBreadcrumbLabelsContext, usePluginBreadcrumbs } from "./use-breadcrumbs"
export type { RouteHandle, RouteMatch, PluginRoute } from "./use-breadcrumbs"

export { BreadcrumbLabelProvider, useBreadcrumbLabel, useBreadcrumbLabels } from "./breadcrumb-labels"
export type { PluginCrumb } from "./breadcrumb-labels"

export { useNavigateUp } from "./use-navigate-up"
export type { NavigateUpOptions } from "./use-navigate-up"

export {
  askNova,
  formatContextMessage,
  parseContextHash,
  scrapeDOMContext,
  useAskNova,
  useAskNovaCommand,
  useAskNovaReceiver,
  usePendingNovaContext,
} from "./ask-nova"
export type {
  AskNovaImageAttachment,
  AskNovaContext,
  AskNovaOptions,
  PendingNovaContext,
  UseAskNovaOptions,
  UseAskNovaReturn,
  UseAskNovaCommandOptions,
  UseAskNovaReceiverOptions,
} from "./ask-nova"
