const coarsePrimaryPointerQuery = "(pointer: coarse)"

export function shouldAutoFocusComposer(ownerWindow: Window): boolean {
  if (typeof ownerWindow.matchMedia !== "function") return true
  return !ownerWindow.matchMedia(coarsePrimaryPointerQuery).matches
}
