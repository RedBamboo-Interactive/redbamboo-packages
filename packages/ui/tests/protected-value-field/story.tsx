import * as React from "react"
import { createRoot } from "react-dom/client"

import { ProtectedValueField, SectionHeader, SettingRow } from "../../src/index"
import "./story.css"

const ROTATED = "rotated-token-0123456789abcdefghijklmnopqrstuvwxyz"

function Story() {
  const params = new URLSearchParams(window.location.search)
  const theme = params.get("theme") ?? "dark"
  const [revealed, setRevealed] = React.useState<string | null>(null)
  const [copies, setCopies] = React.useState<string[]>([])

  React.useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
  }, [theme])

  return (
    <main className="mx-auto max-w-md p-4">
      {/* Pushes the field below the fold so reveal-time scrolling is observable. */}
      <div data-testid="spacer" style={{ height: params.get("spacer") ?? "0px" }} />
      <SectionHeader>Access</SectionHeader>
      <div data-testid="token-field">
        <SettingRow label="Access Token" hint="Authenticates the standalone recovery dashboard.">
          <ProtectedValueField
            className="w-full"
            kind="token"
            status={{ configured: true, protection: "encrypted", verification: "unverified" }}
            onReplace={() => {}}
            onRotate={() => setRevealed(ROTATED)}
            revealedValue={revealed}
            onRevealedValueCopy={(result) => setCopies((items) => [...items, result])}
          />
        </SettingRow>
      </div>
      <div data-testid="failing-field">
        <SettingRow label="Failing Token">
          <ProtectedValueField
            className="w-full"
            kind="token"
            status={{ configured: true, protection: "encrypted", verification: "unverified" }}
            onRotate={() => Promise.reject(new Error("The service rejected the rotation"))}
          />
        </SettingRow>
      </div>
      <button type="button" data-testid="clear" onClick={() => setRevealed(null)}>Clear revealed value</button>
      <pre data-testid="state">{JSON.stringify({ copies })}</pre>
      <div style={{ height: "120vh" }} />
    </main>
  )
}

createRoot(document.getElementById("root")!).render(<Story />)
