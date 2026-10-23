import { useLayoutEffect, useRef, useState } from "react"
import { useUiEnvironment } from "../../ui-environment"
import { captureScroll, resyncScrollListeners, restoreScroll, type ScrollRecord } from "./scroll-memory"

interface HostMemory {
  scroll: ScrollRecord[]
  focus: HTMLElement | null
}

const memory = new WeakMap<HTMLElement, HostMemory>()

/**
 * A detached element that content is portalled into once and that is never
 * recreated. Layout code moves it between slots instead of moving the content,
 * so React never remounts what it holds.
 */
export function useStableHost(slot: string, style: string): HTMLDivElement {
  const environment = useUiEnvironment()
  const [host] = useState(() => {
    const element = environment.document.createElement("div")
    element.dataset.slot = slot
    element.style.cssText = style
    return element
  })
  return host
}

/**
 * Lends a stable host a place in the DOM. Removing a node from the document
 * resets its scroll offsets and drops focus, so both are recorded when the slot
 * goes away and put back when the host lands in its next slot.
 */
export function HostSlot({ host, slot }: { host: HTMLElement; slot: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    element.appendChild(host)
    const saved = memory.get(host)
    if (saved) {
      memory.delete(host)
      restoreScroll(saved.scroll)
      const active = host.ownerDocument.activeElement
      if (saved.focus?.isConnected && (!active || active === host.ownerDocument.body)) saved.focus.focus({ preventScroll: true })
      resyncScrollListeners(host)
    }
    return () => {
      if (host.isConnected) {
        const active = host.ownerDocument.activeElement
        memory.set(host, {
          scroll: captureScroll(host),
          focus: active instanceof HTMLElement && host.contains(active) ? active : null,
        })
      }
      if (host.parentElement === element) element.removeChild(host)
    }
  }, [host])
  return <div ref={ref} data-slot={slot} style={{ display: "contents" }} />
}
