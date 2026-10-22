import * as React from "react"
import { createRoot } from "react-dom/client"

import {
  EntityPickerProvider,
  EntityPresentationProvider,
  EntityRefField,
  EntityRefListField,
  SectionHeader,
  SettingRow,
  UiEnvironmentProvider,
  type EntityPickerItem,
  type EntityPickerSource,
  type EntityPresentationResolver,
} from "../../src/index"
import "./story.css"

function avatar(initial: string, hue: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="hsl(${hue} 45% 38%)"/><text x="32" y="42" font-family="system-ui" font-size="28" font-weight="600" text-anchor="middle" fill="white">${initial}</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

// A 0.1 s silent WAV, enough for the preview button lifecycle.
const silentWav = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA="

interface Row { id: string; slug: string; type: string; name: string; description?: string; hue?: number; icon?: string; color?: string; audio?: boolean; system?: boolean }

const db: Row[] = [
  { id: "a1", slug: "nova", type: "agent", name: "Nova", description: "Household assistant", hue: 280, system: true },
  { id: "a2", slug: "orion", type: "agent", name: "Orion", description: "Research partner", hue: 210 },
  { id: "a3", slug: "lyra", type: "agent", name: "Lyra", description: "Voice and music", hue: 340 },
  { id: "a4", slug: "atlas", type: "agent", name: "Atlas", description: "Travel planning", hue: 30 },
  { id: "v1", slug: "warm", type: "voice", name: "Warm narrator", description: "Low, calm", icon: "ph-bold ph-waveform", color: "#e6a23c", audio: true },
  { id: "v2", slug: "bright", type: "voice", name: "Bright host", description: "Upbeat", icon: "ph-bold ph-waveform", color: "#3fb8af", audio: true },
]

const listeners = new Map<string, Set<() => void>>()
const calls: string[] = []
// Tests slow resolves down to observe revalidation.
const resolveDelay = { ms: 20 }

// Confidential rows only a plugin's own endpoint lists (the Mail case).
const confidential: Row[] = [
  { id: "c1", slug: "cipher", type: "agent", name: "Cipher", description: "Owner-only agent", hue: 160 },
]

// Per-field override: its own search, the provider's resolve and subscribe.
const confidentialSearch: EntityPickerSource["search"] = async (request, signal) => {
  calls.push(`override-search:${request.query}`)
  const shared = await source.search(request, signal)
  const q = request.query.toLowerCase()
  return [...shared, ...confidential.filter((row) => !q || row.name.toLowerCase().includes(q)).map(toItem)]
}

// Fails its first resolve with a transient error, then answers normally.
let flakyFailures = 1
const flakyResolve: EntityPickerSource["resolve"] = async (request, signal) => {
  calls.push(`flaky-resolve:${request.id}`)
  if (flakyFailures-- > 0) throw new Error("502 Bad Gateway")
  return source.resolve(request, signal)
}

function toItem(row: Row): EntityPickerItem {
  return {
    entity: { id: row.id, typeSlug: row.type, name: row.name },
    slug: row.slug,
    visual: row.hue !== undefined
      ? { src: avatar(row.name[0], row.hue), fallbackText: row.name, shape: "rounded" }
      : { icon: row.icon, color: row.color },
    details: row.description ? [{ label: "Summary", value: row.description }] : undefined,
    href: `/database/entities/${row.type}/${row.id}`,
    previewAudioUrl: row.audio ? silentWav : undefined,
    trailing: row.system ? <i className="ph-bold ph-lock text-[9px] text-text-disabled" title="System entity" /> : undefined,
  }
}

const delay = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms)
  signal.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")) }, { once: true })
})

const source: EntityPickerSource = {
  async search({ type, query, limit }, signal) {
    calls.push(`search:${type}:${query}`)
    await delay(40, signal)
    const q = query.toLowerCase()
    return db.filter((row) => row.type === type && (!q || row.name.toLowerCase().includes(q))).slice(0, limit).map(toItem)
  },
  async resolve({ type, id }, signal) {
    calls.push(`resolve:${type}:${id}`)
    await delay(resolveDelay.ms, signal)
    const row = db.find((candidate) => candidate.type === type && (candidate.id === id || candidate.slug === id))
    return row ? toItem(row) : null
  },
  subscribe(type, onChange) {
    const set = listeners.get(type) ?? new Set()
    set.add(onChange)
    listeners.set(type, set)
    return () => set.delete(onChange)
  },
}

// The canonical presentation bridge contributes the subtitle on selected cards.
const presentation: EntityPresentationResolver = async (entity) => {
  const row = db.find((candidate) => candidate.id === entity.id)
  return row ? { entity: { id: row.id, typeSlug: row.type, name: row.name }, subtitle: row.description, visual: toItem(row).visual } : null
}

Object.assign(window, {
  __pickerCalls: calls,
  __setResolveDelay(ms: number) { resolveDelay.ms = ms },
  __renameEntity(id: string, name: string) {
    const row = db.find((candidate) => candidate.id === id)
    if (!row) return
    row.name = name
    for (const listener of listeners.get(row.type) ?? []) listener()
  },
})

function Story() {
  const params = new URLSearchParams(window.location.search)
  const theme = params.get("theme") ?? "dark"
  const [agent, setAgent] = React.useState<string | undefined>("nova")
  const [voices, setVoices] = React.useState<string[]>(["v1"])
  const [missing, setMissing] = React.useState<string | undefined>("deleted-agent")
  const [orphan, setOrphan] = React.useState<string | undefined>(undefined)
  const [secret, setSecret] = React.useState<string | undefined>("a2")
  const [flaky, setFlaky] = React.useState<string | undefined>("a4")

  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
  }, [theme])

  return (
    <main className="min-h-screen bg-background p-6 text-foreground sm:p-10">
      <div className="mx-auto max-w-xl rounded-2xl border border-border-subtle bg-surface-elevated p-6">
        <SectionHeader>Entity references</SectionHeader>
        <EntityPresentationProvider resolve={presentation}>
          <EntityPickerProvider source={source}>
            <SettingRow label="Bound agent" hint="Single reference stored by slug.">
              <div className="w-72" data-testid="agent-field">
                <EntityRefField targetType="agent" title="Choose an Agent" value={agent} onChange={setAgent} />
              </div>
            </SettingRow>
            <SettingRow label="Voices" hint="List reference with audio previews.">
              <div className="w-72" data-testid="voices-field">
                <EntityRefListField targetType="voice" value={voices} onChange={setVoices} />
              </div>
            </SettingRow>
            <SettingRow label="Override search" hint="Lists a confidential agent; the provider still resolves.">
              <div className="w-72" data-testid="override-field">
                <EntityRefField targetType="agent" title="Choose an Agent" value={secret} onChange={setSecret} source={{ search: confidentialSearch }} />
              </div>
            </SettingRow>
            <SettingRow label="Flaky resolve" hint="First resolve fails transiently.">
              <div className="w-72" data-testid="flaky-field">
                <EntityRefField targetType="agent" value={flaky} onChange={setFlaky} source={{ resolve: flakyResolve }} />
              </div>
            </SettingRow>
            <SettingRow label="Stale reference" hint="Points at a deleted entity.">
              <div className="w-72" data-testid="missing-field">
                <EntityRefField targetType="agent" value={missing} onChange={setMissing} />
              </div>
            </SettingRow>
          </EntityPickerProvider>
        </EntityPresentationProvider>
        <SettingRow label="No host" hint="Rendered outside any EntityPickerProvider.">
          <div className="w-72" data-testid="orphan-field">
            <EntityRefField targetType="agent" value={orphan} onChange={setOrphan} />
          </div>
        </SettingRow>
        <pre data-testid="state" className="mt-4 text-xs text-text-muted">{JSON.stringify({ agent: agent ?? null, voices, missing: missing ?? null })}</pre>
      </div>
    </main>
  )
}

const portalContainer = document.createElement("div")
document.body.append(portalContainer)

createRoot(document.getElementById("root")!).render(
  <UiEnvironmentProvider document={document} portalContainer={portalContainer}>
    <Story />
  </UiEnvironmentProvider>,
)
