// Leaf context menu core: item descriptors, the native-passthrough rules, the
// element and kind registries, section assembly and the built-in providers.
// No React and no imports, so node tests run it directly and duplicate module
// copies (a plugin dev build) still share one registry through globalThis.

// ── Descriptors ──────────────────────────────────────────────────────────────

/** What an item's `run` receives. */
export interface ContextMenuRunContext {
  /** The element the menu was opened for: the registered target, link, media, or null for a ⋮ menu. */
  target: Element | null
  /**
   * The element actually pressed (innermost on the event path), so one target
   * can tailor its items to a part of itself. Null for a ⋮ menu.
   */
  origin: Element | null
  /** Where the item was chosen. */
  surface: "dropdown" | "context-menu" | "sheet"
  document: Document
  window: Window
  /** SPA navigation through the host (falls back to a full page load). */
  navigate: (to: string) => void
  /** Copies text, falling back to `execCommand("copy")` without the async Clipboard API. */
  copyText: (text: string) => Promise<boolean>
}

/**
 * One action. The ⋮ row menu and the context menu render the same array, so
 * they cannot drift. With `commandId`, a missing label, shortcut or run comes
 * from the command palette's command of that id.
 */
export interface ContextMenuItem {
  id: string
  label?: string
  /** Phosphor class names, for example `ph-bold ph-pen`. */
  icon?: string
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  /** Renders a checkbox item when defined. */
  checked?: boolean
  children?: ContextMenuEntry[]
  commandId?: string
  run?: (ctx: ContextMenuRunContext) => void | Promise<void>
  /** Extra attributes for the rendered item (stable `data-*` hooks, `aria-*`). */
  attributes?: Record<string, string | boolean | undefined>
  className?: string
}

export interface ContextMenuSeparator {
  id: string
  separator: true
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator

export type ContextMenuEntries = ContextMenuEntry[] | Promise<ContextMenuEntry[]>

export interface ContextMenuCommandInfo {
  label: string
  shortcut?: string
  run?: () => void | Promise<void>
}

export function isContextMenuSeparator(entry: ContextMenuEntry): entry is ContextMenuSeparator {
  return (entry as ContextMenuSeparator).separator === true
}

/**
 * Fills command-backed items, drops items with no label, and removes leading,
 * trailing and doubled separators (recursively).
 */
export function normalizeContextMenuEntries(
  entries: readonly ContextMenuEntry[],
  resolveCommand?: (id: string) => ContextMenuCommandInfo | undefined,
): ContextMenuEntry[] {
  const result: ContextMenuEntry[] = []
  for (const entry of entries) {
    if (isContextMenuSeparator(entry)) {
      if (result.length > 0 && !isContextMenuSeparator(result[result.length - 1])) result.push(entry)
      continue
    }
    let item = entry
    if (item.commandId && resolveCommand) {
      const command = resolveCommand(item.commandId)
      if (command) {
        item = {
          ...item,
          label: item.label ?? command.label,
          shortcut: item.shortcut ?? command.shortcut,
          run: item.run ?? (command.run ? () => command.run!() : undefined),
        }
      }
    }
    if (!item.label) continue
    if (item.children) {
      const children = normalizeContextMenuEntries(item.children, resolveCommand)
      if (children.length === 0 && !item.run) continue
      item = { ...item, children: children.length > 0 ? children : undefined }
    }
    result.push(item)
  }
  while (result.length > 0 && isContextMenuSeparator(result[result.length - 1])) result.pop()
  return result
}

// ── Shared state ─────────────────────────────────────────────────────────────

export interface ContextMenuConfig {
  /** The user's "Leaf context menu" preference. Off: no host listens and no target registers. */
  enabled: boolean
  navigate?: (to: string) => void
  openCommandPalette?: () => void
  resolveCommand?: (id: string) => ContextMenuCommandInfo | undefined
}

export interface ContextTargetRegistration {
  /** Null declines: the menu resolves from the next registered or matched ancestor instead. */
  getItems: (ctx: ContextMenuRunContext) => ContextMenuEntries | null
  /** Lets other providers contribute to this target (see {@link ContextMenuProvider}). */
  kind?: string
  subject?: unknown
  /** The registering component's portal container, so the menu renders inside its CSS scope. */
  portalContainer?: HTMLElement
}

/**
 * Supplies items for a kind of object. A provider with `match` owns a kind and
 * recognises it on an element; one without `match` contributes to a kind owned
 * elsewhere, in a separate, capped group after the owner's items.
 */
export interface ContextMenuProvider<Subject = any> {
  id: string
  kind: string
  /** Group label for a contribution, usually the contributing plugin's name. */
  label?: string
  match?: (element: Element) => Subject | null | undefined
  getItems: (subject: Subject, ctx: ContextMenuRunContext) => ContextMenuEntries
  /**
   * Items that need a round trip (a permission check), appended to this
   * provider's group when they arrive, so the rest never waits for them.
   */
  getDeferredItems?: (subject: Subject, ctx: ContextMenuRunContext) => Promise<ContextMenuEntry[]>
}

interface ContextMenuState {
  config: ContextMenuConfig
  listeners: Set<() => void>
  targets: WeakMap<object, ContextTargetRegistration>
  providers: ContextMenuProvider[]
}

const STATE_KEY = Symbol.for("redbamboo.context-menu")

function state(): ContextMenuState {
  const holder = globalThis as unknown as Record<symbol, ContextMenuState | undefined>
  let current = holder[STATE_KEY]
  if (!current) {
    current = { config: { enabled: false }, listeners: new Set(), targets: new WeakMap(), providers: [] }
    holder[STATE_KEY] = current
  }
  return current
}

export function getContextMenuConfig(): ContextMenuConfig {
  return state().config
}

export function subscribeContextMenuConfig(listener: () => void): () => void {
  const listeners = state().listeners
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Merges host settings into the shared config; the returned function restores the previous config. */
export function configureContextMenu(partial: Partial<ContextMenuConfig>): () => void {
  const current = state()
  const previous = current.config
  current.config = { ...previous, ...partial }
  for (const listener of current.listeners) listener()
  return () => {
    current.config = previous
    for (const listener of current.listeners) listener()
  }
}

/** Registers an element as a context target. A no-op while the context menu is off. */
export function registerContextTarget(element: Element, registration: ContextTargetRegistration): () => void {
  const current = state()
  if (!current.config.enabled) return () => {}
  current.targets.set(element, registration)
  return () => {
    if (current.targets.get(element) === registration) current.targets.delete(element)
  }
}

export function getContextTarget(element: object): ContextTargetRegistration | undefined {
  return state().targets.get(element)
}

export function registerContextMenuProvider(provider: ContextMenuProvider): () => void {
  const current = state()
  current.providers = [...current.providers.filter((p) => p.id !== provider.id), provider]
  return () => {
    current.providers = current.providers.filter((p) => p !== provider)
  }
}

export function getContextMenuProviders(): readonly ContextMenuProvider[] {
  return state().providers
}

// ── Native passthrough ───────────────────────────────────────────────────────

/** Movement since the right-button press beyond which a release is a drag, not a menu request. */
export const RIGHT_DRAG_THRESHOLD = 5
/** Coarse-pointer long-press. */
export const LONG_PRESS_MS = 500
export const LONG_PRESS_MOVE_TOLERANCE = 8

/**
 * Subtrees that run their own touch long-press: Base UI context-menu triggers
 * (the composer's send options) and chat message rows, unless a row hands its
 * long-press to the Leaf menu with `data-leaf-long-press`. A chat build that
 * predates that attribute keeps its own gesture.
 */
export const TOUCH_GESTURE_OWNERS = '[data-slot="context-menu-trigger"], [data-message-uid]:not([data-leaf-long-press])'

export type ContextMenuDecision =
  /** Another handler already took the event: do nothing. */
  | "ignore"
  /** Leave the browser's menu. */
  | "native"
  /** Neither menu (`data-context-menu="none"`, or a right-drag). */
  | "suppress"
  | "leaf"

export interface ContextMenuEventLike {
  defaultPrevented: boolean
  shiftKey: boolean
  composedPath(): EventTarget[]
}

export function isElementLike(node: unknown): node is Element {
  return typeof node === "object" && node !== null && (node as Node).nodeType === 1
}

/** Elements of an event path, innermost first (cross-document safe: no instanceof). */
export function pathElements(path: readonly EventTarget[]): Element[] {
  return path.filter(isElementLike)
}

export function isEditableElement(element: Element): boolean {
  const tag = element.tagName
  if (tag === "INPUT" || tag === "TEXTAREA") return true
  return (element as HTMLElement).isContentEditable === true
}

/** The nearest `data-context-menu` value on the path. */
export function contextMenuMode(elements: readonly Element[]): string | null {
  for (const element of elements) {
    const mode = element.getAttribute("data-context-menu")
    if (mode) return mode
  }
  return null
}

export function classifyContextMenuEvent(
  event: ContextMenuEventLike,
  /** `keyboard`: opened with the Menu key or Shift+F10, where Shift is part of the shortcut. */
  options: { dragDistance?: number; keyboard?: boolean } = {},
): ContextMenuDecision {
  if (event.defaultPrevented) return "ignore"
  if (event.shiftKey && !options.keyboard) return "native"
  const elements = pathElements(event.composedPath())
  const mode = contextMenuMode(elements)
  if (mode === "native") return "native"
  if (mode === "none") return "suppress"
  if (elements[0] && isEditableElement(elements[0])) return "native"
  if ((options.dragDistance ?? 0) > RIGHT_DRAG_THRESHOLD) return "suppress"
  return "leaf"
}

/** Whether a touch long-press on this path belongs to someone else. */
export function isTouchGestureOwned(elements: readonly Element[]): boolean {
  return elements.some((element) => element.matches?.(TOUCH_GESTURE_OWNERS))
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

// ── Section assembly ─────────────────────────────────────────────────────────

export const INTRINSIC_KINDS = ["selection", "link", "image", "video", "audio", "page"] as const

/** Contributions shown before the rest folds into a "More" submenu. */
export const CONTRIBUTION_CAP = 4

export interface ContextMenuSection {
  id: string
  kind: string
  role: "object" | "contribution" | "intrinsic" | "page" | "palette"
  /** Element the section's actions apply to. */
  element: Element | null
  entries: ContextMenuEntries
  /** Appended to `entries` when it settles (see {@link ContextMenuProvider.getDeferredItems}). */
  deferred?: Promise<ContextMenuEntry[]>
  /** Where the menu should portal for this section's styles (registered targets only). */
  portalContainer?: HTMLElement
}

export interface LinkSubject {
  element: Element
  href: string
  text: string
}

export interface MediaSubject {
  element: Element
  kind: "image" | "video" | "audio"
  src: string
}

export interface SelectionSubject {
  text: string
}

export interface SelectionLike {
  text: string
  containsTarget: boolean
}

export interface BuildSectionsInput {
  path: readonly EventTarget[]
  selection?: SelectionLike | null
  ctx: (element: Element | null) => ContextMenuRunContext
  /** False in windows with no navigable page (Document Picture-in-Picture). */
  pageActions?: boolean
  /** Object and intrinsic sections only (a touch long-press never shows a page-only sheet). */
  objectsOnly?: boolean
}

function safeItems<S>(provider: ContextMenuProvider<S>, subject: S, ctx: ContextMenuRunContext): ContextMenuEntries {
  try {
    const items = provider.getItems(subject, ctx)
    if (items && typeof (items as Promise<ContextMenuEntry[]>).then === "function") {
      return (items as Promise<ContextMenuEntry[]>).catch((error) => {
        console.warn(`[context-menu] provider "${provider.id}" failed`, error)
        return []
      })
    }
    return items
  } catch (error) {
    console.warn(`[context-menu] provider "${provider.id}" failed`, error)
    return []
  }
}

function deferredItems<S>(provider: ContextMenuProvider<S>, subject: S, ctx: ContextMenuRunContext): Promise<ContextMenuEntry[]> | undefined {
  if (!provider.getDeferredItems) return undefined
  try {
    return provider.getDeferredItems(subject, ctx).catch((error) => {
      console.warn(`[context-menu] provider "${provider.id}" failed`, error)
      return []
    })
  } catch (error) {
    console.warn(`[context-menu] provider "${provider.id}" failed`, error)
    return undefined
  }
}

/** Folds contributions past the cap into a trailing "More" submenu. */
export function capContributions(entries: ContextMenuEntry[], cap = CONTRIBUTION_CAP): ContextMenuEntry[] {
  const items = entries.filter((entry) => !isContextMenuSeparator(entry))
  if (items.length <= cap) return items
  return [
    ...items.slice(0, cap - 1),
    { id: "more-contributions", label: "More", icon: "ph-bold ph-dots-three", children: items.slice(cap - 1) },
  ]
}

function contributionSection(
  kind: string,
  subject: unknown,
  element: Element | null,
  input: BuildSectionsInput,
  providers: readonly ContextMenuProvider[],
): ContextMenuSection | null {
  const contributors = providers.filter((provider) => provider.kind === kind && !provider.match)
  if (contributors.length === 0) return null
  const ctx = input.ctx(element)
  const parts = contributors.map((provider) => safeItems(provider, subject, ctx))
  const entries = parts.some((part) => typeof (part as Promise<unknown>).then === "function")
    ? Promise.all(parts).then((all) => capContributions(all.flat()))
    : capContributions((parts as ContextMenuEntry[][]).flat())
  return { id: `${kind}:contributions`, kind, role: "contribution", element, entries }
}

function hrefOf(element: Element): string | null {
  if (element.tagName !== "A" && element.tagName !== "AREA") return null
  const raw = element.getAttribute("href")
  if (!raw || raw.startsWith("javascript:")) return null
  return (element as HTMLAnchorElement).href || raw
}

const MEDIA_KINDS: readonly MediaSubject["kind"][] = ["image", "video", "audio"]

/**
 * An element that stands for media it does not render directly, such as a
 * thumbnail button that opens the full image, a video poster or an attachment
 * card: `data-context-media="image|video|audio"` plus `data-context-media-src`.
 */
function declaredMediaOf(element: Element): MediaSubject | null {
  const kind = element.getAttribute("data-context-media") as MediaSubject["kind"] | null
  const src = element.getAttribute("data-context-media-src")
  if (!kind || !MEDIA_KINDS.includes(kind) || !src) return null
  const ownerDocument = element.ownerDocument
  let absolute = src
  try {
    absolute = new URL(src, ownerDocument?.baseURI).href
  } catch {
    // Keep the attribute as written.
  }
  return { element, kind, src: absolute }
}

function mediaOf(element: Element): MediaSubject | null {
  const declared = declaredMediaOf(element)
  if (declared) return declared
  const tag = element.tagName
  const kind = tag === "IMG" ? "image" : tag === "VIDEO" ? "video" : tag === "AUDIO" ? "audio" : null
  if (!kind) return null
  const media = element as HTMLImageElement & HTMLMediaElement
  const src = media.currentSrc || media.src || element.getAttribute("src") || ""
  return src ? { element, kind, src } : null
}

/**
 * Sections, in order: the innermost registered object and its contributions,
 * then selection, link and media, then the page row and the command palette.
 * Ancestor objects are not merged in.
 */
export function buildContextMenuSections(input: BuildSectionsInput): ContextMenuSection[] {
  const providers = getContextMenuProviders()
  const owners = providers.filter((provider) => provider.match)
  const objectOwners = owners.filter((provider) => !(INTRINSIC_KINDS as readonly string[]).includes(provider.kind))
  const ownerOf = (kind: string) => owners.find((provider) => provider.kind === kind)
  const elements = pathElements(input.path)
  const sections: ContextMenuSection[] = []

  let objectIndex = elements.length
  for (let index = 0; index < elements.length && objectIndex === elements.length; index++) {
    const element = elements[index]
    const registration = getContextTarget(element)
    if (registration) {
      let entries: ContextMenuEntries | null
      try {
        entries = registration.getItems(input.ctx(element))
      } catch (error) {
        console.warn("[context-menu] target failed", error)
        entries = []
      }
      if (entries === null) continue
      objectIndex = index
      sections.push({ id: "object", kind: registration.kind ?? "target", role: "object", element, entries, portalContainer: registration.portalContainer })
      if (registration.kind) {
        const contributions = contributionSection(registration.kind, registration.subject ?? element, element, input, providers)
        if (contributions) sections.push(contributions)
      }
      break
    }
    for (const owner of objectOwners) {
      let subject: unknown
      try {
        subject = owner.match!(element)
      } catch {
        subject = null
      }
      if (subject == null) continue
      objectIndex = index
      const ctx = input.ctx(element)
      sections.push({ id: "object", kind: owner.kind, role: "object", element, entries: safeItems(owner, subject, ctx), deferred: deferredItems(owner, subject, ctx) })
      const contributions = contributionSection(owner.kind, subject, element, input, providers)
      if (contributions) sections.push(contributions)
      break
    }
  }

  const intrinsic = (kind: string, subject: unknown, element: Element | null) => {
    const owner = ownerOf(kind)
    if (owner) {
      const ctx = input.ctx(element)
      sections.push({ id: kind, kind, role: "intrinsic", element, entries: safeItems(owner, subject, ctx), deferred: deferredItems(owner, subject, ctx) })
    }
    const contributions = contributionSection(kind, subject, element, input, providers)
    if (contributions) sections.push(contributions)
  }

  const selection = input.selection
  if (selection && selection.containsTarget && selection.text.trim()) {
    intrinsic("selection", { text: selection.text } satisfies SelectionSubject, null)
  }

  // A link that is the object itself, or wraps it, is the object's own navigation.
  for (let index = 0; index < objectIndex; index++) {
    const href = hrefOf(elements[index])
    if (!href) continue
    intrinsic("link", { element: elements[index], href, text: elements[index].textContent?.trim() ?? "" } satisfies LinkSubject, elements[index])
    break
  }

  // A declared source (the full image behind a thumbnail) beats the pixels pressed.
  let media: MediaSubject | null = null
  for (const element of elements) {
    media = declaredMediaOf(element)
    if (media) break
  }
  if (!media) {
    for (const element of elements) {
      media = mediaOf(element)
      if (media) break
    }
  }
  if (media) intrinsic(media.kind, media, media.element)

  if (input.objectsOnly) return sections

  if (input.pageActions !== false) {
    const owner = ownerOf("page")
    if (owner) sections.push({ id: "page", kind: "page", role: "page", element: null, entries: safeItems(owner, null, input.ctx(null)) })
  }

  const openPalette = getContextMenuConfig().openCommandPalette
  if (openPalette) {
    sections.push({
      id: "palette",
      kind: "palette",
      role: "palette",
      element: null,
      entries: [{ id: "command-palette", label: "Command palette", icon: "ph-bold ph-command", shortcut: "Ctrl+K", run: () => openPalette() }],
    })
  }
  return sections
}

// ── Clipboard, files and URLs ────────────────────────────────────────────────

export async function copyTextToClipboard(text: string, ownerDocument: Document): Promise<boolean> {
  const view = ownerDocument.defaultView
  try {
    if (view?.navigator.clipboard?.writeText) {
      await view.navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the selection-based copy.
  }
  const area = ownerDocument.createElement("textarea")
  area.value = text
  area.setAttribute("readonly", "")
  area.style.position = "fixed"
  area.style.opacity = "0"
  area.style.pointerEvents = "none"
  ownerDocument.body.appendChild(area)
  area.select()
  try {
    return ownerDocument.execCommand("copy")
  } catch {
    return false
  } finally {
    area.remove()
  }
}

/** Copies an image as PNG. Needs a secure context, so the item is hidden elsewhere. */
export async function copyImageToClipboard(src: string, target: Window): Promise<boolean> {
  const view = target as Window & typeof globalThis
  if (!view.isSecureContext || !view.navigator.clipboard?.write || typeof view.ClipboardItem !== "function") return false
  try {
    const response = await view.fetch(src)
    let blob = await response.blob()
    if (blob.type !== "image/png") {
      const bitmap = await view.createImageBitmap(blob)
      const canvas = view.document.createElement("canvas")
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0)
      blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((png) => (png ? resolve(png) : reject(new Error("PNG encoding failed"))), "image/png"))
    }
    await view.navigator.clipboard.write([new view.ClipboardItem({ "image/png": blob })])
    return true
  } catch {
    return false
  }
}

export function fileNameFromUrl(url: string): string {
  try {
    const name = new URL(url).pathname.split("/").filter(Boolean).pop()
    return name ? decodeURIComponent(name) : "download"
  } catch {
    return "download"
  }
}

export function downloadUrl(url: string, ownerDocument: Document): void {
  const anchor = ownerDocument.createElement("a")
  anchor.href = url
  anchor.download = fileNameFromUrl(url)
  // A cross-origin URL ignores `download`; a new tab keeps the app in place.
  anchor.target = "_blank"
  anchor.rel = "noopener"
  ownerDocument.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

const NON_ROUTE_PREFIXES = ["/api/", "/ws", "/plugin-assets/", "/assets/"]

/** The shell route for a same-origin URL that the router serves, else null. */
export function shellRouteOf(url: string, origin: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url, origin)
  } catch {
    return null
  }
  if (parsed.origin !== origin) return null
  if (NON_ROUTE_PREFIXES.some((prefix) => parsed.pathname.startsWith(prefix))) return null
  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

export function createContextMenuRunContext(input: {
  target: Element | null
  origin?: Element | null
  surface: ContextMenuRunContext["surface"]
  document: Document
  window: Window
}): ContextMenuRunContext {
  return {
    ...input,
    origin: input.origin ?? null,
    navigate: (to) => {
      const navigate = getContextMenuConfig().navigate
      if (navigate) navigate(to)
      else input.window.location.assign(to)
    },
    copyText: (text) => copyTextToClipboard(text, input.document),
  }
}

// ── Built-in providers ───────────────────────────────────────────────────────

function openInNewTab(url: string, view: Window) {
  view.open(url, "_blank", "noopener,noreferrer")
}

export const linkProvider: ContextMenuProvider<LinkSubject> = {
  id: "builtin:link",
  kind: "link",
  match: (element) => {
    const href = hrefOf(element)
    return href ? { element, href, text: element.textContent?.trim() ?? "" } : null
  },
  getItems: (link, ctx) => {
    const route = shellRouteOf(link.href, ctx.window.location.origin)
    const download = link.element.hasAttribute("download")
    return [
      {
        id: "link-open",
        label: "Open link",
        icon: "ph-bold ph-arrow-square-out",
        run: (run) => {
          if (route && !download) run.navigate(route)
          else (link.element as HTMLElement).click()
        },
      },
      { id: "link-open-tab", label: "Open link in new tab", icon: "ph-bold ph-browsers", run: (run) => openInNewTab(link.href, run.window) },
      { id: "link-copy", label: "Copy link", icon: "ph-bold ph-link", run: (run) => { void run.copyText(link.href) } },
    ]
  },
}

const MEDIA_NOUN: Record<MediaSubject["kind"], string> = { image: "image", video: "video", audio: "audio" }

function mediaProvider(kind: MediaSubject["kind"]): ContextMenuProvider<MediaSubject> {
  return {
    id: `builtin:${kind}`,
    kind,
    match: (element) => {
      const media = mediaOf(element)
      return media?.kind === kind ? media : null
    },
    getItems: (media, ctx) => {
      const noun = MEDIA_NOUN[media.kind]
      const items: ContextMenuItem[] = [
        { id: `${kind}-open`, label: `Open ${noun} in new tab`, icon: "ph-bold ph-arrow-square-out", run: (run) => openInNewTab(media.src, run.window) },
        { id: `${kind}-save`, label: `Save ${noun}`, icon: "ph-bold ph-download-simple", run: (run) => downloadUrl(media.src, run.document) },
      ]
      if (kind === "image" && ctx.window.isSecureContext) {
        items.push({ id: "image-copy", label: "Copy image", icon: "ph-bold ph-copy", run: (run) => { void copyImageToClipboard(media.src, run.window) } })
      }
      if (!media.src.startsWith("data:") && !media.src.startsWith("blob:")) {
        items.push({ id: `${kind}-copy-url`, label: `Copy ${noun} address`, icon: "ph-bold ph-link", run: (run) => { void run.copyText(media.src) } })
      }
      return items
    },
  }
}

export const selectionProvider: ContextMenuProvider<SelectionSubject> = {
  id: "builtin:selection",
  kind: "selection",
  match: () => null,
  getItems: (selection) => [
    { id: "selection-copy", label: "Copy", icon: "ph-bold ph-copy", shortcut: "Ctrl+C", run: (run) => { void run.copyText(selection.text) } },
  ],
}

/** Back, Forward, Reload and Copy page link, rendered as an icon row. */
export const pageProvider: ContextMenuProvider<null> = {
  id: "builtin:page",
  kind: "page",
  match: () => null,
  getItems: (_subject, ctx) => {
    const navigation = (ctx.window as Window & { navigation?: { canGoBack?: boolean; canGoForward?: boolean } }).navigation
    return [
      { id: "page-back", label: "Back", icon: "ph-bold ph-arrow-left", shortcut: "Alt+←", disabled: navigation?.canGoBack === false, run: (run) => run.window.history.back() },
      { id: "page-forward", label: "Forward", icon: "ph-bold ph-arrow-right", shortcut: "Alt+→", disabled: navigation?.canGoForward === false, run: (run) => run.window.history.forward() },
      { id: "page-reload", label: "Reload", icon: "ph-bold ph-arrow-clockwise", shortcut: "Ctrl+R", run: (run) => run.window.location.reload() },
      { id: "page-copy-link", label: "Copy page link", icon: "ph-bold ph-link", run: (run) => { void run.copyText(run.window.location.href) } },
    ]
  },
}

export const BUILTIN_CONTEXT_MENU_PROVIDERS: readonly ContextMenuProvider[] = [
  linkProvider,
  mediaProvider("image"),
  mediaProvider("video"),
  mediaProvider("audio"),
  selectionProvider,
  pageProvider,
]

/** Idempotent: built-ins keep fixed ids, so re-registration replaces them. */
export function registerBuiltinContextMenuProviders(): void {
  for (const provider of BUILTIN_CONTEXT_MENU_PROVIDERS) registerContextMenuProvider(provider)
}
