import * as React from "react"
import { createRoot } from "react-dom/client"

import { RunOnChoice, SectionHeader, SettingRow, UiEnvironmentProvider } from "../../src/index"
import "./story.css"

// GET /compute/nodes items, as RedCompute answers them (only the members RunOnChoice reads, plus kind).
const zero = {
  id: "local", name: "LAURENT-PC", kind: "local", isLocal: true, status: "online", confirmed: true,
  placement: { eligible: true, reason: null }, capabilities: [{ slug: "tts" }],
}
const studio = {
  id: "node_01STUDIO", name: "STUDIO", kind: "remote", isLocal: false, status: "online", confirmed: true,
  placement: { eligible: true, reason: null }, capabilities: [{ slug: "tts" }],
}
const laptop = {
  id: "node_01LAPTOP", name: "LAPTOP", kind: "remote", isLocal: false, status: "offline", confirmed: true,
  placement: { eligible: false, reason: "offline" }, capabilities: [],
}

const threeNodes = async () => ({ nodes: [zero, studio, laptop], legacyNodeId: "legacy" })
const unreadable = async () => { throw new Error("The node list answered 502") }

function Story() {
  const [single, setSingle] = React.useState<string | null>(null)
  const [picked, setPicked] = React.useState<string | null>(null)
  const [failed, setFailed] = React.useState<string | null>(null)

  React.useEffect(() => { document.documentElement.classList.add("dark") }, [])

  return (
    <main className="min-h-screen bg-background p-6 text-foreground sm:p-10">
      <div className="mx-auto max-w-xl rounded-2xl border border-border-subtle bg-surface-elevated p-6">
        <SectionHeader>Run on</SectionHeader>
        <SettingRow label="One node" hint="GET /compute/nodes lists node zero only.">
          <div data-testid="single">
            <RunOnChoice value={single} onChange={setSingle} capability={{ slug: "tts", name: "Text to speech" }} />
          </div>
        </SettingRow>
        <SettingRow label="Three nodes" hint="Two can run it; the laptop is offline.">
          <div data-testid="picker">
            <RunOnChoice value={picked} onChange={setPicked} loadNodes={threeNodes} capability={{ slug: "tts", name: "Text to speech" }} />
          </div>
        </SettingRow>
        <SettingRow label="Unreadable list" hint="The node list cannot be read.">
          <div data-testid="failed">
            <RunOnChoice value={failed} onChange={setFailed} loadNodes={unreadable} />
          </div>
        </SettingRow>
        <pre data-testid="state" className="mt-4 text-xs text-text-muted">{JSON.stringify({ single, picked, failed })}</pre>
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
