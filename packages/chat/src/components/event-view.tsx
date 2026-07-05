import { useState } from "react"
import { JsonHighlight } from "@redbamboo/utility"
import type { MessagePart } from "../types"

/** A frieze event part decoded from its tool_use carrier. */
export interface ParsedEvent {
  /** Event type key, e.g. "spotify", "steam" — first segment of the source. */
  key: string
  /** Cleaned human-readable event text. */
  text: string
  /** FontAwesome class from the resolved EventType, when known. */
  icon: string | null
  /** CSS color from the resolved EventType, when known. */
  color: string | null
  /** Structured metadata; null for legacy events persisted without it. */
  data: Record<string, unknown> | null
  /** ISO timestamp of the individual event, when the pipeline provided it. */
  timestamp?: string
}

export function parseEventPart(part: MessagePart): ParsedEvent | null {
  if (part.type !== "tool_use" || !part.toolName?.startsWith("event:")) return null
  let payload: Record<string, unknown> = {}
  if (part.toolInput) {
    try { payload = JSON.parse(part.toolInput) } catch { /* legacy or garbled — text-only */ }
  }
  const data = payload.data
  return {
    key: part.toolName.slice(6),
    text: typeof payload.event === "string" && payload.event ? payload.event : part.content || "",
    icon: typeof payload.icon === "string" ? payload.icon : null,
    color: typeof payload.color === "string" ? payload.color : null,
    data: data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : null,
    timestamp: typeof payload.timestamp === "string" ? payload.timestamp : undefined,
  }
}

export interface EventViewProps {
  event: ParsedEvent
  resolveImageSrc?: (src: string) => string | undefined
  /**
   * Resolve an event to a navigation action (e.g. open the discussion a
   * discussion-activity event points at). Return undefined when the event
   * isn't linkable — the affordance is hidden in that case.
   */
  resolveEventLink?: (event: ParsedEvent) => (() => void) | undefined
  /** Called before a resolved link fires, so the host modal can close. */
  onNavigate?: () => void
}

export function EventView({ event, resolveImageSrc, resolveEventLink, onNavigate }: EventViewProps) {
  if (event.data) {
    switch (event.key) {
      case "spotify":
      case "sonos":
        return <MusicEventView event={event} />
      case "steam":
        return <SteamEventView event={event} />
      case "location":
        return <LocationEventView event={event} />
      case "weather":
        return <WeatherEventView event={event} />
      case "discussion":
        return <DiscussionEventView event={event} resolveEventLink={resolveEventLink} onNavigate={onNavigate} />
      case "outfit":
        return <OutfitEventView event={event} resolveImageSrc={resolveImageSrc} />
      case "hue":
        return <HueEventView event={event} />
      case "device":
        return <DeviceEventView event={event} />
    }
  }
  return <GenericEventView event={event} />
}

// ── helpers ──────────────────────────────────────────────────────────

function str(data: Record<string, unknown>, key: string): string | undefined {
  const v = data[key]
  return typeof v === "string" && v ? v : undefined
}

function num(data: Record<string, unknown>, key: string): number | undefined {
  const v = data[key]
  return typeof v === "number" && Number.isFinite(v) ? v : undefined
}

function EventCard({ children }: { children: React.ReactNode }) {
  return (
    <div data-slot="event-card" className="rounded-lg border border-border-subtle bg-overlay-4 overflow-hidden">
      {children}
    </div>
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block text-[10px] font-mono px-1.5 py-0.5 rounded bg-overlay-6 text-text-muted">
      {children}
    </span>
  )
}

/** Image that removes itself entirely when the source fails to load. */
function SafeImage({ src, alt, className }: { src: string; alt: string; className: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return <img src={src} alt={alt} loading="lazy" className={className} onError={() => setFailed(true)} />
}

// ── per-type renderers ───────────────────────────────────────────────

function MusicEventView({ event }: { event: ParsedEvent }) {
  const data = event.data!
  const track = str(data, "track")
  const artist = str(data, "artist")
  const album = str(data, "album")
  const albumArt = str(data, "albumArt")
  const place = str(data, "device") ?? str(data, "room")
  const status = str(data, "status")
  const [artFailed, setArtFailed] = useState(false)

  if (!track) return <GenericEventView event={event} />

  return (
    <div data-slot="event-view" className="space-y-3">
      <EventCard>
        <div className="flex items-center gap-3 p-3">
          {albumArt && !artFailed ? (
            <img
              src={albumArt}
              alt=""
              loading="lazy"
              className="w-14 h-14 rounded-md object-cover shrink-0"
              onError={() => setArtFailed(true)}
            />
          ) : (
            <div className="w-14 h-14 rounded-md bg-overlay-6 flex items-center justify-center shrink-0">
              <i className={`${event.icon ?? "fa-solid fa-music"} text-lg text-text-disabled`} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-primary truncate">{track}</p>
            {artist && <p className="text-xs text-text-muted truncate">{artist}</p>}
            {album && <p className="text-xs text-text-disabled truncate">{album}</p>}
          </div>
        </div>
        {(place || status) && (
          <div className="flex gap-2 flex-wrap px-3 pb-3">
            {place && (
              <Tag>
                <i className="fa-solid fa-volume-high mr-1" />
                {place}
              </Tag>
            )}
            {status && status !== "playing" && <Tag>{status}</Tag>}
          </div>
        )}
      </EventCard>
    </div>
  )
}

function SteamEventView({ event }: { event: ParsedEvent }) {
  const data = event.data!
  const game = str(data, "game")
  const gameId = str(data, "gameId")
  const status = str(data, "status")
  const duration = str(data, "duration")
  const friends = Array.isArray(data.friends)
    ? (data.friends as unknown[]).filter((f): f is string => typeof f === "string")
    : []

  if (!game) return <GenericEventView event={event} />

  const shownFriends = friends.slice(0, 6)
  const extraFriends = friends.length - shownFriends.length

  return (
    <div data-slot="event-view">
      <EventCard>
        {gameId && (
          <SafeImage
            src={`https://cdn.akamai.steamstatic.com/steam/apps/${gameId}/header.jpg`}
            alt={game}
            className="w-full object-cover"
          />
        )}
        <div className="p-3 space-y-2">
          <p className="text-base font-medium text-text-primary">{game}</p>
          <div className="flex gap-2 flex-wrap">
            {status && <Tag>{status}</Tag>}
            {duration && (
              <Tag>
                <i className="fa-regular fa-clock mr-1" />
                {duration}
              </Tag>
            )}
          </div>
          {shownFriends.length > 0 && (
            <p className="text-xs text-text-muted">
              <i className="fa-solid fa-user-group mr-1.5 text-text-disabled" />
              With {shownFriends.join(", ")}
              {extraFriends > 0 ? ` +${extraFriends} more` : ""}
            </p>
          )}
        </div>
      </EventCard>
    </div>
  )
}

function LocationEventView({ event }: { event: ParsedEvent }) {
  const data = event.data!
  const lat = num(data, "lat")
  const lng = num(data, "lng")
  const label = str(data, "zone") ?? str(data, "place")
  const hasCoords = lat != null && lng != null

  return (
    <div data-slot="event-view">
      <EventCard>
        {hasCoords && (
          <iframe
            title="Location map"
            loading="lazy"
            className="w-full h-40 border-0 pointer-events-none"
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.005},${lat - 0.003},${lng + 0.005},${lat + 0.003}&layer=mapnik&marker=${lat},${lng}`}
          />
        )}
        <div className="p-3 space-y-1">
          <p className="text-sm font-medium text-text-primary">{label ?? event.text}</p>
          {hasCoords && (
            <p className="font-mono text-xs text-text-disabled">
              {lat.toFixed(4)}, {lng.toFixed(4)}
            </p>
          )}
        </div>
      </EventCard>
    </div>
  )
}

/** WMO weather code (0–99) → FontAwesome icon class. */
function wmoIcon(code: number | undefined): string {
  if (code == null) return "fa-solid fa-cloud-sun"
  if (code === 0) return "fa-solid fa-sun"
  if (code <= 2) return "fa-solid fa-cloud-sun"
  if (code === 3) return "fa-solid fa-cloud"
  if (code === 45 || code === 48) return "fa-solid fa-smog"
  if (code >= 51 && code <= 67) return "fa-solid fa-cloud-rain"
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "fa-solid fa-snowflake"
  if (code >= 80 && code <= 82) return "fa-solid fa-cloud-showers-heavy"
  if (code >= 95) return "fa-solid fa-cloud-bolt"
  return "fa-solid fa-cloud-sun"
}

function WeatherEventView({ event }: { event: ParsedEvent }) {
  const data = event.data!
  const temp = num(data, "temp")
  const condition = str(data, "condition")
  const wind = num(data, "wind")
  const precip = num(data, "precip")
  const code = num(data, "code")

  return (
    <div data-slot="event-view" className="space-y-3">
      <EventCard>
        <div className="flex items-center gap-4 p-4">
          <i className={`${wmoIcon(code)} text-3xl text-text-muted`} />
          <div className="min-w-0">
            {temp != null && <p className="text-3xl font-light text-text-primary">{Math.round(temp)}°</p>}
            {condition && <p className="text-sm text-text-muted">{condition}</p>}
          </div>
        </div>
        {(wind != null || (precip != null && precip > 0)) && (
          <div className="flex gap-2 flex-wrap px-4 pb-3">
            {wind != null && (
              <Tag>
                <i className="fa-solid fa-wind mr-1" />
                {Math.round(wind)} km/h
              </Tag>
            )}
            {precip != null && precip > 0 && (
              <Tag>
                <i className="fa-solid fa-droplet mr-1" />
                {precip.toFixed(1)} mm
              </Tag>
            )}
          </div>
        )}
      </EventCard>
      {event.text && <p className="text-xs text-text-muted font-serif">{event.text}</p>}
    </div>
  )
}

function DiscussionEventView({ event, resolveEventLink, onNavigate }: {
  event: ParsedEvent
  resolveEventLink?: (event: ParsedEvent) => (() => void) | undefined
  onNavigate?: () => void
}) {
  const data = event.data!
  const title = str(data, "title")
  const kind = str(data, "kind")
  const preview = str(data, "preview")
  const openDiscussion = resolveEventLink?.(event)

  if (!title) return <GenericEventView event={event} />

  return (
    <div data-slot="event-view">
      <EventCard>
        <div className="p-3 space-y-1.5">
          <div className="flex items-center gap-2">
            {openDiscussion ? (
              <button
                onClick={() => { onNavigate?.(); openDiscussion() }}
                className="group inline-flex items-center gap-1.5 text-sm font-medium text-text-primary hover:underline underline-offset-2 text-left min-w-0"
                title="Open discussion"
              >
                <span className="truncate">{title}</span>
                <i className="fa-solid fa-arrow-up-right-from-square text-[9px] opacity-0 group-hover:opacity-60 transition-opacity shrink-0" />
              </button>
            ) : (
              <span className="text-sm font-medium text-text-primary truncate">{title}</span>
            )}
            {kind === "archived" && <Tag>archived</Tag>}
          </div>
          {preview && <p className="text-xs font-serif text-text-muted">{preview}</p>}
        </div>
      </EventCard>
    </div>
  )
}

function OutfitEventView({ event, resolveImageSrc }: {
  event: ParsedEvent
  resolveImageSrc?: (src: string) => string | undefined
}) {
  const data = event.data!
  const asset = str(data, "asset")
  const name = str(data, "outfitName")
  const src = asset ? (resolveImageSrc?.(asset) ?? asset) : undefined

  return (
    <div data-slot="event-view">
      <EventCard>
        <div className="p-3 space-y-2 text-center">
          {src && <SafeImage src={src} alt={name ?? "Outfit"} className="max-h-64 mx-auto rounded-md object-contain" />}
          <p className="text-sm font-medium text-text-primary">{name ?? event.text}</p>
        </div>
      </EventCard>
    </div>
  )
}

function HueEventView({ event }: { event: ParsedEvent }) {
  const data = event.data!
  const room = str(data, "room")
  const on = data.on === true
  const brightness = num(data, "brightness")
  const pct = brightness != null ? Math.round((brightness / 254) * 100) : null

  if (!room) return <GenericEventView event={event} />

  return (
    <div data-slot="event-view">
      <EventCard>
        <div className="p-3 space-y-2.5">
          <div className="flex items-center gap-2">
            <i
              className="fa-solid fa-lightbulb text-sm"
              style={{ color: on ? "#FFB84D" : "var(--color-text-disabled)" }}
            />
            <span className="text-sm font-medium text-text-primary flex-1 min-w-0 truncate">{room}</span>
            <Tag>{on ? "on" : "off"}</Tag>
          </div>
          {on && pct != null && (
            <div className="flex items-center gap-2.5">
              <div className="flex-1 h-1 rounded-full bg-overlay-6 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: "#FFB84D" }} />
              </div>
              <span className="text-xs font-mono text-text-muted shrink-0">{pct}%</span>
            </div>
          )}
        </div>
      </EventCard>
    </div>
  )
}

function deviceIcon(name: string): string {
  const n = name.toLowerCase()
  if (/iphone|pixel|galaxy|phone/.test(n)) return "fa-solid fa-mobile-screen"
  if (/macbook|laptop|thinkpad/.test(n)) return "fa-solid fa-laptop"
  if (/ipad|tablet/.test(n)) return "fa-solid fa-tablet-screen-button"
  return "fa-solid fa-desktop"
}

function DeviceEventView({ event }: { event: ParsedEvent }) {
  const device = str(event.data!, "device")
  if (!device) return <GenericEventView event={event} />

  return (
    <div data-slot="event-view">
      <EventCard>
        <div className="flex items-center gap-2.5 p-3">
          <i className={`${deviceIcon(device)} text-sm text-text-muted`} />
          <span className="text-sm font-medium text-text-primary">{device}</span>
        </div>
      </EventCard>
    </div>
  )
}

function GenericEventView({ event }: { event: ParsedEvent }) {
  return (
    <div data-slot="event-view" className="space-y-3">
      <p className="text-sm text-text-primary font-serif whitespace-pre-wrap">{event.text || "No content"}</p>
      {event.data && <JsonHighlight json={JSON.stringify(event.data, null, 2)} />}
    </div>
  )
}
