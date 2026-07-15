# Event & Tool Modal Redesign — Implementation Plan

Research date: 2026-07-05. All file/line references verified against current sources in
`redbamboo-packages` (main), `T:/Projects/nova`, and `T:/Projects/redleaf`.

---

## 0. Executive summary

Clicking a frieze square opens `PartModal` (`packages/chat/src/components/chat-message.tsx:517`).
Today, **event** parts fall through to the default `ToolInputView` branch and render the raw
`{ event, icon, color }` JSON via `JsonHighlight`; **tool output** always renders as a raw
`<pre>` / JSON block truncated at 5,000 chars (`tool-output-view.tsx`).

The backend already produces structured metadata for most events (`LivePoller.cs`,
`LocationService.cs`), and `EventInjector` persists it as an `event_data` part — **but the
metadata is dropped at three separate points before it reaches the modal**:

1. **REST serialization** — `MapParts` (`Nova/Endpoints/DiscussionEndpoints.cs:756-770`)
   projects every part to `{ type, content, toolName, toolInput }`. The `event_data` part's
   payload lives under `source` / `data`, so it arrives at the client as
   `{ type: "event_data", content: "", toolName: null, toolInput: null }`. *(Note: an earlier
   internal report claimed the data survives — it does not; the projection provably drops it.)*
2. **WebSocket broadcast** — `EventInjector.InjectAsync` (`Nova/LiveEvents.cs:51-58`) publishes
   only `{ discussionId, sessionId, content, source, senderAgentId }`. No metadata.
3. **Frontend conversion** — `formatEventMessage` (`nova/web/src/hooks/use-discussions.ts:26-37`)
   rebuilds parts from `parts[0].content` only, emitting
   `toolInput = JSON.stringify({ event, icon, color })`.

The plan: fix the three drop points so metadata rides inside the existing `toolInput` JSON
(no `@redbamboo/chat` type changes needed), enrich the backend where metadata is missing
(Hue, Outfit, Discussion, Spotify album art), seed the missing event types, then build rich
per-type renderers in `@redbamboo/chat` — a new `EventView` for events and a tool-aware
`ToolOutputView` for tool results.

---

## 1. Current architecture (verified)

### 1.1 End-to-end data flow

```
LivePoller / LocationService / endpoints
  └─ LiveEvents.PostAsync(source, content, metadata?)          LiveEvents.cs:108
       └─ EventInjector.InjectAsync(...)                       LiveEvents.cs:23-83
            ├─ persists message; when metadata present, stores
            │    parts_json = [ { type:"text", content },
            │                   { type:"event_data", source, data } ]   :31-40
            ├─ publishes WS "discussion.event"
            │    { discussionId, sessionId, content, source, senderAgentId }  :51-58  ← metadata dropped
            └─ forwards to RedCompute session (role != system)

REST GET /discussions/{id}                                     DiscussionEndpoints.cs:296-321
  └─ MapParts(partsJson, content)                              :756-775
       projects → { type, content, toolName, toolInput }              ← event_data payload dropped

nova/web  use-discussions.ts
  ├─ toChatMessages()          :115-129   DTO → MessageBlock; unknown part types coerced to "text"
  ├─ isEventMessage()          :17-22     source startsWith "event:" OR <nova-event in text
  ├─ cleanMessages()           :39-113    groups consecutive events into one block;
  │                                       parts = eventGroup.map(m => formatEventMessage(m).parts[0])
  ├─ formatEventMessage()      :26-37     → single part { type:"tool_use", toolName:"event:{key}",
  │                                         toolInput: JSON{ event, icon, color }, content }  ← metadata dropped
  └─ WS "discussion.event" handler  :561-601   builds the same part shape live

@redbamboo/chat  chat-message.tsx
  ├─ isEventPart()             :94-96     tool_use && toolName.startsWith("event:")
  ├─ getEventMeta()            :98-104    parses toolInput → { color, icon }
  ├─ getPartColor()            :106-121   event color mixed 40% toward --color-text-disabled
  ├─ PartFrieze                :451-488   event dots are rounded-full, tools rounded-[2px]
  └─ PartModal                 :517-612   events hit ToolInputView default branch → raw JSON dump
```

### 1.2 Key structures

`@redbamboo/chat` `MessagePart` (`packages/chat/src/types.ts:10-17`):

```ts
interface MessagePart {
  type: "text" | "thinking" | "tool_use" | "tool_result" | "error" | "audio"
  content: string
  toolName?: string
  toolInput?: string
  images?: ImageAttachment[]
  isPartial?: boolean
}
```

Nova `MessagePartDto` (`nova/web/src/lib/types.ts`): `type: "text" | "tool_use" | "tool_result" | "audio"`
— no `event_data` member yet; `toChatMessages` coerces unknown types to `"text"`.

Event type resolution (`use-event-types.ts`): fetched once from `/api/apps/nova/event-types`
(served by `DiscussionEndpoints.cs:662-674` from `event-type` entities), keyed by the first
segment of the source (`"event:spotify:xyz"` → `"spotify"`), falling back to
`{ key:"default", icon:"fa-solid fa-circle-dot", color:null }`.

### 1.3 Per-source metadata inventory (backend, verified)

| Source | Type string | Metadata posted today | Available in scope but NOT posted | Content examples |
|---|---|---|---|---|
| Spotify (`LivePoller.cs:60-100`) | `spotify` | `{ track, artist, album, device }` (track-change only; pause/resume have none) | album art — **not** exposed by smart-home `FormatPlaybackState` (parses `album.name` only); requires smart-home change | `Now playing: {track} — {artist}` / `Paused playback` / `Resumed: {track} — {artist}` |
| Sonos (`:152-216`) | `sonos` | `{ room, track, artist }` (track-change + new-room; pause/resume have none) | node-sonos-http-api exposes `currentTrack.absoluteAlbumArtUri` (verify at impl time) | `Now playing in {room}: {track} — {artist}` / `{room}: Paused` |
| Hue (`:104-148`) | `hue` | *(none)* | `name` (room), `on`, `bri` (0–254), group `id`, `type` | `{name} lights turned on/off` |
| Weather (`:220-276`) | `weather` | `{ temp, condition, wind, precip, code }` (code = WMO 0–99) | — | `Temperature up to 18°C (was 15°C)` etc., multiple joined with `". "` |
| Steam (`:303-362`) | `steam` | start: `{ game, gameId, friends: string[], status:"playing" }`; stop: `{ game, status:"stopped", duration }` (duration = `"2h 15m"` string) | `personastate` | `Started playing {game} with {friends}` / `Stopped playing {game} (1h 5m)` |
| Location (`LocationService.cs:26-65`) | `location` | zone: `{ lat, lng, zone }`; place: `{ lat, lng, place }` | — | `Laurent arrived at {zone}` / `Laurent is near {place}` |
| Device (`LiveEvents.cs:100-106`) | `device` | *(none)* | `device.Name` | `Switched to {name}` |
| Discussion (`LiveEvents.cs:147-168`) | `discussion` | *(none)* | `discussionId`, `title`, preview | `Laurent in "{title}": {preview}` / `"{title}" archived` |
| Outfit (`AgentEndpoints.cs:92-150`) | `outfit` | *(none)* | `outfitId`, `outfitName`, `resolvedUrl` (asset URL, fetched at :113-119) | `Changed into "{name}"` / `Reset to base avatar` |

### 1.4 Current seeds (`T:/Projects/redleaf/seeds/event-types.json`)

Seven entries: `automation` (gold), `callback`, `device`, `goodnight` (#6E7BB8), `morning`
(#FFB800), `system`, `weather`. Entry schema:

```json
{ "typeSlug": "event-type", "slug": "event-type-{key}", "name": "…",
  "data": { "key": "…", "icon": "fa-solid fa-…", "color": "…(optional)", "description": "…" } }
```

Missing: `spotify`, `sonos`, `hue`, `steam`, `location`, `outfit`, `discussion`.

---

## 2. Phase 1 — Event type seeds (redleaf)

Add to `seeds/event-types.json`. Colors chosen to read well on the oklch dark theme, stay
distinct from the existing tool-square palette (teal = read-only, gold = mutating/shell,
purple = thinking, red = error), and survive the frieze's
`color-mix(in oklch, {color}, var(--color-text-disabled) 40%)` dimming (`chat-message.tsx:113`).

| key | name | icon | color | rationale |
|---|---|---|---|---|
| `spotify` | Spotify | `fa-brands fa-spotify` | `#1DB954` | brand green, unused elsewhere |
| `sonos` | Sonos | `fa-solid fa-volume-high` | `#4DB6AC` | lighter teal, distinct from Spotify green at dot size |
| `hue` | Hue | `fa-solid fa-lightbulb` | `#FFB84D` | warm amber (warmer than accent-gold #D4AA4F) |
| `steam` | Steam | `fa-brands fa-steam` | `#66C0F4` | Steam blue, no blue in current palette |
| `location` | Location | `fa-solid fa-location-dot` | `#E55B5B` | matches `--color-accent-red` family |
| `outfit` | Outfit | `fa-solid fa-shirt` | `#EC4899` | the existing "nova pink" (`COLOR.nova`, chat-message.tsx:46) |
| `discussion` | Discussion | `fa-solid fa-comments` | `var(--color-accent-purple)` | conversational ↔ thinking association |

Caveats:
- `fa-brands` requires the brands stylesheet — verify the Nova FA kit includes it (the
  existing seeds only use `fa-solid`). Fallback icons: `fa-solid fa-music` (spotify),
  `fa-solid fa-gamepad` (steam).
- Existing rows without a `color` fall back to `COLOR.event` orange in the frieze — fine.
- Seeds are upserted by slug (`event-type-{key}`), so re-seeding is additive and idempotent;
  confirm the redleaf seeding behavior for already-present slugs before shipping.

---

## 3. Phase 2 — Backend metadata pipeline + enrichment (Nova / smart-home)

### 3.1 Fix drop point #1: `MapParts` passthrough

`DiscussionEndpoints.cs:756-775`. Special-case `event_data` parts so the payload rides in the
existing DTO shape (no new DTO fields, no client contract break):

```csharp
private static object[] MapParts(string? partsJson, string content)
{
    if (!string.IsNullOrEmpty(partsJson))
    {
        try
        {
            return JsonSerializer.Deserialize<JsonElement[]>(partsJson)!
                .Select(p =>
                {
                    var type = p.TryGetProperty("type", out var t) ? t.GetString() : "text";
                    if (type == "event_data")
                        return (object)new
                        {
                            type,
                            // data payload serialized into content; source into toolName
                            content = p.TryGetProperty("data", out var d) ? d.GetRawText() : "",
                            toolName = p.TryGetProperty("source", out var s) ? s.GetString() : null,
                            toolInput = (string?)null,
                        };
                    return (object)new
                    {
                        type,
                        content = p.TryGetProperty("content", out var c) ? c.GetString() : "",
                        toolName = p.TryGetProperty("toolName", out var tn) ? tn.GetString() : null,
                        toolInput = p.TryGetProperty("toolInput", out var ti) ? ti.GetString() : null,
                    };
                })
                .ToArray();
        }
        catch { /* fall through */ }
    }
    return [new { type = (string?)"text", content = (string?)content, toolName = (string?)null, toolInput = (string?)null }];
}
```

The same projection is used by other endpoints if any share `MapParts` — it's a private static
in this class, so the change is contained.

### 3.2 Fix drop point #2: WS broadcast

`EventInjector.InjectAsync` (`LiveEvents.cs:51-58`) — include metadata:

```csharp
await events.PublishAsync("discussion.event", new JsonObject
{
    ["discussionId"] = discussion.Id,
    ["sessionId"] = discussion.SessionId,
    ["content"] = content,
    ["source"] = source ?? "automation",
    ["senderAgentId"] = senderAgentId,
    ["metadata"] = metadata is { } m ? JsonNode.Parse(m.GetRawText()) : null,
}, ct);
```

### 3.3 Enrichment: Spotify album art (requires smart-home change)

Verified: smart-home `SpotifyEndpoints.FormatPlaybackState`
(`T:/Projects/smart-home/src/Leaf.Plugins.SmartHome/Endpoints/SpotifyEndpoints.cs:317-369`)
parses only `album.name`; the raw Spotify response's `item.album.images` is in scope but not
surfaced. Two changes:

1. **smart-home**: in `FormatPlaybackState`, add
   `album_art = album.TryGetProperty("images", out var imgs) && imgs.GetArrayLength() > 0
   && imgs[0].TryGetProperty("url", out var u) ? u.GetString() : null` to the returned object.
2. **Nova `LivePoller.cs` (~:71-76)**: read `album_art` alongside the other fields and include
   it in the track-change metadata: `new { track, artist, album, albumArt, device }`.
   Also attach metadata to pause/resume events (`:94-96`) — at minimum
   `new { track = _lastSpotify.Track, artist = _lastSpotify.Artist, status = "paused"|"resumed" }`
   so the modal can render a card for those too.

### 3.4 Enrichment: Sonos album art (optional, same pass)

node-sonos-http-api's zone state exposes `currentTrack.absoluteAlbumArtUri`. In
`LivePoller.cs:168-180`, read it if present and post `new { room, track, artist, albumArt }`.
Mark as best-effort — verify the field on the running instance; it can be a LAN URL
(`http://{sonos-ip}:1400/…`) that only resolves on the home network. The renderer must treat
album art as optional and hide on `onError` regardless.

### 3.5 Enrichment: Hue

`LivePoller.cs:143` currently posts text only. All fields are in scope (`:118-129`):

```csharp
await live.PostAsync("hue", $"{state.Name} lights {action}",
    new { room = state.Name, id, on = state.On, brightness = bri });  // bri 0–254
```

Keep raw 0–254 in metadata; the renderer converts to percent (`Math.round(bri / 254 * 100)`).

### 3.6 Enrichment: Outfit

`AgentEndpoints.cs:130-132` — `resolvedUrl` and `outfitName` are already resolved at `:113-119`:

```csharp
_ = string.IsNullOrEmpty(outfitId)
    ? live.PostAsync("outfit", "Reset to base avatar", new { status = "reset" })
    : live.PostAsync("outfit", $"Changed into \"{outfitName ?? "new outfit"}\"",
        new { outfitId, outfitName, asset = resolvedUrl });
```

Note `resolvedUrl` may be an app-relative asset path — the frontend renderer resolves it via
the existing `resolveImageSrc` host callback (see §5.4).

### 3.7 Enrichment: Discussion activity

`LiveEvents.cs:147-168` — all three call sites have `discussionId` and `title`:

```csharp
await live.PostAsync("discussion", $"Laurent in \"{title}\": {preview}",
    new { discussionId, title, kind = "user-message", preview });
// kind = "nova-message" / "archived" for the other two
```

### 3.8 Enrichment: Device (trivial)

`LiveEvents.NoteDevice` (`:100-106`): `new { device = device.Name }`.

---

## 4. Phase 3 — Nova frontend pipeline (nova/web)

### 4.1 Types (`src/lib/types.ts`)

```ts
export interface MessagePartDto {
  type: "text" | "tool_use" | "tool_result" | "audio" | "event_data"
  content: string
  toolName?: string
  toolInput?: string
}
```

### 4.2 `toChatMessages` (`use-discussions.ts:115-129`)

The `event_data` part must survive until `formatEventMessage` runs (it runs per source
message inside `cleanMessages:45`, so per-message pairing is safe). Stash the payload on the
block's metadata rather than inventing a part type the chat package doesn't know:

```ts
function toChatMessages(messages: DiscussionMessage[]): MessageBlock[] {
  return messages.map((m) => {
    const eventDataPart = m.parts.find((p) => p.type === "event_data")
    let eventData: Record<string, unknown> | undefined
    if (eventDataPart?.content) {
      try { eventData = JSON.parse(eventDataPart.content) } catch { /* legacy/garbled — ignore */ }
    }
    return {
      id: m.messageUid ?? m.id,
      role: m.role,
      parts: m.parts
        .filter((p) => p.type !== "event_data")
        .map((p): MessagePart => ({ /* unchanged mapping */ })),
      timestamp: m.timestamp,
      senderAgentId: m.senderAgentId,
      metadata: {
        ...(m.source ? { source: m.source } : {}),
        ...(eventData ? { eventData } : {}),
      },
    }
  })
}
```

(Keep `metadata` undefined when both are absent, to preserve current behavior in
`MessageMetadata` and the `last.metadata?.source` checks.)

### 4.3 `formatEventMessage` (`use-discussions.ts:26-37`) — fix drop point #3

```ts
function formatEventMessage(m: MessageBlock, resolve?: EventResolver): MessageBlock {
  const source = (m.metadata?.source as string | undefined) ?? "event:system"
  const key = source.replace(/^event:/, "").split(":")[0] ?? "system"
  const text = m.parts[0]?.content ?? ""
  const cleaned = text.replace(/<nova-event[^>]*>([\s\S]*?)<\/nova-event>/g, "$1").trim() || text
  const eventType = resolve?.(source)
  const data = (m.metadata?.eventData as Record<string, unknown> | undefined) ?? null
  return {
    ...m,
    role: "assistant",
    parts: [{
      type: "tool_use",
      toolName: `event:${key}`,
      toolInput: JSON.stringify({
        event: cleaned,
        icon: eventType?.icon ?? null,
        color: eventType?.color ?? null,
        data,                                    // ← new
        timestamp: m.timestamp,                  // ← new: survives event-group merging
      }),
      content: cleaned,
    }],
  }
}
```

Embedding `timestamp` matters because `cleanMessages` merges consecutive event messages into
one block (`:43-49`) — the block keeps only the first message's timestamp, but each frieze dot
should show its own time in the modal.

### 4.4 WS handler (`use-discussions.ts:561-601`)

Destructure the new field and pass it through identically:

```ts
const { discussionId, content, source, senderAgentId, metadata } = event.data as {
  discussionId: string; sessionId: string; content: string; source: string;
  senderAgentId?: string; metadata?: Record<string, unknown> | null
}
// …
toolInput: JSON.stringify({
  event: cleaned, icon: eventType?.icon ?? null, color: eventType?.color ?? null,
  data: metadata ?? null, timestamp: new Date().toISOString(),
}),
```

### 4.5 Wire the new chat-package props

Where Nova renders `ChatPanel` / `ChatMessage`, pass:

- `resolveEventLink` (new, see §5.3): for `discussion` events with `data.discussionId`,
  return `() => setActiveDiscussionId(data.discussionId)`; undefined otherwise.
- `resolveImageSrc` is already a `ChatPanelProps` member — ensure Nova's implementation
  resolves app-relative asset paths (outfit assets) to absolute URLs.

`live-timeline.tsx` keeps working unchanged (it reads text + EventType only). A later polish
pass could reuse the event renderers there, but it's out of scope.

---

## 5. Phase 4 — Rich event renderers (`@redbamboo/chat`)

### 5.1 New file: `packages/chat/src/components/event-view.tsx`

```ts
export interface ParsedEvent {
  key: string                              // "spotify", "steam", … (from toolName.slice(6))
  text: string                             // cleaned human-readable event text
  icon: string | null                      // FA class from EventType
  color: string | null                     // CSS color from EventType
  data: Record<string, unknown> | null     // structured metadata; null on legacy events
  timestamp?: string                       // ISO, when the pipeline provided it
}

export function parseEventPart(part: MessagePart): ParsedEvent | null {
  if (part.type !== "tool_use" || !part.toolName?.startsWith("event:")) return null
  let payload: Record<string, unknown> = {}
  try { payload = part.toolInput ? JSON.parse(part.toolInput) : {} } catch { /* legacy */ }
  return {
    key: part.toolName.slice(6),
    text: (payload.event as string) ?? part.content ?? "",
    icon: (payload.icon as string) ?? null,
    color: (payload.color as string) ?? null,
    data: (payload.data as Record<string, unknown>) ?? null,
    timestamp: payload.timestamp as string | undefined,
  }
}

export function EventView({ event, resolveImageSrc, resolveEventLink }: {
  event: ParsedEvent
  resolveImageSrc?: (src: string) => string | undefined
  resolveEventLink?: (event: ParsedEvent) => (() => void) | undefined
}): React.ReactNode
```

Dispatch inside `EventView` (every branch renders `GenericEventView` when `data` is null,
except weather/music which can degrade gracefully field-by-field):

| key | component |
|---|---|
| `spotify`, `sonos` | `MusicEventView` |
| `steam` | `SteamEventView` |
| `location` | `LocationEventView` |
| `weather` | `WeatherEventView` |
| `discussion` | `DiscussionEventView` |
| `outfit` | `OutfitEventView` |
| `hue` | `HueEventView` |
| `device` | `DeviceEventView` |
| default (`automation`, `callback`, `system`, `morning`, `goodnight`, unknown) | `GenericEventView` |

All sub-components are private to the file; only `EventView` + `parseEventPart` are exported
(add to `packages/chat/src/index.ts` so Nova's live timeline can adopt them later).

### 5.2 Per-type layouts

Shared building blocks (reuse the visual language already in `tool-input-view.tsx`):
`Tag` (extract to a shared location or duplicate — it's 6 lines), and a new
`EventCard` wrapper: `rounded-lg border border-border-subtle bg-overlay-4 overflow-hidden`.

**`MusicEventView`** — data: `{ track?, artist?, album?, albumArt?, device?/room?, status? }`
```
┌───────────────────────────────────────────┐
│ ┌──────┐  {track}          ← text-sm font-medium, truncate
│ │ art  │  {artist}         ← text-xs text-text-muted, truncate
│ │ 56px │  {album}          ← text-xs text-text-disabled, truncate (spotify only)
│ └──────┘                                  │
├───────────────────────────────────────────┤
│  [♫ {device|room}]  [paused?]   ← Tag row │
└───────────────────────────────────────────┘
```
- Album art: `<img className="w-14 h-14 rounded-md object-cover" onError={hide}>`; when
  absent/failed, a `bg-overlay-6` square with the event icon centered.
- Status pause/resume: gold `Tag`. Missing track (legacy pause events): render `event.text`
  in serif below the card header instead of the track stack.

**`SteamEventView`** — data: `{ game?, gameId?, friends?: string[], status?, duration? }`
```
┌───────────────────────────────────────────┐
│  [header.jpg 460×215, w-full, ~aspect 2.14]│  ← only when gameId present; onError hides
├───────────────────────────────────────────┤
│  {game}                    ← text-base font-medium
│  [playing|stopped Tag] [duration Tag]     │
│  With: {friends.join(", ")}  ← text-xs, only when friends?.length
└───────────────────────────────────────────┘
```
- Header URL: `https://cdn.akamai.steamstatic.com/steam/apps/${gameId}/header.jpg`. Some
  appids 404 — mandatory `onError` state that collapses the image slot.
- `status === "stopped"` has no `gameId` (see §1.3) — text-only card with duration Tag.
- Friends list: cap visual at 6 names + `+N more` (long lists exist).

**`LocationEventView`** — data: `{ lat, lng, zone? }` or `{ lat, lng, place? }`
```
┌───────────────────────────────────────────┐
│  [map, h-40 w-full]                       │
├───────────────────────────────────────────┤
│  {zone ?? place ?? event.text}   ← font-medium
│  47.3396, 8.5177          ← font-mono text-xs text-text-disabled
└───────────────────────────────────────────┘
```
- Map: keyless OSM embed iframe:
  `https://www.openstreetmap.org/export/embed.html?bbox={lng-0.005},{lat-0.003},{lng+0.005},{lat+0.003}&layer=mapnik&marker={lat},{lng}`
  with `loading="lazy"`, `pointer-events: none` overlay optional. This loads a third-party
  resource with the user's coordinates — acceptable for a personal dashboard, but note it in
  the PR; fallback (offline / iframe blocked) is simply the text block. Alternative if the
  iframe proves flaky: single OSM raster tile computed from lat/lng at zoom 15 (also keyless).
- Coordinates row formatted to 4 decimals; guard `typeof lat === "number"`.

**`WeatherEventView`** — data: `{ temp, condition, wind, precip, code }`
```
┌───────────────────────────────────────────┐
│   {icon 2xl}   18°      ← text-3xl font-light
│                {condition}  ← text-sm text-text-muted
├───────────────────────────────────────────┤
│  [wind {wind} km/h] [precip {precip} mm]  │  ← Tag row, precip only when > 0
├───────────────────────────────────────────┤
│  {event.text}   ← the change description, text-xs font-serif
└───────────────────────────────────────────┘
```
- WMO code → FA icon map (module-level const):
  `0 → fa-sun`, `1–2 → fa-cloud-sun`, `3 → fa-cloud`, `45/48 → fa-smog`,
  `51–57 → fa-cloud-drizzle` (fallback `fa-cloud-rain` if not in kit), `61–67 → fa-cloud-rain`,
  `71–77/85–86 → fa-snowflake`, `80–82 → fa-cloud-showers-heavy`, `95–99 → fa-cloud-bolt`,
  default `fa-cloud-sun`.
- The event text matters here (it says *what changed*), so it stays visible.

**`DiscussionEventView`** — data: `{ discussionId, title, kind?, preview? }`
```
┌───────────────────────────────────────────┐
│  💬 {title}                [archived Tag?] │  ← button when resolveEventLink returns an action
│  {preview}                 ← text-xs font-serif text-text-muted, when present
└───────────────────────────────────────────┘
```
- When `resolveEventLink(event)` returns an action, the title row is a button
  (`hover:underline`, external-arrow icon on hover — same affordance as `FilePath` in
  `tool-input-view.tsx:43-57`), and it calls `onClose()` before navigating (thread an
  `onNavigate` close hook from the modal, mirroring the `openFile` pattern at
  `chat-message.tsx:549`).

**`OutfitEventView`** — data: `{ outfitId?, outfitName?, asset?, status? }`
```
┌───────────────────────────────────────────┐
│        [outfit image, max-h-64, centered] │  ← resolveImageSrc(asset) ?? asset; onError hides
│  {outfitName ?? event.text}   ← centered, font-medium
└───────────────────────────────────────────┘
```

**`HueEventView`** — data: `{ room, on, brightness }`
```
┌───────────────────────────────────────────┐
│  💡 {room}                    [on|off Tag] │  ← lightbulb icon colored #FFB84D when on,
│  ▓▓▓▓▓▓▓▓░░░░  {pct}%                     │     text-text-disabled when off
└───────────────────────────────────────────┘
```
- Brightness bar only when `on && typeof brightness === "number"`:
  a 4px `bg-overlay-6` track with a `#FFB84D` fill at `brightness/254*100`%.

**`DeviceEventView`** — data: `{ device? }` — one row: type-guessed icon
(`fa-mobile-screen` / `fa-laptop` / `fa-desktop` by simple name heuristics: iphone/pixel →
mobile, macbook/laptop → laptop, else desktop) + name in font-medium. Falls back to text.

**`GenericEventView`** (default + universal fallback):
```tsx
<div className="space-y-3">
  <p className="text-sm text-text-primary font-serif whitespace-pre-wrap">{event.text}</p>
  {event.data && <JsonHighlight json={JSON.stringify(event.data, null, 2)} />}
</div>
```
This is already strictly better than today (serif text instead of the `{event, icon, color}`
JSON dump), and shows structured data for types that gain metadata later without UI work.

### 5.3 `PartModal` integration (`chat-message.tsx:517-612`)

```tsx
function PartModal({ part, pairedResult, open, onClose, resolveFileLink, resolveImageSrc, resolveEventLink }: {
  /* existing props */
  resolveImageSrc?: (src: string) => string | undefined
  resolveEventLink?: (event: ParsedEvent) => (() => void) | undefined
})
```

- **Branch before the tool paths:** `const event = parseEventPart(part)`; when non-null:
  - **Header:** replace the square with the event's rounded dot
    (`w-3 h-3 rounded-full`, `backgroundColor: getPartColor(part)` — keeps the frieze↔modal
    shape correspondence: events are dots, tools are squares), then
    `<i className={event.icon} style={{ color: event.color ?? undefined }}/>`, capitalized
    `event.key` as the `DialogTitle`, and when `event.timestamp` is present a right-aligned
    `text-[10px] font-mono text-text-disabled` time (reuse `formatTimestamp`).
  - **Body:** `<EventView event={event} resolveImageSrc={…} resolveEventLink={…} />`.
- **Prop threading:** `ChatMessage` already receives `resolveImageSrc`; add `resolveEventLink`
  to `ChatMessageProps` and `ChatPanelProps` (`types.ts:174-231`, next to `resolveFileLink`,
  same doc-comment style), and pass both through `PartFrieze → PartModal`.
- The tool-use path (`ToolInputView` + output) is unchanged except for the new props flowing
  into `ToolOutputView` (§6).

### 5.4 `NovaEventSquare` (user-role `<nova-event>` messages, `chat-message.tsx:947-978`)

These are events embedded in *user* messages (RedCompute transcript path) and carry no
metadata. Minimal change: reuse the `GenericEventView` body so typography matches. No data
work — they stay text-only.

---

## 6. Phase 5 — Tool-aware `ToolOutputView` (`@redbamboo/chat`)

### 6.1 New signature (backward compatible — all new props optional)

```ts
interface ToolOutputViewProps {
  content: string
  isError?: boolean
  toolName?: string          // from the paired tool_use part
  toolInput?: string         // paired input JSON — file path, pattern, etc.
  resolveFileLink?: (filePath: string, opts?: { line?: number }) => (() => void) | undefined
  resolveImageSrc?: (src: string) => string | undefined
  onNavigate?: () => void    // called before a file link fires (closes the modal)
}
```

`PartModal` call sites (`chat-message.tsx:574,586,590`) pass
`toolName={part.toolName} toolInput={part.toolInput}` plus the resolvers (for the
standalone `tool_result` branch at `:586` there is no paired input — renderers must handle
`toolInput === undefined`).

Dispatch (errors always take the current red path first):

```
read            → ReadOutputView
grep            → GrepOutputView
glob | list     → FileListOutputView
bash|powershell → ShellOutputView
agent | task    → MarkdownOutputView
webfetch        → MarkdownOutputView
websearch       → WebSearchOutputView
default         → current behavior (JSON detect → JsonHighlight, else <pre>)
```

### 6.2 Shared: `HighlightedCode` + expandable truncation

- **Syntax highlighting with zero new deps:** the package already ships `react-markdown` +
  `rehype-highlight`. `HighlightedCode({ code, lang })` renders
  `<Markdown rehypePlugins={[rehypeHighlight]}>{"```" + lang + "\n" + code + "\n```"}</Markdown>`
  inside a `markdown-body` wrapper. Escape hatch: if the code itself contains a ``` fence,
  fall back to plain `<pre>` (cheap `includes("```")` check).
- **Extension → language map:** module const covering ts/tsx/js/jsx/py/cs/rs/go/json/css/
  html/md/ps1/sh/sql/yaml/toml/xml; unknown → no lang (plain).
- **Truncation upgrade (replaces the hard 5,000 cut):** keep 5,000 collapsed default, add a
  `Show more` button that expands in 20,000-char steps up to a 100,000 hard cap; footer keeps
  the `Truncated (N chars total)` note. Implemented once in a `TruncatedText`/hook shared by
  all renderers so behavior is uniform.

### 6.3 Per-tool renderers

**`ReadOutputView`**
- If the paired input's `file_path` has an image extension (png/jpg/jpeg/gif/webp/svg) and
  `resolveImageSrc(file_path)` returns a URL → render `<img>` (max-h-64, rounded, onError
  falls back to the text path). The tool result text for image reads isn't renderable, so
  this is the only image path.
- Otherwise: detect the harness's `cat -n` format (`/^\s*\d+\t/` on the first lines). When it
  matches, strip the `number\t` prefixes for highlighting and render line numbers as a
  `select-none` gutter column; when it doesn't, highlight the whole content. Language from the
  input `file_path` extension.

**`GrepOutputView`**
- Parse three shapes: `path:line:content` (content mode, `-n`), `path:content` (content, no
  `-n` — detect by whether segment 2 is numeric), and bare paths (files_with_matches).
- Group content-mode matches by file: file header row = `FilePath`-style button via
  `resolveFileLink(path)` (amber mono, arrow icon), match rows = `line#` gutter (clickable
  with `{ line }`) + content with pattern occurrences wrapped in
  `<span className="bg-accent-gold-a20 text-amber-300-a90 rounded-[2px]">`.
- Pattern highlighting: `try { new RegExp(pattern, flags) } catch` → fall back to
  literal-escaped pattern → fall back to no highlighting. Never let a bad regex throw during
  render. Windows drive letters (`T:\…`) break naive `:` splitting — split with a regex that
  ignores a single leading `[A-Za-z]:`.

**`FileListOutputView`** (Glob)
- One row per line: extension-mapped icon (`fa-file-code`, `fa-image`, `fa-file-lines`,
  `fa-folder` for trailing separators; `text-text-disabled`) + path as a `resolveFileLink`
  button. Skip the harness's trailing `(No content)` / reminder lines.

**`ShellOutputView`**
- Terminal chrome matching `ShellView` input styling (`tool-input-view.tsx:143`):
  `rounded-md bg-black/40 px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all`.
- Strip ANSI escapes (`/\x1b\[[0-9;?]*[a-zA-Z]/g`).
- Dim harness noise: lines matching `<system-reminder>`…`</system-reminder>` or
  `Exit code \d+` render `text-text-disabled`; non-zero exit code additionally gets a red Tag
  in a footer row.

**`MarkdownOutputView`** (Agent/Task results, WebFetch summaries)
- `MarkdownRenderer` (already exported from `streaming-text.tsx`) inside
  `text-sm font-serif markdown-body`. If content looks like JSON (`trimStart` starts with
  `{`/`[` and parses) → `JsonHighlight` instead (agents sometimes return structured output).

**`WebSearchOutputView`**
- The output format is loosely structured text with URLs. Heuristic, resilient: split into
  lines; a line that is (or contains) a bare URL renders as an anchor
  (`text-accent-teal`, `target="_blank" rel="noopener noreferrer"`, truncated middle); lines
  immediately preceding a URL render `font-medium` (title). Everything else: serif text.
  If no URLs found at all → current raw path. Don't over-parse; this format changes.

### 6.4 File organization

`tool-output-view.tsx` grows substantially — split into
`packages/chat/src/components/tool-output/` with `index.tsx` (dispatch + shared
`TruncatedText`/`HighlightedCode`) and one file per renderer family (`read.tsx`, `grep.tsx`,
`shell.tsx`, `markdown.tsx`, `web.tsx`). Public export surface unchanged
(`ToolOutputView` only).

---

## 7. Design system compliance checklist

- Colors: only `--color-accent-{teal,gold,purple,red}` vars, the seeded per-event hexes, and
  the existing alpha utilities (`bg-accent-*-aN`, tokens.css:328-356). New translucent needs
  use the established `rgb(from var(--color-…) r g b / α)` `@utility` pattern in
  `packages/ui/src/tokens.css` — **not** `chat.css` (known issue: chat.css doesn't reach
  consumers; custom CSS belongs in tokens.css).
- Frieze dimming: event colors pass through
  `color-mix(in oklch, {color}, var(--color-text-disabled) 40%)` (`chat-message.tsx:113`) —
  the seeded colors above were picked to stay distinguishable after that mix; verify visually
  in both themes.
- Typography: `font-serif` for human-readable content (event text, previews, markdown output),
  `font-mono` for paths/coords/code/terminal. Matches existing modal conventions.
- Surfaces: `bg-overlay-4/6/10` for cards/tags/hovers, `border-border-subtle` for dividers,
  `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle` from `@redbamboo/ui` (already imported).
- `data-slot` attributes on every new root element (`data-slot="event-view"`,
  `data-slot="event-card"`, `data-slot="tool-output"` etc.) per the repo component standard.
- Icons: FontAwesome `<i>` classes as everywhere else in the package (not Lucide — the chat
  package's existing modals all use FA).

---

## 8. Edge cases

| Case | Handling |
|---|---|
| Legacy events (persisted before this change) | `data` is null → every renderer falls back to `GenericEventView`; `parseEventPart` tolerates old `{event, icon, color}` toolInput |
| Old backend + new frontend | `metadata`/`event_data.content` absent → same null-data path; no feature detection needed |
| New backend + old published chat package | events still render via today's default branch (JSON dump) — no crash; ship chat package first to avoid this window (§9) |
| Malformed `toolInput` JSON | `parseEventPart` catch → text-only ParsedEvent |
| Partial metadata (e.g. Spotify pause: no album/art) | every field individually optional in renderers; card sections collapse |
| Image failures (album art, Steam 404 header, outfit asset, LAN-only Sonos art) | `onError` → hide image slot, never a broken-image glyph |
| OSM iframe blocked/offline | text+coords block still present under the map slot |
| Non-numeric/missing lat/lng | skip map + coords row, fall back to text |
| Steam friends list long | show 6 + `+N more` |
| Invalid regex as grep highlight pattern | escape-fallback chain, never throws (see §6.3) |
| Windows paths in grep output | drive-letter-aware `path:line:content` split |
| Output > 100k chars | hard cap + note (expansion steps up to cap) |
| ``` fences inside code being highlighted | fall back to plain `<pre>` |
| `tool_result` clicked standalone (no paired input) | all renderers handle `toolInput === undefined`; dispatch still keyed off `toolName` when the harness sets it, else default path |
| Event-group merging (`cleanMessages:43-49`) | per-part `timestamp` embedded in toolInput so merged dots keep their own time |
| `metadata` key collision — `MessageMetadata` (`chat-message.tsx:1042-1141`) lists unknown metadata keys | add `eventData` to a skip-set (or the `novaContextKeys` exclusion) so the raw object doesn't leak into the info dialog |

---

## 9. Implementation order

Each step is independently shippable and degrades gracefully:

1. **Seeds** (redleaf) — instant win: existing frieze dots/timeline get icons+colors for the
   seven new types via the existing resolution path. No code changes needed to benefit.
2. **`@redbamboo/chat`: `EventView` + `PartModal` integration + `GenericEventView`** —
   with no metadata flowing yet, every event modal already improves from a JSON dump to a
   clean text card. Changeset: **minor** (new optional props on public types). Publish.
3. **`@redbamboo/chat`: tool-aware `ToolOutputView`** — fully independent of the event work;
   can ship in the same minor. Verify with existing discussions (rich history to test against).
4. **Nova backend: pipeline fixes** (`MapParts`, WS metadata) + **enrichment** (Hue, Outfit,
   Discussion, Device; Spotify pause/resume metadata). Pure additions; old frontend ignores them.
5. **smart-home: `album_art` in `FormatPlaybackState`** + Nova `LivePoller` pickup (Spotify),
   optional Sonos `absoluteAlbumArtUri`.
6. **Nova frontend: pipeline** (types, `toChatMessages`, `formatEventMessage`, WS handler,
   `resolveEventLink` wiring) + bump `@redbamboo/chat` dependency.
7. **Polish pass:** verify frieze colors post-`color-mix` in dark and light themes; check
   `fa-brands` availability; consider reusing `EventView` in `live-timeline.tsx` (follow-up).

Testing notes: the LIVE discussion accumulates real events daily — after step 6, historical
events (null data) exercise the fallback path while new events exercise the rich path in the
same timeline, which is the exact matrix we need. For tool output, any existing coding
discussion provides Read/Grep/Bash/Agent samples.

## 10. Open questions / verify at implementation time

1. Does the Nova FA kit include `fa-brands` (spotify/steam) and `fa-cloud-drizzle`? Fallbacks listed in §2/§5.2.
2. Sonos `absoluteAlbumArtUri` — present on the running node-sonos-http-api? LAN-only URL acceptable?
3. Redleaf seeding: are existing `event-type` slugs upserted or skipped on re-seed? (Affects whether `weather` etc. can get colors added later by editing seeds.)
4. Exact WebSearch result text format in this stack — §6.3's heuristic is deliberately loose; sample a real result before tuning.
5. Whether Nova serves outfit assets at a path `resolveImageSrc` already handles, or needs a prefix added in the host callback.
