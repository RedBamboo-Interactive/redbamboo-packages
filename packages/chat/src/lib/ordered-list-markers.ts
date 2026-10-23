// Ordered-list markers sit outside the item, in the list's left padding, and
// the message frame clips anything wider than that padding. A fixed padding
// fits "9." but cuts the first digit of "10.", so each list declares how many
// digits its widest number has and the markdown-body CSS sizes the padding.

interface HastNode {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

/** Digits in the largest number an ordered list displays, from its start and item count. */
export function orderedListMarkerDigits(start: number, itemCount: number): number {
  // Markdown only writes non-negative starts ("0." to "999999999.").
  const first = Number.isSafeInteger(start) && start >= 0 ? start : 1
  return String(first + Math.max(itemCount, 1) - 1).length
}

function startOf(list: HastNode): number {
  return Number(list.properties?.start ?? 1)
}

function visit(node: HastNode): void {
  for (const child of node.children ?? []) {
    if (child.type !== "element") continue
    if (child.tagName === "ol") {
      const items = (child.children ?? []).filter(item => item.type === "element" && item.tagName === "li").length
      const digits = orderedListMarkerDigits(startOf(child), items)
      child.properties = { ...child.properties, style: `--marker-digits: ${digits}` }
    }
    visit(child)
  }
}

/** Rehype plugin: tells each ordered list how wide its markers are so none get clipped. */
export function rehypeOrderedListMarkers() {
  return (tree: HastNode) => visit(tree)
}
