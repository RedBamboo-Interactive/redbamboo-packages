// Detaching a DOM node resets the scroll offsets inside it. These helpers record
// offsets before a node is re-parented and put them back afterwards. A scroller
// that was at its end (a chat stuck to its newest message) returns to its end,
// even if content arrived meanwhile.

export type ScrollRecord = [element: Element, top: number, left: number, atEnd: boolean]

const END_TOLERANCE = 2

export function captureScroll(root: Element, into: ScrollRecord[] = []): ScrollRecord[] {
  const visit = (element: Element) => {
    if (element.scrollTop || element.scrollLeft) {
      const atEnd = element.scrollHeight - element.scrollTop - element.clientHeight <= END_TOLERANCE
      into.push([element, element.scrollTop, element.scrollLeft, atEnd])
    }
  }
  visit(root)
  for (const element of root.querySelectorAll("*")) visit(element)
  return into
}

export function restoreScroll(records: readonly ScrollRecord[]): void {
  for (const [element, top, left, atEnd] of records) {
    if (!element.isConnected) continue
    const targetTop = atEnd ? element.scrollHeight : top
    if (element.scrollTop !== targetTop) element.scrollTop = targetTop
    if (element.scrollLeft !== left) element.scrollLeft = left
  }
}

/**
 * Components often derive state from scroll events ("at the bottom", "show the
 * jump-to-latest button"). While a node is detached those listeners can see a
 * transient zero offset, so once it is back in place every scroller inside gets
 * one scroll event to re-read its real position.
 */
export function resyncScrollListeners(root: Element): void {
  const view = root.ownerDocument.defaultView
  if (!view) return
  view.requestAnimationFrame(() => {
    if (!root.isConnected) return
    for (const element of [root, ...root.querySelectorAll("*")]) {
      if (element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth) {
        element.dispatchEvent(new view.Event("scroll"))
      }
    }
  })
}
