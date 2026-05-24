import { useState, useEffect, useCallback } from "react"
import { Button } from "@redbamboo/ui"
import { useCommand } from "./use-command"
import type { AppShellNova } from "./app-shell-types"
import "./nova-button.css"

const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)

function NovaButton({ url, apiUrl }: AppShellNova) {
  const [pendingCount, setPendingCount] = useState(0)

  const openNova = useCallback(() => {
    const a = document.createElement("a")
    a.href = url
    a.target = "_blank"
    a.rel = "noopener"
    a.click()
  }, [url])

  useEffect(() => {
    const base = apiUrl ?? url
    const controller = new AbortController()

    function fetchPending() {
      fetch(`${base}/api/discussions/pending`, { signal: controller.signal })
        .then((r) => r.json())
        .then((d) => setPendingCount(d.count ?? 0))
        .catch(() => {})
    }

    fetchPending()
    const interval = setInterval(fetchPending, 30_000)
    return () => {
      controller.abort()
      clearInterval(interval)
    }
  }, [url, apiUrl])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.code === "Space") {
        e.preventDefault()
        openNova()
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [openNova])

  useCommand("app-shell:nova", {
    label: "Open Nova",
    group: "App",
    shortcut: isMac ? "⌃Space" : "Ctrl+Space",
    keywords: ["ai", "companion", "chat", "assistant"],
    action: openNova,
  })

  return (
    <Button
      variant="ghost"
      size="icon"
      data-slot="nova-button"
      onClick={openNova}
      title={`Open Nova${pendingCount > 0 ? ` (${pendingCount} unread)` : ""}`}
      className="nova-button"
    >
      <i className="fa-solid fa-star" />
      {pendingCount > 0 && (
        <span className="nova-indicator" />
      )}
    </Button>
  )
}

export { NovaButton }
