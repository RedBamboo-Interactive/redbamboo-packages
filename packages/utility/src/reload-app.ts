const RELOAD_PARAM = "_reload"

/** A full-navigation URL that also cache-busts the shell/plugin discovery request. */
export function buildAppReloadUrl(href: string, token: number | string = Date.now()): string {
  const url = new URL(href)
  url.searchParams.set(RELOAD_PARAM, String(token))
  return url.toString()
}

/** Reload an installed PWA without depending on browser chrome or pull-to-refresh. */
export function reloadApp(): void {
  window.location.replace(buildAppReloadUrl(window.location.href))
}
