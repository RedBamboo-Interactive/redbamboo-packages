import type { MessageBlock } from "../types"

/** Index of the block a "go to message" uid names: its `id`, or one of its `inputMessageUids`. -1 when it is not loaded. */
export function findFocusBlockIndex(blocks: readonly MessageBlock[], uid: string): number {
  const byId = blocks.findIndex(block => block.id === uid)
  if (byId >= 0) return byId
  return blocks.findIndex(block => block.inputMessageUids?.includes(uid))
}

const PULSE_MS = 1500
const PULSE_FILL = "color-mix(in oklab, var(--primary) 16%, transparent)"
// The fill extends 10px past the row as a spread shadow (never affects layout)
// and the ring is an outline at the same offset, so both sit clear of the text.
const PULSE_HALO = `0 0 0 10px ${PULSE_FILL}`
const PULSE_HALO_CLEAR = "0 0 0 10px transparent"
const PULSE_RING_COLOR = "color-mix(in oklab, var(--primary) 45%, transparent)"

/**
 * Transient highlight on a message row, about 1.5 s. Drawn with the Web
 * Animations API and design-token colours so it needs no stylesheet (a host
 * that does not load chat.css still shows it). With `prefers-reduced-motion`
 * the row is outlined for the same time without any fade.
 */
export function pulseMessageHighlight(element: HTMLElement): void {
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
  const previous = element.getAnimations?.().find(animation => (animation as Animation & { id: string }).id === "message-focus")
  previous?.cancel()
  const radius = "0.25rem"
  const clear = () => {
    element.style.borderRadius = ""
    element.style.backgroundColor = ""
    element.style.boxShadow = ""
    element.style.outline = ""
    element.style.outlineOffset = ""
  }
  element.style.outlineOffset = "10px"
  if (reduced || typeof element.animate !== "function") {
    element.style.borderRadius = radius
    element.style.backgroundColor = PULSE_FILL
    element.style.boxShadow = PULSE_HALO
    element.style.outline = `1px solid ${PULSE_RING_COLOR}`
    window.setTimeout(clear, PULSE_MS)
    return
  }
  const animation = element.animate(
    [
      { backgroundColor: PULSE_FILL, boxShadow: PULSE_HALO, outline: `1px solid ${PULSE_RING_COLOR}`, borderRadius: radius, offset: 0 },
      { backgroundColor: PULSE_FILL, boxShadow: PULSE_HALO, outline: `1px solid ${PULSE_RING_COLOR}`, borderRadius: radius, offset: 0.55 },
      { backgroundColor: "transparent", boxShadow: PULSE_HALO_CLEAR, outline: "1px solid transparent", borderRadius: radius, offset: 1 },
    ],
    { duration: PULSE_MS, easing: "ease-out" },
  )
  animation.id = "message-focus"
  animation.onfinish = clear
  animation.oncancel = clear
}
