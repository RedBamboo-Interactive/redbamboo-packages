import { memo, useState, useRef, useEffect, useMemo, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import {
  buttonVariants,
  copyTextToClipboard,
  EntityCard,
  Icon,
  useContextMenuEnabled,
  useContextTarget,
  useEntityCardPresentation,
  useEntityInteraction,
  useUiEnvironment,
} from "@redbamboo/ui"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import {
  parseEntityEmbedParagraph,
  resolveEntityEmbedCardView,
  type EntityEmbedReference,
} from "../lib/entity-embed"
import { isImageUrl } from "../lib/event-image"
import { canonicalizeLeafLinkHref, isExternalWebLink, isInternalLeafLink } from "../lib/external-web-link"
import { resolveChatMediaSrc } from "../lib/media-url"
import { parseLocalFileLink } from "../lib/local-file-link"
import { isVideoSrc } from "../lib/media-kind"
import { useVideoPoster } from "../lib/use-video-poster"
import { isUnsafeLinkHref, remarkUserText } from "../lib/user-markdown"
import { rehypeColorSwatches } from "../lib/color-swatch"
import { rehypeOrderedListMarkers } from "../lib/ordered-list-markers"
import { codeBlockActionEntries, codeBlockSource, type HastLike } from "../lib/chat-actions"

type FileLinkResolver = (
  filePath: string,
  opts?: { line?: number; column?: number },
) => (() => void) | undefined

const AUTHORED_LINK_CLASS_NAME = "inline-flex max-w-full items-center gap-1 rounded-md border border-overlay-10 bg-overlay-4 px-1.5 py-0.5 font-sans text-[0.85em] text-text-secondary no-underline align-baseline transition-colors hover:border-overlay-30 hover:bg-overlay-6"

// Module-level lightbox state shared across all StreamingText/MarkdownRenderer instances
let lightboxState: { src: string; alt: string; type: "image" | "video" } | null = null
const listeners = new Set<() => void>()
function setLightbox(s: typeof lightboxState) { lightboxState = s; listeners.forEach(fn => fn()) }
function subscribeLightbox(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb) } }
function getLightbox() { return lightboxState }

export function MediaLightbox() {
  const state = useSyncExternalStore(subscribeLightbox, getLightbox)
  const environment = useUiEnvironment()

  useEffect(() => {
    if (!state) return
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setLightbox(null) }
    environment.document.addEventListener("keydown", handler)
    return () => environment.document.removeEventListener("keydown", handler)
  }, [environment.document, state])

  if (!state) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300"
      onClick={(e) => { if (e.target === e.currentTarget) setLightbox(null) }}
      role="dialog"
      aria-modal="true"
      aria-label={state.alt || (state.type === "video" ? "Video player" : "Image preview")}
    >
      <div className="max-w-4xl max-h-[90vh] overflow-auto animate-in fade-in zoom-in-98 duration-200" onClick={e => e.stopPropagation()}>
        {state.type === "video" ? (
          <video src={state.src} controls autoPlay className="max-w-full max-h-[85vh] rounded-xl" />
        ) : (
          <img src={state.src} alt={state.alt} className="max-w-full max-h-[85vh] rounded-xl object-contain" />
        )}
        {state.alt && <p className="text-sm text-text-muted text-center px-4 py-2">{state.alt}</p>}
      </div>
    </div>,
    environment.portalContainer,
  )
}

export function ImageThumbnail({ src, alt, resolve }: { src?: string; alt?: string; resolve?: (s: string) => string | undefined }) {
  const resolved = resolveChatMediaSrc(src, resolve)

  return (
    <button
      onClick={() => setLightbox({ src: resolved || "", alt: alt || "", type: "image" })}
      data-slot="chat-image-embed"
      data-context-media={resolved ? "image" : undefined}
      data-context-media-src={resolved || undefined}
      className="inline-block rounded-lg overflow-hidden border border-overlay-10 hover:border-overlay-30 transition-colors cursor-pointer my-1"
    >
      <img src={resolved} alt={alt || ""} loading="lazy" className="w-20 h-20 object-cover" />
    </button>
  )
}

function MarkdownLink({
  href,
  children,
  resolve,
  resolveFileLink,
  currentOrigin,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  resolve?: (s: string) => string | undefined
  resolveFileLink?: FileLinkResolver
  currentOrigin: string
}) {
  if (isImageUrl(href)) {
    const alt = typeof children === "string" ? children : ""
    return <ImageThumbnail src={href} alt={alt} resolve={resolve} />
  }

  href = canonicalizeLeafLinkHref(href)
  const localFile = parseLocalFileLink(href)
  if (localFile) {
    const action = resolveFileLink?.(localFile.filePath, {
      line: localFile.line,
      column: localFile.column,
    })
    const fallbackLabel = localFile.filePath.replace(/\\/g, "/").split("/").pop() ?? localFile.filePath
    const location = localFile.line
      ? `, line ${localFile.line}${localFile.column ? `, column ${localFile.column}` : ""}`
      : ""
    const className = `${AUTHORED_LINK_CLASS_NAME} disabled:cursor-default disabled:opacity-60`
    const content = (
      <>
        <Icon name="ph-bold ph-file" aria-hidden="true" className="size-3 shrink-0" />
        <span className="truncate">{children || fallbackLabel}</span>
        {localFile.line && <span className="shrink-0 text-text-muted">:{localFile.line}</span>}
      </>
    )
    return action ? (
      <button
        type="button"
        data-slot="local-file-link"
        className={className}
        title={`Open ${localFile.filePath}${location}`}
        aria-label={`Open ${localFile.filePath}${location}`}
        onClick={action}
      >
        {content}
      </button>
    ) : (
      <span data-slot="local-file-link" className={className} title={localFile.filePath}>{content}</span>
    )
  }

  if (isInternalLeafLink(href, currentOrigin)) {
    return (
      <a
        {...props}
        data-slot="internal-leaf-link"
        href={href}
        className={`${AUTHORED_LINK_CLASS_NAME} ${props.className ?? ""}`}
        style={{ ...props.style, textDecoration: "none" }}
      >
        <Icon name="ph-bold ph-leaf" aria-hidden="true" className="size-3 shrink-0" />
        <span className="truncate">{children || href}</span>
      </a>
    )
  }

  if (isExternalWebLink(href)) {
    return (
      <a
        {...props}
        data-slot="external-web-link"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={`${AUTHORED_LINK_CLASS_NAME} ${props.className ?? ""}`}
        style={{ ...props.style, textDecoration: "none" }}
        title={props.title ?? `Open ${href} in a new tab`}
      >
        <Icon name="ph-bold ph-globe" aria-hidden="true" className="size-3 shrink-0" />
        <span className="truncate">{children || href}</span>
      </a>
    )
  }

  if (isUnsafeLinkHref(href)) return <span>{children}</span>

  return <a {...props} href={href}>{children}</a>
}

/**
 * A fenced block with a Copy button, shown while the Leaf context menu is on.
 * The button sits inside the `pre` so the Markdown's block structure and
 * spacing stay exactly as rendered without it; Copy takes the block's source
 * from its syntax tree, never from the highlighted DOM.
 */
function CodeBlock({ node, children, style, className, ...props }: React.HTMLAttributes<HTMLPreElement> & { node?: HastLike }) {
  const environment = useUiEnvironment()
  const ref = useRef<HTMLPreElement>(null)
  const nodeRef = useRef(node)
  nodeRef.current = node
  const [copied, setCopied] = useState(false)
  const resetRef = useRef(0)
  useEffect(() => () => environment.window.clearTimeout(resetRef.current), [environment.window])

  const copy = () => {
    void copyTextToClipboard(codeBlockSource(nodeRef.current), environment.document).then((ok) => {
      if (!ok) return
      setCopied(true)
      environment.window.clearTimeout(resetRef.current)
      resetRef.current = environment.window.setTimeout(() => setCopied(false), 1500)
    })
  }
  useContextTarget(ref, () => codeBlockActionEntries(copy))

  return (
    <pre ref={ref} {...props} data-slot="chat-code-block" className={`group/code ${className ?? ""}`} style={{ ...style, position: "relative" }}>
      <button
        type="button"
        onClick={copy}
        data-slot="chat-code-copy"
        aria-label={copied ? "Copied" : "Copy code"}
        title={copied ? "Copied" : "Copy code"}
        className="flex size-6 items-center justify-center rounded-md bg-overlay-6 font-sans text-xs text-text-muted transition-opacity duration-150 hover:bg-overlay-10 hover:text-contrast focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/code:opacity-100"
        style={{ position: "absolute", top: "0.375rem", right: "0.375rem" }}
      >
        <i aria-hidden="true" className={copied ? "ph-bold ph-check" : "ph-bold ph-copy"} />
      </button>
      {children}
    </pre>
  )
}

const VideoThumbnail = memo(function VideoThumbnail({ src, alt, resolve }: { src?: string; alt?: string; resolve?: (s: string) => string | undefined }) {
  const resolved = resolveChatMediaSrc(src, resolve)
  const poster = useVideoPoster(resolved)

  return (
    <button
      onClick={() => setLightbox({ src: resolved || "", alt: alt || "", type: "video" })}
      data-context-media={resolved ? "video" : undefined}
      data-context-media-src={resolved || undefined}
      className="inline-block rounded-lg overflow-hidden border border-overlay-10 hover:border-overlay-30 transition-colors cursor-pointer my-1 relative"
    >
      {poster ? (
        <img src={poster} alt={alt || ""} className="w-20 h-20 object-cover" />
      ) : (
        <div className="w-20 h-20 bg-overlay-6" />
      )}
      <div className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="white" className="drop-shadow-md">
          <path d="M4 2.5v11l9-5.5z" />
        </svg>
      </div>
    </button>
  )
}, (prev, next) => prev.src === next.src && prev.alt === next.alt)

function EntityMarkdownCard({ reference }: { reference: EntityEmbedReference }) {
  const requestedEntity = {
    id: reference.id,
    typeSlug: reference.typeSlug,
    name: reference.name,
  }
  const presentation = useEntityCardPresentation(requestedEntity)
  const view = resolveEntityEmbedCardView(reference, presentation)

  return (
    <div
      data-slot="entity-embed"
      data-entity-presentation={presentation ? "resolved" : "fallback"}
      className="my-2 w-full font-sans"
    >
      <EntityCard
        entity={view.entity}
        visual={view.visual}
        subtitle={view.subtitle}
        size="md"
        variant="outlined"
        width="half"
        action={{
          kind: "inspect",
          href: reference.href,
          ariaLabel: `Inspect ${reference.name}`,
        }}
        actions={(
          <a
            data-slot="entity-card-open"
            href={reference.href}
            className={buttonVariants({
              variant: "ghost",
              size: "icon-xs",
              className: "text-text-muted",
            })}
            aria-label={`Open ${view.entity.name} in Database`}
            title={`Open ${view.entity.name} in Database`}
          >
            <Icon name="ph-bold ph-arrow-square-out" aria-hidden="true" className="size-4" />
          </a>
        )}
      />
    </div>
  )
}

function useMarkdownComponents(
  resolveImageSrc: ((src: string) => string | undefined) | undefined,
  resolveFileLink: FileLinkResolver | undefined,
  currentOrigin: string,
) {
  const entityEmbedsEnabled = useEntityInteraction() !== null
  const leafMenu = useContextMenuEnabled()
  const resolveRef = useRef(resolveImageSrc)
  resolveRef.current = resolveImageSrc

  return useMemo(() => ({
    img: ({ src, alt }: React.ImgHTMLAttributes<HTMLImageElement>) => {
      const s = src?.toString()
      if (isVideoSrc(s)) return <VideoThumbnail src={s} alt={alt?.toString()} resolve={resolveRef.current} />
      return <ImageThumbnail src={s} alt={alt?.toString()} resolve={resolveRef.current} />
    },
    a: ({ href, children, node: _node, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown }) => (
      <MarkdownLink href={href} resolve={resolveRef.current} resolveFileLink={resolveFileLink} currentOrigin={currentOrigin} {...props}>{children}</MarkdownLink>
    ),
    p: ({ node, children, ...props }: React.HTMLAttributes<HTMLParagraphElement> & { node?: unknown }) => {
      const reference = entityEmbedsEnabled
        ? parseEntityEmbedParagraph(node, currentOrigin)
        : null
      return reference
        ? <EntityMarkdownCard reference={reference} />
        : <p {...props}>{children}</p>
    },
    // Fenced blocks render as before unless the Leaf context menu is on.
    ...(leafMenu ? {
      pre: ({ node, children, ...props }: React.HTMLAttributes<HTMLPreElement> & { node?: unknown }) => (
        <CodeBlock node={node as HastLike | undefined} {...props}>{children}</CodeBlock>
      ),
    } : {}),
  }), [currentOrigin, entityEmbedsEnabled, leafMenu, resolveFileLink])
}

const CHARS_PER_FRAME = 3
const MESSAGE_REHYPE_PLUGINS = [rehypeHighlight, rehypeColorSwatches, rehypeOrderedListMarkers]

export function StreamingText({
  content,
  isLive,
  resolveImageSrc,
  resolveFileLink,
}: {
  content: string
  isLive: boolean
  resolveImageSrc?: (src: string) => string | undefined
  resolveFileLink?: FileLinkResolver
}) {
  const environment = useUiEnvironment()
  const revealedRef = useRef(isLive ? 0 : content.length)
  const targetRef = useRef(content.length)
  const rafRef = useRef<number>(0)
  const [revealed, setRevealed] = useState(revealedRef.current)

  targetRef.current = content.length

  useEffect(() => {
    if (!isLive) {
      revealedRef.current = content.length
      setRevealed(content.length)
      return
    }
    const tick = () => {
      if (revealedRef.current < targetRef.current) {
        revealedRef.current = Math.min(revealedRef.current + CHARS_PER_FRAME, targetRef.current)
        setRevealed(revealedRef.current)
      }
      rafRef.current = environment.window.requestAnimationFrame(tick)
    }
    rafRef.current = environment.window.requestAnimationFrame(tick)
    return () => environment.window.cancelAnimationFrame(rafRef.current)
  }, [environment.window, isLive, content.length])

  const mdComponents = useMarkdownComponents(resolveImageSrc, resolveFileLink, environment.window.location.origin)

  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={MESSAGE_REHYPE_PLUGINS}
      components={mdComponents}
      urlTransform={(u: string) => u}
    >
      {content.slice(0, revealed)}
    </Markdown>
  )
}

const AUTHORED_REMARK_PLUGINS = [remarkGfm]
const USER_TEXT_REMARK_PLUGINS = [remarkGfm, remarkUserText]

export function MarkdownRenderer({
  content,
  userText,
  resolveImageSrc,
  resolveFileLink,
}: {
  content: string
  /** Typed by a person: keep their line breaks and show raw HTML literally. */
  userText?: boolean
  resolveImageSrc?: (src: string) => string | undefined
  resolveFileLink?: FileLinkResolver
}) {
  const environment = useUiEnvironment()
  const mdComponents = useMarkdownComponents(resolveImageSrc, resolveFileLink, environment.window.location.origin)

  return (
    <Markdown
      remarkPlugins={userText ? USER_TEXT_REMARK_PLUGINS : AUTHORED_REMARK_PLUGINS}
      rehypePlugins={MESSAGE_REHYPE_PLUGINS}
      components={mdComponents}
      urlTransform={(u: string) => u}
    >
      {content}
    </Markdown>
  )
}
