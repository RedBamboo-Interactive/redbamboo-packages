import React, { useEffect, useMemo, useState } from "react"
import { createRoot } from "react-dom/client"
import { EntityInteractionProvider, EntityPresentationProvider, type EntityCardPresentation } from "@redbamboo/ui"
import { ArtifactsPanel } from "../../src/components/artifacts-panel"
import { useArtifacts } from "../../src/hooks/use-artifacts"
import type { Artifact, ArtifactOrigin } from "../../src/lib/artifacts"
import { FakeArtifactServer, makeArtifact, type Seed } from "./data"
import "./fixture.css"

const query = new URLSearchParams(location.search)
const mode = query.get("mode") === "sheet" ? "sheet" : "dock"
const width = Number(query.get("w") ?? 420)
const hidden = (query.get("hide") ?? "").split(",").filter(Boolean) as ArtifactOrigin[]
const initial = query.get("data") ?? "full"

document.documentElement.classList.toggle("dark", query.get("theme") !== "light")
if (query.get("accent")) document.documentElement.dataset.accent = query.get("accent")!

const server = new FakeArtifactServer(initial === "empty" ? [] : undefined)
server.maxLimit = Number(query.get("pageSize")) || 500
if (query.get("fail")) server.failNext = Number(query.get("fail"))

const log = {
  jumps: [] as string[],
  inspected: [] as string[],
  opened: [] as string[],
  mounts: 0,
}

const test = {
  server,
  log,
  setConversation: (_key: string) => {},
  refresh: async () => {},
  reload: async () => {},
  add: (seed: Seed) => { server.add(makeArtifact(seed)) },
}
;(window as unknown as { artifactsTest: typeof test }).artifactsTest = test

const ENTITY_VISUALS: Record<string, { icon: string; color: string; subtitle: string }> = {
  page: { icon: "ph-bold ph-file-text", color: "var(--color-accent-teal)", subtitle: "Page" },
  person: { icon: "ph-bold ph-user", color: "var(--color-domain-presence)", subtitle: "Person" },
  task: { icon: "ph-bold ph-check-square", color: "var(--color-accent-gold)", subtitle: "Task" },
  agent: { icon: "ph-bold ph-robot", color: "var(--color-accent-purple)", subtitle: "Agent" },
  "quality-mode": { icon: "ph-bold ph-sliders", color: "var(--color-domain-technology)", subtitle: "Quality mode" },
}
const resolvePresentation = async (request: { id: string; typeSlug?: string; name?: string }): Promise<EntityCardPresentation | null> => {
  const visual = ENTITY_VISUALS[request.typeSlug ?? ""]
  if (!visual) return null
  return { entity: { id: request.id, typeSlug: request.typeSlug!, name: request.name ?? request.id }, subtitle: visual.subtitle, visual: { icon: visual.icon, color: visual.color } }
}

// What a host such as Nova supplies: its own mapping for session-relative targets.
const resolveTarget = (artifact: Artifact): string | null => {
  if (artifact.target.startsWith("/ai-session/input-attachments/")) return artifact.target.replace("/ai-session/input-attachments/", "/api/apps/nova/attachments/")
  if (/^https?:\/\//i.test(artifact.target) || artifact.target.startsWith("/api/")) return artifact.target
  return null
}
const resolveImageSrc = (src: string) => /^[A-Za-z]:[\\/]/.test(src) ? `/api/files?path=${encodeURIComponent(src)}` : undefined
const resolveFileLink = (path: string, opts?: { line?: number }) =>
  path.startsWith("C:/Projects/atlas/") ? () => { log.opened.push(`${path}${opts?.line ? `:${opts.line}` : ""}`) } : undefined

function App() {
  const [conversation, setConversation] = useState("conversation-1")
  const state = useArtifacts({ conversationKey: conversation, load: server.load })
  useEffect(() => { log.mounts++ }, [])
  useEffect(() => {
    test.setConversation = setConversation
    test.refresh = () => state.refresh()
    test.reload = () => state.reload()
  })
  const inspect = useMemo(() => ({ inspectedEntityId: undefined, inspect: ({ entity }: { entity: { id: string; typeSlug: string } }) => { log.inspected.push(`${entity.typeSlug}/${entity.id}`) } }), [])

  return (
    <EntityPresentationProvider resolve={resolvePresentation}>
      <EntityInteractionProvider inspectedEntityId={inspect.inspectedEntityId} inspect={inspect.inspect}>
        <div className="flex h-screen min-w-0">
          {mode === "dock" && (
            <div className="min-w-0 flex-1 p-6 text-sm text-text-muted">
              <p className="font-medium text-contrast">Conversation</p>
              <p className="mt-1 max-w-sm">The chat stays mounted beside the dock panel.</p>
            </div>
          )}
          <aside
            data-testid="dock"
            style={{ width: mode === "sheet" ? "100%" : width }}
            className="flex min-h-0 shrink-0 flex-col border-l border-border-subtle bg-surface-elevated"
          >
            <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
              <i className="ph-bold ph-squares-four text-text-muted" aria-hidden="true" />
              <h2 className="flex-1 text-sm font-medium text-contrast">Artifacts</h2>
              <button type="button" aria-label="Close" className="flex size-7 items-center justify-center rounded-md text-text-muted hover:bg-overlay-10">
                <i className="ph-bold ph-x" aria-hidden="true" />
              </button>
            </header>
            <ArtifactsPanel
              state={state}
              onRetry={state.reload}
              hiddenOrigins={hidden}
              resolveTarget={resolveTarget}
              resolveImageSrc={resolveImageSrc}
              resolveFileLink={resolveFileLink}
              onJumpToMessage={uid => { log.jumps.push(uid) }}
            />
          </aside>
        </div>
      </EntityInteractionProvider>
    </EntityPresentationProvider>
  )
}

createRoot(document.getElementById("root")!).render(<App />)
