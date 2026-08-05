export type MediaSrcResolver = (src: string) => string | undefined

const REDLEAF_ASSET_PATH = /^\/api\/(?:assets|redleaf-asset)(?:\/|$)/i

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
  return canonicalizeChatMediaSrc(resolve?.(src) ?? src)
}
