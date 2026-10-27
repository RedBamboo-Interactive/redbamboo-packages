import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  AudioPlayer,
  Button,
  EntityCard,
  MediaViewer,
  ScrollArea,
  Tabs,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
  useEntityCardPresentation,
  type MediaViewerItem,
} from "@redbamboo/ui"
import { getEntityHref } from "@redbamboo/utility/entity-links"
import type { ArtifactsState } from "../hooks/use-artifacts"
import {
  ARTIFACT_TABS,
  ARTIFACT_TAB_LABELS,
  artifactDisplayName,
  artifactLinkDomain,
  artifactLinkHref,
  artifactLinkTitle,
  artifactOriginLabel,
  artifactThumbnailSrc,
  defaultResolveArtifactTarget,
  documentIcon,
  formatByteSize,
  formatRelativeTime,
  groupArtifacts,
  visibleArtifacts,
  type Artifact,
  type ArtifactOrigin,
  type ArtifactTab,
} from "../lib/artifacts"
import { resolveEntityEmbedCardView } from "../lib/entity-embed"
import { resolveChatMediaSrc } from "../lib/media-url"
import { useVideoPoster } from "../lib/use-video-poster"

type FileLinkResolver = (filePath: string, opts?: { line?: number }) => (() => void) | undefined

export interface ArtifactsPanelProps {
  /** From `useArtifacts`: the list and its load state. */
  state: Pick<ArtifactsState, "items" | "status" | "error">
  /** Retry after a failed load. Defaults to nothing; pass `state.reload`. */
  onRetry?: () => void
  /** Origins to leave out. An artifact is hidden only when its emitted origin is hidden. */
  hiddenOrigins?: readonly ArtifactOrigin[]
  /**
   * The URL the browser must use for an artifact's target (Nova and Code map
   * `/ai-session/...` targets differently), or null when it cannot be opened.
   * Default: http(s) and relative `/api/...` targets as they are, otherwise null.
   */
  resolveTarget?: (artifact: Artifact) => string | null
  /** Same resolver `ChatPanel` takes: maps an image/media src (for example a local path) to a servable URL. */
  resolveImageSrc?: (src: string) => string | undefined
  /** Same resolver `ChatPanel` takes: returns the action that opens a repository file. */
  resolveFileLink?: FileLinkResolver
  /** Scroll the chat to the message an artifact came from. Hidden when omitted. */
  onJumpToMessage?: (messageUid: string) => void
  className?: string
}

const NO_HIDDEN_ORIGINS: readonly ArtifactOrigin[] = []

const TAB_ICONS: Record<ArtifactTab, string> = {
  media: "ph-images",
  documents: "ph-files",
  links: "ph-link",
  entities: "ph-cube",
}

/** The message an artifact most recently appeared in. */
function jumpTarget(artifact: Artifact): string | null {
  return artifact.last.messageUid ?? artifact.first.messageUid ?? null
}

function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/** True once the element has come within `margin` of the viewport; stays true after. */
function useInView<T extends Element>(margin = "240px"): [(node: T | null) => void, boolean] {
  const [inView, setInView] = useState(false)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const ref = useCallback((node: T | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!node) return
    if (typeof IntersectionObserver === "undefined") { setInView(true); return }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setInView(true); observer.disconnect() }
    }, { rootMargin: margin })
    observer.observe(node)
    observerRef.current = observer
  }, [margin])
  useEffect(() => () => observerRef.current?.disconnect(), [])
  return [ref, inView]
}

interface ArtifactActions {
  now: number
  resolveTarget: (artifact: Artifact) => string | null
  resolveImageSrc?: (src: string) => string | undefined
  resolveFileLink?: FileLinkResolver
  onJump?: (messageUid: string) => void
  onOpenMedia: (artifact: Artifact) => void
}

function mediaSrc(artifact: Artifact, actions: ArtifactActions): string | null {
  const resolved = actions.resolveTarget(artifact)
  if (resolved) return resolveChatMediaSrc(resolved, actions.resolveImageSrc) ?? null
  // A local path the host can serve through its own image resolver (Code).
  const local = artifact.file?.path
  const viaHost = local ? actions.resolveImageSrc?.(local) : undefined
  return viaHost ? resolveChatMediaSrc(viaHost) ?? null : null
}

function GoToMessageButton({ artifact, onJump, className }: { artifact: Artifact; onJump?: (messageUid: string) => void; className?: string }) {
  const uid = jumpTarget(artifact)
  if (!onJump) return null
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            data-slot="artifact-go-to-message"
            aria-label={`Go to message for ${artifactDisplayName(artifact)}`}
            disabled={!uid}
            onClick={() => { if (uid) onJump(uid) }}
            className={cn("text-text-muted hover:text-contrast", className)}
          />
        }
      >
        <i className="ph-bold ph-arrow-bend-up-left" aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent>Go to message</TooltipContent>
    </Tooltip>
  )
}

/** Visibility of a tile's overlay action: always on touch, on hover or focus with a mouse. */
const TILE_ACTION_CLASS = "absolute right-1 top-1 z-10 rounded-full bg-background/80 shadow-sm backdrop-blur-sm [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/tile:opacity-100 [@media(hover:hover)]:group-focus-within/tile:opacity-100"

function UnavailableTile({ label }: { label?: string }) {
  return (
    <div
      data-slot="artifact-unavailable"
      className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-overlay-6 px-1 text-center text-text-muted"
    >
      <i className="ph-bold ph-image-broken text-lg" aria-hidden="true" />
      <span className="text-[10px] leading-tight">{label ?? "Unavailable"}</span>
    </div>
  )
}

const ImageTile = memo(function ImageTile({ artifact, actions }: { artifact: Artifact; actions: ArtifactActions }) {
  const thumb = artifactThumbnailSrc(artifact)
  const full = mediaSrc(artifact, actions)
  // Asset thumbnail first, then the full image, then a muted tile; never a broken-image glyph.
  const sources = useMemo(() => [thumb ? resolveChatMediaSrc(thumb) : null, full].filter((src, index, all): src is string => !!src && all.indexOf(src) === index), [thumb, full])
  const [attempt, setAttempt] = useState(0)
  const src = sources[attempt]
  const name = artifactDisplayName(artifact)

  return (
    <div
      data-slot="artifact-tile"
      data-kind="image"
      data-artifact-key={artifact.key}
      className="group/tile relative aspect-square overflow-hidden rounded-lg border border-overlay-10 bg-overlay-6"
    >
      {src ? (
        <button
          type="button"
          onClick={() => actions.onOpenMedia(artifact)}
          aria-label={`Open image ${name}`}
          className="absolute inset-0 cursor-zoom-in outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <img
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setAttempt(current => current + 1)}
            className="size-full object-cover"
          />
        </button>
      ) : (
        <UnavailableTile />
      )}
      <GoToMessageButton artifact={artifact} onJump={actions.onJump} className={TILE_ACTION_CLASS} />
    </div>
  )
})

const VideoTile = memo(function VideoTile({ artifact, actions }: { artifact: Artifact; actions: ArtifactActions }) {
  const src = mediaSrc(artifact, actions)
  const [ref, inView] = useInView<HTMLDivElement>()
  const poster = useVideoPoster(src ?? undefined, 256, inView)
  const name = artifactDisplayName(artifact)

  return (
    <div
      ref={ref}
      data-slot="artifact-tile"
      data-kind="video"
      data-artifact-key={artifact.key}
      className="group/tile relative aspect-square overflow-hidden rounded-lg border border-overlay-10 bg-overlay-6"
    >
      {src ? (
        <button
          type="button"
          onClick={() => actions.onOpenMedia(artifact)}
          aria-label={`Play video ${name}`}
          className="absolute inset-0 cursor-pointer outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
        >
          {poster && <img src={poster} alt="" className="size-full object-cover" />}
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex size-8 items-center justify-center rounded-full bg-background/70 text-contrast shadow-sm backdrop-blur-sm">
              <i className="ph-bold ph-play" aria-hidden="true" />
            </span>
          </span>
        </button>
      ) : (
        <UnavailableTile />
      )}
      <GoToMessageButton artifact={artifact} onJump={actions.onJump} className={TILE_ACTION_CLASS} />
    </div>
  )
})

function MetaLine({ artifact, now }: { artifact: Artifact; now: number }) {
  const parts = [artifactOriginLabel(artifact.origin), formatRelativeTime(artifact.last.timestamp, now)].filter(Boolean)
  return <>{parts.join(" · ")}</>
}

const AudioRow = memo(function AudioRow({ artifact, actions }: { artifact: Artifact; actions: ArtifactActions }) {
  const src = actions.resolveTarget(artifact)
  const [ref, inView] = useInView<HTMLDivElement>()
  const name = artifact.origin === "voice" ? artifact.title?.trim() || "Voice message" : artifactDisplayName(artifact)

  return (
    <div
      ref={ref}
      data-slot="artifact-row"
      data-kind="audio"
      data-artifact-key={artifact.key}
      className="rounded-lg border border-overlay-10 bg-overlay-4 p-2"
    >
      <div className="flex items-center gap-2">
        <i className="ph-bold ph-waveform shrink-0 text-text-muted" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-contrast">{name}</div>
          <div className="truncate text-[11px] text-text-muted"><MetaLine artifact={artifact} now={actions.now} /></div>
        </div>
        <GoToMessageButton artifact={artifact} onJump={actions.onJump} />
      </div>
      <div className="mt-1.5 min-h-[3.25rem]">
        {src ? (inView ? <AudioPlayer src={src} /> : null) : (
          <div className="flex items-center gap-1.5 text-[11px] text-text-muted"><i className="ph-bold ph-warning" aria-hidden="true" />Unavailable</div>
        )}
      </div>
    </div>
  )
})

function RowShell({ artifact, onJump, children, kind, className }: {
  artifact: Artifact
  onJump?: (messageUid: string) => void
  children: ReactNode
  kind: string
  className?: string
}) {
  return (
    <li
      data-slot="artifact-row"
      data-kind={kind}
      data-artifact-key={artifact.key}
      className={cn("group/row flex items-center gap-1 rounded-lg border border-transparent pr-1 transition-colors hover:border-overlay-10 hover:bg-overlay-4", className)}
    >
      {children}
      <GoToMessageButton artifact={artifact} onJump={onJump} />
    </li>
  )
}

const ROW_MAIN_CLASS = "flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
const ICON_BOX_CLASS = "flex size-8 shrink-0 items-center justify-center rounded-md border border-overlay-10 bg-overlay-4 text-text-muted"

const DocumentRow = memo(function DocumentRow({ artifact, actions }: { artifact: Artifact; actions: ArtifactActions }) {
  const name = artifactDisplayName(artifact)
  const fileAction = artifact.file ? actions.resolveFileLink?.(artifact.file.path, artifact.file.line ? { line: artifact.file.line } : undefined) : undefined
  const href = fileAction ? null : actions.resolveTarget(artifact)
  const size = formatByteSize(artifact.size)
  const body = (
    <>
      <span className={ICON_BOX_CLASS}><i className={cn("ph-bold", documentIcon(artifact), "text-base")} aria-hidden="true" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-contrast">{name}</span>
        <span className="block truncate text-[11px] text-text-muted">
          <MetaLine artifact={artifact} now={actions.now} />{size ? ` · ${size}` : ""}
        </span>
      </span>
    </>
  )

  return (
    <RowShell artifact={artifact} onJump={actions.onJump} kind="document">
      {fileAction ? (
        <button type="button" onClick={fileAction} title={artifact.file?.path} aria-label={`Open ${name}`} className={cn(ROW_MAIN_CLASS, "cursor-pointer")}>{body}</button>
      ) : href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`Open ${name} in a new tab`} className={cn(ROW_MAIN_CLASS, "no-underline")}>{body}</a>
      ) : (
        <div aria-disabled="true" title="Unavailable" className={cn(ROW_MAIN_CLASS, "opacity-60")}>{body}</div>
      )}
    </RowShell>
  )
})

const LinkRow = memo(function LinkRow({ artifact, actions }: { artifact: Artifact; actions: ArtifactActions }) {
  const internal = artifact.internal === true
  const href = artifactLinkHref(artifact, actions.resolveTarget)
  const title = artifactLinkTitle(artifact)
  const domain = artifactLinkDomain(artifact)
  const body = (
    <>
      <span className={ICON_BOX_CLASS}>
        <i className={cn("ph-bold", internal ? "ph-leaf" : "ph-globe", "text-base")} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-contrast">{title}</span>
        <span className="block truncate text-[11px] text-text-muted">
          {domain}{" · "}{formatRelativeTime(artifact.last.timestamp, actions.now)}
        </span>
      </span>
    </>
  )

  return (
    <RowShell artifact={artifact} onJump={actions.onJump} kind={internal ? "internal-link" : "link"}>
      {href ? (
        internal ? (
          <a href={href} data-slot="internal-leaf-link" aria-label={`Open ${title}`} className={cn(ROW_MAIN_CLASS, "no-underline")}>{body}</a>
        ) : (
          <a href={href} data-slot="external-web-link" target="_blank" rel="noopener noreferrer" aria-label={`Open ${title} in a new tab`} className={cn(ROW_MAIN_CLASS, "no-underline")}>{body}</a>
        )
      ) : (
        <div aria-disabled="true" title="Unavailable" className={cn(ROW_MAIN_CLASS, "opacity-60")}>{body}</div>
      )}
    </RowShell>
  )
})

const EntityTile = memo(function EntityTile({ artifact, actions }: { artifact: Artifact; actions: ArtifactActions }) {
  const ref = artifact.entity
  const requested = useMemo(() => ({
    id: ref?.id ?? "",
    typeSlug: ref?.typeSlug ?? "",
    name: artifact.title?.trim() || ref?.id || artifact.target,
  }), [artifact.target, artifact.title, ref?.id, ref?.typeSlug])
  const presentation = useEntityCardPresentation(requested)
  if (!ref) return null
  const href = getEntityHref(ref.typeSlug, ref.id)
  const view = resolveEntityEmbedCardView({ ...requested, href }, presentation)

  return (
    <li data-slot="artifact-row" data-kind="entity" data-artifact-key={artifact.key} className="min-w-0">
      <EntityCard
        entity={view.entity}
        visual={view.visual}
        subtitle={view.subtitle}
        size="sm"
        variant="outlined"
        width="full"
        action={{ kind: "inspect", href, ariaLabel: `Inspect ${view.entity.name}` }}
        actions={<GoToMessageButton artifact={artifact} onJump={actions.onJump} />}
      />
    </li>
  )
})

function Notice({ icon, children, action, role, tone }: { icon: string; children: ReactNode; action?: ReactNode; role?: "status" | "alert"; tone?: "muted" | "error" }) {
  return (
    <div
      role={role}
      data-slot="artifacts-notice"
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-6 py-10 text-center text-sm",
        tone === "error" ? "text-destructive" : "text-text-muted",
      )}
    >
      <i className={cn("ph-bold", icon, "text-2xl opacity-70")} aria-hidden="true" />
      <p className="max-w-[16rem]">{children}</p>
      {action}
    </div>
  )
}

function ViewerJumpButton({ artifact, onJump }: { artifact: Artifact; onJump: (messageUid: string) => void }) {
  const uid = jumpTarget(artifact)
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={!uid}
      onClick={() => { if (uid) onJump(uid) }}
      className="text-text-muted hover:bg-overlay-10 hover:text-contrast"
    >
      <i className="ph-bold ph-arrow-bend-up-left" aria-hidden="true" />
      Go to message
    </Button>
  )
}

function ViewerDetails({ artifact, now, onJump }: { artifact: Artifact; now: number; onJump?: (messageUid: string) => void }) {
  const uid = jumpTarget(artifact)
  return (
    <div data-slot="artifact-viewer-details" className="flex flex-col gap-3 p-4">
      <div className="min-w-0">
        <h3 className="break-words text-sm font-medium text-contrast">{artifactDisplayName(artifact)}</h3>
        <p className="mt-0.5 text-xs text-text-muted"><MetaLine artifact={artifact} now={now} /></p>
      </div>
      {onJump && (
        <Button type="button" variant="outline" size="sm" disabled={!uid} onClick={() => { if (uid) onJump(uid) }} className="self-start">
          <i className="ph-bold ph-arrow-bend-up-left" aria-hidden="true" />
          Go to message
        </Button>
      )}
    </div>
  )
}

/**
 * Everything a conversation has produced or shared: media, documents, links
 * and entity references. Renders content only; the host decides whether it
 * sits in a dock panel or a full-height sheet.
 */
export function ArtifactsPanel({
  state,
  onRetry,
  hiddenOrigins = NO_HIDDEN_ORIGINS,
  resolveTarget = defaultResolveArtifactTarget,
  resolveImageSrc,
  resolveFileLink,
  onJumpToMessage,
  className,
}: ArtifactsPanelProps) {
  const { items, status, error } = state
  const now = useNow()
  const visible = useMemo(() => visibleArtifacts(items, hiddenOrigins), [items, hiddenOrigins])
  const groups = useMemo(() => groupArtifacts(visible), [visible])
  const tabs = ARTIFACT_TABS.filter(tab => groups[tab].length > 0)
  const [selected, setSelected] = useState<ArtifactTab>("media")
  const tab = tabs.includes(selected) ? selected : tabs[0]

  // Images and videos, in panel order, are what the viewer pages through.
  const viewable = useMemo(() => groups.media.filter(item => item.kind === "image" || item.kind === "video"), [groups.media])
  const [viewerKey, setViewerKey] = useState<string | null>(null)
  const viewerItems = useMemo(() => viewable.flatMap<MediaViewerItem & { artifact: Artifact }>(artifact => {
    const src = (() => {
      const resolved = resolveTarget(artifact)
      if (resolved) return resolveChatMediaSrc(resolved, resolveImageSrc)
      const local = artifact.file?.path
      return local ? resolveImageSrc?.(local) : undefined
    })()
    if (!src) return []
    const thumb = artifactThumbnailSrc(artifact)
    return [{
      id: artifact.key,
      src,
      type: artifact.kind === "video" ? "video" : "image",
      alt: artifactDisplayName(artifact),
      placeholderSrc: thumb ? resolveChatMediaSrc(thumb) : undefined,
      artifact,
    }]
  }), [resolveImageSrc, resolveTarget, viewable])
  const viewerIndex = viewerKey ? viewerItems.findIndex(item => item.id === viewerKey) : -1
  const closeViewer = useCallback(() => setViewerKey(null), [])

  const jump = useCallback((messageUid: string) => {
    setViewerKey(null)
    onJumpToMessage?.(messageUid)
  }, [onJumpToMessage])

  const actions = useMemo<ArtifactActions>(() => ({
    now,
    resolveTarget,
    resolveImageSrc,
    resolveFileLink,
    onJump: onJumpToMessage ? jump : undefined,
    onOpenMedia: artifact => setViewerKey(artifact.key),
  }), [jump, now, onJumpToMessage, resolveFileLink, resolveImageSrc, resolveTarget])

  const retry = onRetry && (
    <Button type="button" variant="outline" size="sm" onClick={onRetry}>
      <i className="ph-bold ph-arrow-clockwise" aria-hidden="true" />
      Retry
    </Button>
  )

  let body: ReactNode
  if (visible.length === 0 && (status === "idle" || status === "loading")) {
    body = <Notice icon="ph-spinner animate-spin" role="status">Loading artifacts…</Notice>
  } else if (visible.length === 0 && status === "error") {
    body = <Notice icon="ph-warning" role="alert" tone="error" action={retry}>{error ?? "Could not load artifacts."}</Notice>
  } else if (visible.length === 0) {
    body = <Notice icon="ph-squares-four">Nothing shared in this conversation yet.</Notice>
  } else {
    const audio = groups.media.filter(item => item.kind === "audio")
    body = (
      <Tabs value={tab} onValueChange={value => setSelected(value as ArtifactTab)} className="min-h-0 flex-1 gap-0">
        <TabsList variant="settings" aria-label="Artifact types" className="shrink-0 px-1">
          {tabs.map(id => (
            <TabsTrigger key={id} value={id} data-artifact-tab={id} title={ARTIFACT_TAB_LABELS[id]} className="gap-1.5 px-2">
              <i className={cn("ph-bold", TAB_ICONS[id], "text-sm")} aria-hidden="true" />
              {/* Labels give way to icon + count in a narrow panel so the strip never clips. */}
              <span className="sr-only @[24rem]:not-sr-only">{ARTIFACT_TAB_LABELS[id]}</span>
              <span data-slot="artifact-tab-count" className="font-mono text-[10px] tabular-nums text-text-muted">{groups[id].length}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        <ScrollArea className="min-h-0 flex-1">
          <div data-slot="artifacts-content" role="tabpanel" aria-label={ARTIFACT_TAB_LABELS[tab]} className="p-2">
            {tab === "media" && (
              <div className="flex flex-col gap-3">
                {viewable.length > 0 && (
                  <ul data-slot="artifact-grid" className="grid grid-cols-3 gap-1.5 @[26rem]:grid-cols-4 @[40rem]:grid-cols-5 @[56rem]:grid-cols-6">
                    {viewable.map(artifact => (
                      <li key={artifact.key} className="min-w-0">
                        {artifact.kind === "video"
                          ? <VideoTile artifact={artifact} actions={actions} />
                          : <ImageTile artifact={artifact} actions={actions} />}
                      </li>
                    ))}
                  </ul>
                )}
                {audio.length > 0 && (
                  <ul data-slot="artifact-audio-list" aria-label="Audio" className="flex flex-col gap-1.5">
                    {audio.map(artifact => (
                      <li key={artifact.key}><AudioRow artifact={artifact} actions={actions} /></li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {tab === "documents" && (
              <ul className="flex flex-col gap-0.5">
                {groups.documents.map(artifact => <DocumentRow key={artifact.key} artifact={artifact} actions={actions} />)}
              </ul>
            )}
            {tab === "links" && (
              <ul className="flex flex-col gap-0.5">
                {groups.links.map(artifact => <LinkRow key={artifact.key} artifact={artifact} actions={actions} />)}
              </ul>
            )}
            {tab === "entities" && (
              <ul className="grid grid-cols-1 gap-1.5 @[28rem]:grid-cols-2 @[48rem]:grid-cols-4">
                {groups.entities.map(artifact => <EntityTile key={artifact.key} artifact={artifact} actions={actions} />)}
              </ul>
            )}
          </div>
        </ScrollArea>
        {status === "error" && (
          <div role="alert" className="flex shrink-0 items-center gap-2 border-t border-overlay-10 px-3 py-1.5 text-xs text-text-muted">
            <i className="ph-bold ph-warning" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{error ?? "Could not refresh."}</span>
            {retry}
          </div>
        )}
      </Tabs>
    )
  }

  const viewing = viewerIndex >= 0 ? viewerItems[viewerIndex] : null
  return (
    <TooltipProvider>
      <div
        data-slot="artifacts-panel"
        data-status={status}
        aria-busy={status === "loading" || undefined}
        className={cn("@container flex h-full min-h-0 min-w-0 flex-col", className)}
      >
        {body}
      </div>
      {viewing && (
        <MediaViewer
          items={viewerItems}
          index={viewerIndex}
          onIndexChange={index => setViewerKey(viewerItems[index]?.id != null ? String(viewerItems[index].id) : null)}
          onClose={closeViewer}
          ariaLabel="Conversation media"
          desktopPanel={<ViewerDetails artifact={viewing.artifact} now={now} onJump={onJumpToMessage ? jump : undefined} />}
          mobileActions={onJumpToMessage ? <ViewerJumpButton artifact={viewing.artifact} onJump={jump} /> : undefined}
          mobileDetails={<ViewerDetails artifact={viewing.artifact} now={now} onJump={onJumpToMessage ? jump : undefined} />}
        />
      )}
    </TooltipProvider>
  )
}
