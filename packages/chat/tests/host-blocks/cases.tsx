import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { configureContextMenu } from "@redbamboo/ui"
import { MarkdownRenderer } from "../../src/components/streaming-text"
import { ChatBlockRenderersProvider, type ChatBlockProps } from "../../src/components/host-blocks"

function Report({ source, language }: ChatBlockProps) {
  return <section data-test="report" data-language={language}>{JSON.stringify(source)}</section>
}
const RENDERERS = { "nova-report": Report }

export function render(content: string, options: { provider?: boolean; empty?: boolean; userText?: boolean; leafMenu?: boolean } = {}): string {
  configureContextMenu({ enabled: !!options.leafMenu })
  const body = <MarkdownRenderer content={content} userText={options.userText} />
  return renderToStaticMarkup(options.provider
    ? <ChatBlockRenderersProvider renderers={options.empty ? {} : RENDERERS}>{body}</ChatBlockRenderersProvider>
    : body)
}
