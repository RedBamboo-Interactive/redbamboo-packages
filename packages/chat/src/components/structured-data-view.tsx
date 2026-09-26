import { useState, type ReactNode } from "react"
import { JsonHighlight } from "@redbamboo/utility"
import { humanizeJsonKey, isImageJsonField, isTechnicalJsonKey, type StructuredJson } from "../lib/structured-data"
import { ExpandableText } from "./tool-output/shared"

interface Props {
  value: StructuredJson
  rawJson: string
  resolveImageSrc?: (src: string) => string | undefined
}

export function StructuredDataView({ value, rawJson, resolveImageSrc }: Props) {
  let prettyJson = rawJson
  try { prettyJson = JSON.stringify(JSON.parse(rawJson), null, 2) } catch { /* already faithful text */ }

  return (
    <div data-slot="structured-data-view" className="structured-data-view">
      <StructuredValue value={value} depth={0} resolveImageSrc={resolveImageSrc} />
      <details className="structured-data-disclosure">
        <summary>Raw JSON</summary>
        <div className="structured-data-raw">
          <ExpandableText content={prettyJson}>
            {visible => <JsonHighlight json={visible} />}
          </ExpandableText>
        </div>
      </details>
    </div>
  )
}

function StructuredValue({ value, depth, resolveImageSrc }: {
  value: StructuredJson
  depth: number
  resolveImageSrc?: (src: string) => string | undefined
}) {
  if (Array.isArray(value)) return <ArrayValue value={value} depth={depth} resolveImageSrc={resolveImageSrc} />
  if (value !== null && typeof value === "object") return <ObjectValue value={value} depth={depth} resolveImageSrc={resolveImageSrc} />
  return <ScalarValue value={value} />
}

function ObjectValue({ value, depth, resolveImageSrc }: {
  value: { [key: string]: StructuredJson }
  depth: number
  resolveImageSrc?: (src: string) => string | undefined
}) {
  const entries = Object.entries(value)
  if (entries.length === 0) return <EmptyState>No parameters</EmptyState>

  const primary = entries.filter(([key]) => !isTechnicalJsonKey(key))
  const technical = entries.filter(([key]) => isTechnicalJsonKey(key))

  return (
    <div className="structured-data-stack">
      {primary.map(([key, entry]) => (
        <Field key={key} name={key} value={entry} depth={depth} resolveImageSrc={resolveImageSrc} />
      ))}
      {technical.length > 0 && (
        <details className="structured-data-disclosure">
          <summary>
            Technical details
            <span className="structured-data-count">{technical.length}</span>
          </summary>
          <div className="structured-data-disclosure-body">
            {technical.map(([key, entry]) => (
              <Field key={key} name={key} value={entry} depth={depth} resolveImageSrc={resolveImageSrc} compact />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function Field({ name, value, depth, resolveImageSrc, compact = false }: {
  name: string
  value: StructuredJson
  depth: number
  resolveImageSrc?: (src: string) => string | undefined
  compact?: boolean
}) {
  const complex = Array.isArray(value) || (value !== null && typeof value === "object")
  const label = humanizeJsonKey(name)

  if (complex) {
    return (
      <section className="structured-data-card structured-data-section">
        <div className="structured-data-label">{label}</div>
        <StructuredValue value={value} depth={depth + 1} resolveImageSrc={resolveImageSrc} />
      </section>
    )
  }

  return (
    <div className={`structured-data-card${compact ? " is-compact" : ""}`}>
      <div className="structured-data-label">{label}</div>
      <ScalarValue value={value} compact={compact} />
      {isImageJsonField(name, value) && (
        <ImagePreview src={value} alt={label} resolveImageSrc={resolveImageSrc} />
      )}
    </div>
  )
}

function ArrayValue({ value, depth, resolveImageSrc }: {
  value: StructuredJson[]
  depth: number
  resolveImageSrc?: (src: string) => string | undefined
}) {
  if (value.length === 0) return <EmptyState>Nothing here</EmptyState>
  return (
    <div className="structured-data-stack">
      {value.map((entry, index) => {
        const complex = Array.isArray(entry) || (entry !== null && typeof entry === "object")
        return complex ? (
          <section key={index} className="structured-data-card structured-data-array-item">
            <div className="structured-data-label">Item {index + 1}</div>
            <StructuredValue value={entry} depth={depth + 1} resolveImageSrc={resolveImageSrc} />
          </section>
        ) : (
          <div key={index} className="structured-data-card is-compact">
            <ScalarValue value={entry} compact />
          </div>
        )
      })}
    </div>
  )
}

function ScalarValue({ value, compact = false }: { value: string | number | boolean | null; compact?: boolean }) {
  if (value === null || value === "") return <span className="structured-data-empty-inline">Not set</span>
  if (typeof value === "boolean") {
    return (
      <span className={`structured-data-boolean${value ? " is-true" : ""}`}>
        {value ? "Yes" : "No"}
      </span>
    )
  }
  if (typeof value === "number") return <span className="structured-data-number">{value.toLocaleString()}</span>

  const long = value.length > 80 || value.includes("\n")
  return (
    <p
      className={`structured-data-value${long && !compact ? " is-long" : ""}`}
    >
      {value}
    </p>
  )
}

function ImagePreview({ src, alt, resolveImageSrc }: { src: string; alt: string; resolveImageSrc?: (src: string) => string | undefined }) {
  const [failed, setFailed] = useState(false)
  const resolved = resolveImageSrc?.(src) ?? src
  if (failed) return null
  return (
    <img
      src={resolved}
      alt={alt}
      loading="lazy"
      className="structured-data-image"
      onError={() => setFailed(true)}
    />
  )
}

function EmptyState({ children }: { children: ReactNode }) {
  return <p className="structured-data-empty">{children}</p>
}
