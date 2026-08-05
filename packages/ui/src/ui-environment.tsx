import { createContext, useContext, type ReactNode } from "react"

export interface UiEnvironment {
  document: Document
  window: Window
  portalContainer: HTMLElement
}

const UiEnvironmentContext = createContext<UiEnvironment | null>(null)

function defaultEnvironment(): UiEnvironment {
  return { document, window, portalContainer: document.body }
}

export function UiEnvironmentProvider({
  document: ownerDocument,
  portalContainer,
  children,
}: {
  document: Document
  portalContainer?: HTMLElement
  children: ReactNode
}) {
  const value: UiEnvironment = {
    document: ownerDocument,
    window: ownerDocument.defaultView ?? window,
    portalContainer: portalContainer ?? ownerDocument.body,
  }
  return <UiEnvironmentContext.Provider value={value}>{children}</UiEnvironmentContext.Provider>
}

export function useUiEnvironment(): UiEnvironment {
  return useContext(UiEnvironmentContext) ?? defaultEnvironment()
}
