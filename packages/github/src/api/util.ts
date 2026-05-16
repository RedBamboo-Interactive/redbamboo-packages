import type { GitHubClientConfig } from "../types"

export function buildParams(
  config: GitHubClientConfig,
  extra?: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams()
  params.set("root", config.rootPath)
  if (config.repo) params.set("repo", config.repo)
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v != null) params.set(k, v)
    }
  }
  return params.toString()
}
