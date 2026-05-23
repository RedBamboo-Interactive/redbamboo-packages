import { parse } from "twemoji-parser"

const CDN = "https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji@latest/black/svg/"

function svgUrl(parserUrl: string): string {
  const file = parserUrl.slice(parserUrl.lastIndexOf("/") + 1)
  const name = file.replace(".svg", "").toUpperCase()
  return `${CDN}${name}.svg`
}

export function Emojify({ text }: { text: string }) {
  const entities = parse(text)
  if (entities.length === 0) return <>{text}</>

  const parts: (string | { key: number; alt: string; src: string })[] = []
  let last = 0

  for (const e of entities) {
    if (e.indices[0] > last) {
      parts.push(text.slice(last, e.indices[0]))
    }
    parts.push({ key: e.indices[0], alt: e.text, src: svgUrl(e.url) })
    last = e.indices[1]
  }
  if (last < text.length) {
    parts.push(text.slice(last))
  }

  return (
    <>
      {parts.map(p =>
        typeof p === "string" ? p : (
          <img key={p.key} className="twemoji" alt={p.alt} src={p.src} draggable={false} style={{ display: "inline", height: "1.2em", width: "1.2em", verticalAlign: "-0.2em", margin: "0 0.05em", filter: "invert(1) drop-shadow(0 0 0.15px white) drop-shadow(0 0 0.15px white) drop-shadow(0 0 0.15px white)", opacity: 0.8 }} />
        )
      )}
    </>
  )
}
