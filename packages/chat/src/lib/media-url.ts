export type MediaSrcResolver = (src: string) => string | undefined

const REDLEAF_ASSET_PATH = /^\/api\/(?:assets|redleaf-asset)(?:\/|$)/i
const WINDOWS_DRIVE_PATH = /^[A-Za-z]:(?:[\\/]|%(?:2f|5c))/i
const WINDOWS_FILE_URI = /^file:\/{2,3}([A-Za-z]:(?:[\\/]|%(?:2f|5c)).*)$/i

/**
 * Recover the filesystem path that Markdown handed to its image component.
 *
 * react-markdown percent-encodes backslashes before rendering, so a path authored
 * as `C:\images\proof.png` arrives here as `C:%5Cimages%5Cproof.png`. Hosts own
 * the decision to serve local media; this only gives their resolver a consistent
 * drive-letter path regardless of how it was written in Markdown.
 */
function normalizeLocalMediaSrc(src: string): string {
  const fileUriPath = src.match(WINDOWS_FILE_URI)?.[1]
  const candidate = fileUriPath ?? src
  if (!WINDOWS_DRIVE_PATH.test(candidate)) return src

  try {
    return decodeURIComponent(candidate)
  } catch {
    // Preserve unusual literal-percent paths while still recovering the drive
    // separator that Markdown encoded.
    return candidate.replace(/%5c/gi, "\\").replace(/%2f/gi, "/")
  }
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase()
  return host === "localhost"
    || host.endsWith(".localhost")
    || host === "::1"
    || /^127(?:\.\d{1,3}){3}$/.test(host)
}

/**
 * Turn an absolute loopback RedLeaf asset URL into a same-origin URL.
 *
 * Agent transcripts are durable and may be opened through a Cloudflare origin
 * long after they were authored locally. Keeping only the RedLeaf-owned path
 * makes those media references work on both origins without changing arbitrary
 * localhost links to other services.
 */
export function canonicalizeChatMediaSrc(src: string): string {
  if (!/^https?:\/\//i.test(src)) return src

  try {
    const url = new URL(src)
    if (!isLoopbackHost(url.hostname) || !REDLEAF_ASSET_PATH.test(url.pathname)) return src
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return src
  }
}

/** Apply the host resolver first, then make RedLeaf loopback assets origin-safe. */
export function resolveChatMediaSrc(
  src: string | undefined,
  resolve?: MediaSrcResolver,
): string | undefined {
  if (!src) return src
  const normalized = normalizeLocalMediaSrc(src)
  return canonicalizeChatMediaSrc(resolve?.(normalized) ?? normalized)
}
