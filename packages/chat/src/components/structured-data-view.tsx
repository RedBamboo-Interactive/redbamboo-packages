import { useState, type ReactNode } from "react"
import { JsonHighlight } from "@redbamboo/utility"
import { humanizeJsonKey, isImageJsonField, isTechnicalJsonKey, type StructuredJson } from "../lib/structured-data"
import { ExpandableText } from "./tool-output/shared"

// Styled with design-system utilities only: chat.css does not reach the
// plugin bundles that render this view, so custom classes would ship bare.

interface Props {
  value: StructuredJson
  rawJson: string
  resolveImageSrc?: (src: string) => string | undefined
}

type ImageResolver = ((src: string) => string | undefined) | undefined

const LONG_TEXT = 90
const IDENTIFIER = /^[\w.:/\\@#+=~-]+$/

export function StructuredDataView({ value, rawJson, resolveImageSrc }: Props) {
  let prettyJson = rawJson
  try { prettyJson = JSON.stringify(JSON.parse(rawJson), null, 2) } catch { /* already faithful text */ }

  return (
    <div data-slot="structured-data-view" className="flex min-w-0 flex-col gap-2">
      <StructuredValue value={value} resolveImageSrc={resolveImageSrc} />
      <details className="group/raw min-w-0">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded px-1 py-0.5 -mx-1 text-[11px] text-text-muted transition-colors hover:text-contrast [&::-webkit-details-marker]:hidden">
          <i className="ph-bold ph-caret-right text-[9px] transition-transform group-open/raw:rotate-90" />
          Raw JSON
        </summary>
        <div className="mt-1.5 overflow-x-auto rounded-md border border-border-subtle bg-overlay-3 px-3 py-2">
          <ExpandableText content={prettyJson}>
            {visible => <JsonHighlight json={visible} />}
          </ExpandableText>
        </div>
      </details>
    </div>
  )
}

function StructuredValue({ value, resolveImageSrc }: { value: StructuredJson; resolveImageSrc: ImageResolver }) {
  if (Array.isArray(value)) return <ArrayValue value={value} resolveImageSrc={resolveImageSrc} />
  if (isObject(value)) return <ObjectValue value={value} resolveImageSrc={resolveImageSrc} />
  return <ScalarValue value={value} />
}

/**
 * A key/value list on one shared grid: short values sit beside their key,
 * long text and nested structures take the full row beneath it. Technical
 * identifiers trail the list, dimmed, so the readable fields lead.
 */
function ObjectValue({ value, resolveImageSrc }: {
  value: { [key: string]: StructuredJson }
  resolveImageSrc: ImageResolver
}) {
  const entries = Object.entries(value)
  if (entries.length === 0) return <EmptyState>No parameters</EmptyState>

  const ordered = [
    ...entries.filter(([key]) => !isTechnicalJsonKey(key)),
    ...entries.filter(([key]) => isTechnicalJsonKey(key)),
  ]

  return (
    <dl
      data-slot="structured-data-list"
      className="m-0 grid min-w-0 grid-cols-[minmax(5rem,max-content)_minmax(0,1fr)] divide-y divide-border-subtle overflow-hidden rounded-md border border-border-subtle bg-overlay-3"
    >
      {ordered.map(([key, entry]) => (
        <Field key={key} name={key} value={entry} technical={isTechnicalJsonKey(key)} resolveImageSrc={resolveImageSrc} />
      ))}
    </dl>
  )
}

function Field({ name, value, technical, resolveImageSrc }: {
  name: string
  value: StructuredJson
  technical: boolean
  resolveImageSrc: ImageResolver
}) {
  const label = humanizeJsonKey(name)
  const keyClass = `max-w-48 text-[11px] leading-[18px] break-words ${technical ? "text-text-disabled" : "text-text-muted"}`

  if (isStacked(value)) {
    return (
      <div className="col-span-2 flex min-w-0 flex-col gap-1.5 px-3 py-2">
        <dt className={keyClass}>{label}</dt>
        <dd className="m-0 min-w-0">
          {typeof value === "string"
            ? <LongText value={value} />
            : <StructuredValue value={value} resolveImageSrc={resolveImageSrc} />}
        </dd>
      </div>
    )
  }

  return (
    <div className="col-span-2 grid grid-cols-subgrid items-baseline gap-x-4 px-3 py-1.5">
      <dt className={keyClass}>{label}</dt>
      <dd className="m-0 min-w-0">
        {isScalar(value)
          ? <ScalarValue value={value} muted={technical} />
          : <StructuredValue value={value} resolveImageSrc={resolveImageSrc} />}
        {isImageJsonField(name, value) && (
          <ImagePreview src={value} alt={label} resolveImageSrc={resolveImageSrc} />
        )}
      </dd>
    </div>
  )
}

function ArrayValue({ value, resolveImageSrc }: { value: StructuredJson[]; resolveImageSrc: ImageResolver }) {
  if (value.length === 0) return <EmptyState>None</EmptyState>

  // Short scalars read best as a row of chips; anything richer gets a numbered list.
  if (value.every(entry => isScalar(entry) && !isStacked(entry))) {
    return (
      <div data-slot="structured-data-chips" className="flex flex-wrap gap-1.5">
        {value.map((entry, index) => (
          <span key={index} className="inline-flex max-w-full items-center rounded bg-overlay-6 px-1.5 py-0.5">
            <ScalarValue value={entry as Scalar} />
          </span>
        ))}
      </div>
    )
  }

  return (
    <ol data-slot="structured-data-items" className="m-0 flex min-w-0 list-none flex-col gap-2 p-0">
      {value.map((entry, index) => (
        <li key={index} className="flex min-w-0 gap-2.5">
          <span className="w-4 shrink-0 pt-1.5 text-right font-mono text-[10px] text-text-disabled tabular-nums">
            {index + 1}
          </span>
          <div className="min-w-0 flex-1">
            {typeof entry === "string" ? <LongText value={entry} /> : <StructuredValue value={entry} resolveImageSrc={resolveImageSrc} />}
          </div>
        </li>
      ))}
    </ol>
  )
}

function ScalarValue({ value, muted = false }: { value: Scalar; muted?: boolean }) {
  if (value === null || value === "") return <span className="text-xs italic text-text-disabled">Not set</span>
  if (typeof value === "boolean") {
    return (
      <span className={`inline-flex items-center gap-1.5 text-xs ${value ? "text-accent-teal" : "text-text-muted"}`}>
        <span className={`size-1.5 rounded-full ${value ? "bg-accent-teal-a50" : "bg-overlay-20"}`} />
        {value ? "Yes" : "No"}
      </span>
    )
  }
  if (typeof value === "number") {
    return <span className="font-mono text-xs tabular-nums text-text-primary">{value.toLocaleString()}</span>
  }

  const tone = muted ? "text-text-muted" : "text-text-primary"
  if (IDENTIFIER.test(value) && /[\d/\\]/.test(value)) {
    return <span className={`font-mono text-xs break-all ${tone}`}>{value}</span>
  }
  return <span className={`text-xs leading-[18px] break-words ${tone}`}>{value}</span>
}

function LongText({ value }: { value: string }) {
  return (
    <ExpandableText content={value}>
      {visible => (
        <p className="m-0 whitespace-pre-wrap break-words font-serif text-sm leading-relaxed text-text-primary">
          {visible}
        </p>
      )}
    </ExpandableText>
  )
}

function ImagePreview({ src, alt, resolveImageSrc }: { src: string; alt: string; resolveImageSrc: ImageResolver }) {
  const [failed, setFailed] = useState(false)
  const resolved = resolveImageSrc?.(src) ?? src
  if (failed) return null
  return (
    <img
      src={resolved}
      alt={alt}
      loading="lazy"
      className="mt-2 block max-h-72 w-full rounded-md border border-border-subtle bg-overlay-3 object-contain"
      onError={() => setFailed(true)}
    />
  )
}

function EmptyState({ children }: { children: ReactNode }) {
  return <p className="m-0 text-xs italic text-text-disabled">{children}</p>
}

type Scalar = string | number | boolean | null

function isScalar(value: StructuredJson): value is Scalar {
  return value === null || typeof value !== "object"
}

function isObject(value: StructuredJson): value is { [key: string]: StructuredJson } {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

/** Values that need the full row: nested structures and prose-length text. */
function isStacked(value: StructuredJson): boolean {
  if (value === null || typeof value !== "object") {
    return typeof value === "string" && (value.length > LONG_TEXT || value.includes("\n"))
  }
  return Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0
}
