const coarsePrimaryPointerQuery = "(pointer: coarse)"

export type ComposerAutoFocusMode = "desktop-only" | "always" | "never"

export function shouldAutoFocusComposer(
  ownerWindow: Window,
  mode: ComposerAutoFocusMode = "desktop-only",
): boolean {
  if (mode === "always") return true
  if (mode === "never") return false
  if (typeof ownerWindow.matchMedia !== "function") return true
  return !ownerWindow.matchMedia(coarsePrimaryPointerQuery).matches
}
