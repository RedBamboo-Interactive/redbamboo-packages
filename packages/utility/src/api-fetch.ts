import type { RemoteConnectionStore } from "./remote-connection"

/**
 * Standard Red Suite error envelope: { ok: false, error: { code, message, details? } }.
 * Legacy shapes ({ error: "..." }, { ok: false, error: "..." }) are normalized into it.
 */
export interface ApiErrorBody {
  code: string
  message: string
  details?: unknown
}

export class ApiFetchError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown

  constructor(status: number, body: ApiErrorBody) {
    super(body.message)
    this.name = "ApiFetchError"
    this.status = status
    this.code = body.code
    this.details = body.details
  }
}

function normalizeError(status: number, raw: unknown): ApiErrorBody {
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>
    const err = obj.error
    // Canonical: { ok: false, error: { code, message } }
    if (err && typeof err === "object") {
      const e = err as Record<string, unknown>
      return {
        code: typeof e.code === "string" ? e.code : `http_${status}`,
        message: typeof e.message === "string" ? e.message : `Request failed (${status})`,
        details: e.details,
      }
    }
    // Legacy: { error: "code or message", message?: "..." }
    if (typeof err === "string") {
      return {
        code: err.includes(" ") ? `http_${status}` : err,
        message: typeof obj.message === "string" ? obj.message : err,
      }
    }
  }
  return { code: `http_${status}`, message: `Request failed (${status})` }
}

export interface ApiFetchOptions extends Omit<RequestInit, "body"> {
  /** JSON-serialized into the request body with content-type application/json. */
  json?: unknown
  /** Raw body passthrough (overrides `json`). */
  body?: BodyInit
  /** Connection store providing base URL + auth headers. Same-origin without one. */
  store?: RemoteConnectionStore
}

/**
 * Shared fetch wrapper: applies the store's base URL and auth headers, JSON-encodes
 * the body, parses the JSON response, and throws ApiFetchError with a normalized
 * { code, message, details } on non-2xx. Returns undefined for 204/empty bodies.
 */
export async function apiFetch<T = unknown>(
  path: string,
  opts: ApiFetchOptions = {},
): Promise<T> {
  const { json, body, store, headers, ...init } = opts
  const base = store?.getBaseUrl() ?? ""

  const mergedHeaders: Record<string, string> = {
    ...(store?.authHeaders() ?? {}),
    ...(headers as Record<string, string> | undefined),
  }

  let requestBody = body
  if (json !== undefined && requestBody === undefined) {
    mergedHeaders["Content-Type"] = "application/json"
    requestBody = JSON.stringify(json)
  }

  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: mergedHeaders,
    body: requestBody,
  })

  const contentType = res.headers.get("content-type") ?? ""
  const isJson = contentType.includes("application/json")

  if (!res.ok) {
    const raw = isJson ? await res.json().catch(() => null) : null
    throw new ApiFetchError(res.status, normalizeError(res.status, raw))
  }

  if (res.status === 204 || !isJson) return undefined as T
  return (await res.json()) as T
}
