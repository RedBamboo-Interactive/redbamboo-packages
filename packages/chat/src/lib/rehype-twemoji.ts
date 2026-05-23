import { parse } from "twemoji-parser"
import type { Root, Element, RootContent } from "hast"

const CDN = "https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji@latest/black/svg/"

function svgUrl(parserUrl: string): string {
  const file = parserUrl.slice(parserUrl.lastIndexOf("/") + 1)
  const name = file.replace(".svg", "").toUpperCase()
  return `${CDN}${name}.svg`
}

const STYLE = "display:inline;height:1.2em;width:1.2em;vertical-align:-0.2em;margin:0 0.05em;filter:invert(1) drop-shadow(0 0 0.15px white) drop-shadow(0 0 0.15px white) drop-shadow(0 0 0.15px white);opacity:0.8"

function emojiImg(entity: { text: string; url: string }): Element {
  return {
    type: "element",
    tagName: "img",
    properties: {
      className: ["twemoji"],
      alt: entity.text,
      src: svgUrl(entity.url),
      draggable: "false",
      style: STYLE,
    },
    children: [],
  }
}

function walk(node: Root | Element) {
  const children = node.children as RootContent[]
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (child.type === "element") {
      walk(child)
      continue
    }
    if (child.type !== "text") continue

    const entities = parse(child.value)
    if (entities.length === 0) continue

    const spliced: RootContent[] = []
    let last = 0

    for (const e of entities) {
      if (e.indices[0] > last) {
        spliced.push({ type: "text", value: child.value.slice(last, e.indices[0]) })
      }
      spliced.push(emojiImg(e))
      last = e.indices[1]
    }
    if (last < child.value.length) {
      spliced.push({ type: "text", value: child.value.slice(last) })
    }

    children.splice(i, 1, ...spliced)
    i += spliced.length - 1
  }
}

export function rehypeTwemoji() {
  return (tree: Root) => { walk(tree) }
}
