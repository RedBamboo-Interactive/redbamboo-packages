// Markdown semantics for text a person typed into the composer.
//
// Authored assistant Markdown follows CommonMark exactly. A typed message does
// not: the author pressed Enter expecting a new line, and wrote `Option<T>` or
// `<div>` expecting to see it. CommonMark folds single newlines into spaces and
// react-markdown drops raw HTML, so both would silently change what was sent.

interface MdastNode {
  type: string
  value?: string
  children?: MdastNode[]
}

const LINE_BREAK = /\r?\n/

const PHRASING_PARENTS = new Set([
  "paragraph", "heading", "emphasis", "strong", "delete", "link", "linkReference", "tableCell",
])

function splitIntoBreaks(value: string): MdastNode[] {
  const lines = value.split(LINE_BREAK)
  const nodes: MdastNode[] = []
  lines.forEach((line, index) => {
    if (index > 0) nodes.push({ type: "break" })
    if (line) nodes.push({ type: "text", value: line })
  })
  return nodes
}

function transform(node: MdastNode): void {
  if (!node.children) return
  const next: MdastNode[] = []
  for (const child of node.children) {
    // Block-level raw HTML sits among flow content, where bare text is not
    // valid; give it its own paragraph like the line the author typed.
    if (child.type === "html") {
      const literal = splitIntoBreaks(child.value ?? "")
      next.push(...(PHRASING_PARENTS.has(node.type) ? literal : [{ type: "paragraph", children: literal }]))
      continue
    }
    if (child.type === "text" && child.value && LINE_BREAK.test(child.value)) {
      next.push(...splitIntoBreaks(child.value))
      continue
    }
    transform(child)
    next.push(child)
  }
  node.children = next
}

/** Remark plugin: literal raw HTML and hard line breaks for user-typed text. */
export function remarkUserText() {
  return (tree: MdastNode) => transform(tree)
}

const UNSAFE_LINK_SCHEME = /^\s*(?:javascript|vbscript|data):/i

/** True when an href would execute script or load inline content if clicked. */
export function isUnsafeLinkHref(href: string | undefined): boolean {
  return !!href && UNSAFE_LINK_SCHEME.test(href.replace(/[\u0000-\u001f]/g, ""))
}
