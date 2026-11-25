import { createContext, useContext, type ComponentType, type ReactNode } from "react"

/** What a host block renderer receives: the fenced block's authored source, as it streams in. */
export interface ChatBlockProps {
  /** The block's text exactly as authored, without the fences. While a turn streams it can end mid-line. */
  source: string
  /** The block's info-string language, lower case. */
  language: string
}

/** Fenced block languages a host renders itself, mapped to their components. */
export type ChatBlockRenderers = Readonly<Record<string, ComponentType<ChatBlockProps>>>

const ChatBlockRenderersContext = createContext<ChatBlockRenderers | null>(null)

/**
 * Lets a host render its own fenced blocks (```nova-report …```) in authored messages. Only blocks whose
 * language is registered change; every other block, and every user-typed message, renders as before.
 * The transcript keeps the plain source, so copy, export and other clients still read the lines.
 * Pass a stable object: a new one re-creates the Markdown components.
 */
export function ChatBlockRenderersProvider({ renderers, children }: { renderers: ChatBlockRenderers; children: ReactNode }) {
  return <ChatBlockRenderersContext.Provider value={renderers}>{children}</ChatBlockRenderersContext.Provider>
}

export function useChatBlockRenderers(): ChatBlockRenderers | null {
  return useContext(ChatBlockRenderersContext)
}
