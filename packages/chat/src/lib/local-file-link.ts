export interface LocalFileLink {
  filePath: string
  line?: number
  column?: number
}

function decodeHref(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Parse the local Windows paths emitted by coding agents in Markdown links. */
export function parseLocalFileLink(href?: string): LocalFileLink | null {
  if (!href) return null

  let value = decodeHref(href.trim())
  if (/^file:\/\//i.test(value)) {
    value = value.replace(/^file:\/\/\/?/i, "")
    if (/^\/[A-Za-z]:[\\/]/.test(value)) value = value.slice(1)
  }

  let line: number | undefined
  let column: number | undefined
  const hashLocation = value.match(/#L(\d+)(?::(\d+))?$/i)
  if (hashLocation) {
    line = Number(hashLocation[1])
    column = hashLocation[2] ? Number(hashLocation[2]) : undefined
    value = value.slice(0, -hashLocation[0].length)
  } else {
    const suffixLocation = value.match(/:(\d+)(?::(\d+))?$/)
    if (suffixLocation) {
      line = Number(suffixLocation[1])
      column = suffixLocation[2] ? Number(suffixLocation[2]) : undefined
      value = value.slice(0, -suffixLocation[0].length)
    }
  }

  if (!/^[A-Za-z]:[\\/]/.test(value)) return null
  return { filePath: value, line, column }
}
