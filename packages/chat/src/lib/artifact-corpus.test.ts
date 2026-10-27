// Agreement test between the chat renderer's own link predicates and the
// artifact-extraction golden corpus.
//
// The corpus is the byte-for-byte (LF-normalized) copy of
//   T:/Projects/redcompute/tests/Fixtures/artifact-extraction-cases.json
// as committed in RedCompute `b7f015e`. RedCompute's C# extractor (Markdig)
// and this renderer are two implementations of one rule set; this test keeps
// the renderer side honest. For every corpus case whose artifacts come from a
// Markdown link or image in visible user/assistant text, the Markdown is
// parsed with the renderer's own parser (react-markdown + remark-gfm, the same
// plugins and `urlTransform` as `MarkdownRenderer`), every link/image target is
// classified with the renderer's predicates, and the result must equal the
// corpus's expected `kind` (and `internal` flag).
//
// Cases that are not Markdown in visible text (attachments, voice, payloads,
// tool-write files) are the server's alone and are skipped here.
//
// Editing the corpus is deliberate on both sides: the content hash below must
// be updated together with the RedCompute copy. If a predicate disagrees with
// the corpus, do not "fix" either side from here; report the case.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { parseEntityEmbedHref, parseEntityHref } from "@redbamboo/utility/entity-links"
import { isImageUrl } from "./event-image.ts"
import { canonicalizeLeafLinkHref, isExternalWebLink, isInternalLeafLink } from "./external-web-link.ts"
import { parseLocalFileLink } from "./local-file-link.ts"
import { isVideoSrc } from "./media-kind.ts"
import { isRedLeafAssetPath } from "./media-url.ts"
import { stripHiddenMessageEnvelopes } from "./message-content.ts"
import { isUnsafeLinkHref, remarkUserText } from "./user-markdown.ts"

/** SHA-256 of the corpus with CRLF normalized to LF (identical for RedCompute `b7f015e`). */
const CORPUS_SHA256 = "afcda0192788b309523b64cdf4a1c5db3918069529d1159c3d818739a20c1072"
const REDCOMPUTE_COMMIT = "b7f015e"
const REDCOMPUTE_PATH = "tests/Fixtures/artifact-extraction-cases.json"
const REDCOMPUTE_CHECKOUT = "T:/Projects/redcompute"
const CORPUS_FILE = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "artifact-extraction-cases.json")

/** The origin the renderer treats as "this server" when deciding internal links. */
const CURRENT_ORIGIN = "http://127.0.0.1:18804"

const hashLf = (text: string) => createHash("sha256").update(text.replace(/\r\n/g, "\n"), "utf8").digest("hex")

interface CorpusRecord {
  role: string
  eventType: string
  content: string | null
}

interface CorpusExpected {
  key: string
  kind: string
  origin: string
  target: string
  internal?: boolean | null
}

interface CorpusCase {
  name: string
  records: CorpusRecord[]
  expected: CorpusExpected[]
}

const corpusText = readFileSync(CORPUS_FILE, "utf8")
const corpus: CorpusCase[] = JSON.parse(corpusText)

test("the corpus is the RedCompute b7f015e file, unedited", () => {
  assert.equal(hashLf(corpusText), CORPUS_SHA256)
  assert.equal(corpus.length, 47)
})

test("the corpus equals the RedCompute b7f015e blob when that checkout is available", { skip: !existsSync(join(REDCOMPUTE_CHECKOUT, ".git")) }, () => {
  let blob: string
  try {
    blob = execFileSync("git", ["-C", REDCOMPUTE_CHECKOUT, "show", `${REDCOMPUTE_COMMIT}:${REDCOMPUTE_PATH}`], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })
  } catch {
    return // commit not present in this checkout; the pinned hash above still guards the copy
  }
  assert.equal(hashLf(blob), CORPUS_SHA256)
})

// --- Renderer-side classification -----------------------------------------

type Classification = { kind: string; internal: boolean }
const DROPPED = "dropped" as const

/** The renderer has no audio predicate (links to audio render as ordinary links); this is the corpus's own rule, recorded here so the test can assert nothing in the renderer claims these targets first. */
const AUDIO_EXTENSIONS = /\.(mp3|wav|m4a|flac|aac|oga|opus)(?:[?#]|$)/i

interface Ref { tag: "a" | "img"; href: string }

/**
 * Every link and image target in the Markdown, parsed exactly as
 * `MarkdownRenderer` parses it: same remark plugins, same `urlTransform`, and
 * the renderer's own `a`/`img` component slots (raw HTML is dropped, code is
 * never parsed as links, reference definitions resolve).
 */
function markdownRefs(content: string, userText: boolean): Ref[] {
  const refs: Ref[] = []
  const element = createElement(Markdown, {
    remarkPlugins: userText ? [remarkGfm, remarkUserText] : [remarkGfm],
    urlTransform: (url: string) => url,
    components: {
      // Children are returned so an image wrapped in a link is still visited.
      a: ({ href, children }: { href?: string; children?: unknown }) => { refs.push({ tag: "a", href: href ?? "" }); return children as null },
      img: ({ src }: { src?: string | Blob }) => { refs.push({ tag: "img", href: typeof src === "string" ? src : "" }); return null },
    },
    children: content,
  })
  renderToStaticMarkup(element)
  return refs
}

/**
 * What a person sees. The renderer hides the `nova-context` / `nova-prior-messages`
 * envelopes with `stripHiddenMessageEnvelopes`; `nova-event` and `task-notification`
 * carriers are drawn as their own squares, not as Markdown, so their inner text is
 * not visible prose either.
 */
function visibleText(content: string): string {
  return stripHiddenMessageEnvelopes(content)
    .replace(/<nova-event[\s\S]*?<\/nova-event>\s*/g, "")
    .replace(/<task-notification[\s\S]*?<\/task-notification>\s*/g, "")
}

/**
 * Compose the renderer's predicates in the renderer's own order
 * (`MarkdownLink` / the `img` and `p` components in streaming-text.tsx and
 * entity-embed.ts), preceded by the dangerous-scheme rule.
 */
function classify(ref: Ref): Classification | typeof DROPPED {
  const raw = ref.href
  if (!raw || isUnsafeLinkHref(raw)) return DROPPED

  if (parseEntityEmbedHref(raw)) return { kind: "entity", internal: false }
  const href = canonicalizeLeafLinkHref(raw) ?? raw
  if (parseEntityHref(href, CURRENT_ORIGIN)) return { kind: "entity", internal: false }

  if (isVideoSrc(href)) return { kind: "video", internal: false }
  if (ref.tag === "img" || isImageUrl(href)) return { kind: "image", internal: false }
  if (AUDIO_EXTENSIONS.test(href)) return { kind: "audio", internal: false }

  if (parseLocalFileLink(href)) return { kind: "document", internal: false }
  // The renderer draws any `/api/assets/...` path as an internal Leaf link; the
  // corpus calls a non-media one a document, never a link.
  if (isRedLeafAssetPath(href.split(/[?#]/)[0])) return { kind: "document", internal: false }

  if (isInternalLeafLink(href, CURRENT_ORIGIN)) return { kind: "link", internal: true }
  if (isExternalWebLink(href)) return { kind: "link", internal: false }
  return DROPPED
}

const signature = (c: Classification) => `${c.kind}|${c.internal ? "internal" : "external"}`

const TEXT_ORIGINS = new Set(["user-text", "assistant-text"])

const markdownCases = corpus.filter(testCase =>
  testCase.records.some(record => record.eventType === "text" && (record.role === "user" || record.role === "assistant") && record.content)
  && testCase.expected.every(item => TEXT_ORIGINS.has(item.origin) || item.origin === "tool-write"))

test("the corpus has Markdown-in-visible-text cases to check", () => {
  assert.ok(markdownCases.length >= 25, `expected most of the 47 cases to be Markdown cases, found ${markdownCases.length}`)
})

for (const testCase of markdownCases) {
  test(`renderer predicates agree with the corpus: ${testCase.name}`, () => {
    const refs = testCase.records.flatMap(record =>
      record.eventType === "text" && (record.role === "user" || record.role === "assistant") && record.content
        ? markdownRefs(visibleText(record.content), record.role === "user")
        : [])
    const expected = testCase.expected.filter(item => TEXT_ORIGINS.has(item.origin))

    // Every target in the text, classified by the renderer's predicates, is exactly
    // what the corpus expects (and nothing the corpus drops survives).
    const rendered = new Set<string>()
    for (const ref of refs) {
      const classification = classify(ref)
      if (classification !== DROPPED) rendered.add(signature(classification))
    }
    const wanted = new Set(expected.map(item => signature({ kind: item.kind, internal: item.internal === true })))
    assert.deepEqual([...rendered].sort(), [...wanted].sort(), `kinds found in the text of ${testCase.name}`)

    // And each expected canonical target classifies, on its own, as the corpus says.
    for (const item of expected) {
      const tag = item.kind === "image" ? "img" : "a"
      const classification = classify({ tag, href: item.target })
      assert.notEqual(classification, DROPPED, `${item.target} must not be dropped`)
      assert.equal(signature(classification as Classification), signature({ kind: item.kind, internal: item.internal === true }), `target ${item.target}`)
    }
  })
}
