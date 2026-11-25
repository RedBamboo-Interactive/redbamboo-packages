const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { pathToFileURL } = require("node:url")

// Server-rendered MarkdownRenderer: a host-rendered fenced block replaces only a registered language in
// authored text; without a provider, for user text and for other languages the output is what it was.
// MarkdownRenderer reads only window.location.origin from the UI environment.
globalThis.window = { location: { origin: "http://127.0.0.1" } }
globalThis.document = { body: {} }

async function main() {
  const packageRoot = path.resolve(__dirname, "../..")
  const scratch = process.env.REDLEAF_SCRATCH_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "chat-host-blocks-"))
  const { createServer } = await import(pathToFileURL(require.resolve("vite")))
  const server = await createServer({ configFile: false, root: __dirname, logLevel: "error",
    cacheDir: path.join(scratch, "host-blocks-vite-cache"),
    server: { middlewareMode: true, hmr: false, fs: { allow: [path.resolve(packageRoot, "../..")] } },
    ssr: { noExternal: [/^@redbamboo\//] },
    resolve: { dedupe: ["react", "react-dom"] },
  })
  try {
    const { render } = await server.ssrLoadModule(path.join(__dirname, "cases.tsx"))
    const report = "Before\n\n```nova-report\ndone ad7278d0: shipped\n```\n"
    const code = "```ts\nconst a = 1\n```\n"
    const plain = render(report)

    assert.match(plain, /<pre/, "no provider: the block stays a pre")
    assert.doesNotMatch(plain, /chat-host-block/)

    const hosted = render(report, { provider: true })
    assert.match(hosted, /data-slot="chat-host-block" data-language="nova-report"/)
    assert.match(hosted, /data-test="report"/)
    assert.ok(hosted.includes('<section data-test="report" data-language="nova-report">&quot;done ad7278d0: shipped&quot;</section>'),
      "the renderer receives the authored source, as Code Copy reads it")
    assert.doesNotMatch(hosted, /<pre/)
    assert.match(hosted, /Before/, "surrounding text still renders")

    assert.equal(render(report, { provider: true, empty: true }), plain, "an empty registry changes nothing")
    assert.equal(render(code, { provider: true }), render(code), "an unregistered language renders as before")

    const typed = render(report, { provider: true, userText: true })
    assert.doesNotMatch(typed, /chat-host-block/, "user-typed text never becomes a widget")
    assert.equal(typed, render(report, { userText: true }))

    const menu = render(code, { leafMenu: true })
    assert.notEqual(menu, render(code), "the context menu wraps code blocks, so the comparison below means something")
    assert.equal(render(code, { provider: true, leafMenu: true }), menu, "context-menu code blocks unchanged with a provider")
    assert.match(render(report, { provider: true, leafMenu: true }), /chat-host-block/, "a registered block wins over the code-block menu")
    assert.doesNotMatch(render(report, { provider: true, leafMenu: true }), /<pre/)
    console.log("host blocks: 10 checks passed")
  } finally {
    await server.close()
  }
}
main().catch(error => { console.error(error); process.exit(1) })
