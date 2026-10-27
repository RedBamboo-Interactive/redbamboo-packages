const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const os = require("node:os")
const { execFileSync } = require("node:child_process")
const { pathToFileURL } = require("node:url")
const { chromium } = require(require.resolve("playwright", { paths: [path.resolve(__dirname, "../../../testing")] }))

// Mounted shared-Chat fixture for the Artifacts panel and ChatPanel "go to message".
// Everything is served from this process (route-fulfilled SVG, WAV and a generated
// MP4), so no real Leaf media is requested. PHOSPHOR_ROOT optionally points at an
// @phosphor-icons/web package so screenshots show the icons the Leaf shell provides.

const PINK = "pink"

function svg(id, width, height) {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  const hue = hash % 360
  const hue2 = (hue + 50) % 360
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 65% 52%)"/><stop offset="1" stop-color="hsl(${hue2} 70% 30%)"/></linearGradient></defs>` +
    `<rect width="100%" height="100%" fill="url(#g)"/>` +
    `<circle cx="${width * 0.72}" cy="${height * 0.3}" r="${Math.min(width, height) * 0.14}" fill="hsl(${hue2} 90% 82%)" opacity="0.85"/>` +
    `<path d="M0 ${height} L${width * 0.35} ${height * 0.55} L${width * 0.6} ${height * 0.8} L${width * 0.8} ${height * 0.6} L${width} ${height * 0.85} L${width} ${height} Z" fill="hsl(${hue} 50% 18%)" opacity="0.7"/>` +
    `</svg>`, "utf8")
}

function wav(seconds) {
  const rate = 8000
  const samples = rate * seconds
  const data = Buffer.alloc(samples * 2)
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin(i / 9) * 6000), i * 2)
  const header = Buffer.alloc(44)
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVEfmt ", 8)
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34)
  header.write("data", 36); header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

function makeVideo(scratch) {
  const file = path.join(scratch, "artifacts-panel-clip.mp4")
  try {
    execFileSync(process.env.FFMPEG || "ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=15", "-t", "2", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-movflags", "+faststart", file])
    return fs.readFileSync(file)
  } catch {
    return null
  }
}

function ranged(route, body, contentType) {
  const header = route.request().headers().range
  const total = body.length
  if (header) {
    const [, from, to] = /bytes=(\d*)-(\d*)/.exec(header) ?? []
    const start = from ? Number(from) : 0
    const end = to ? Math.min(Number(to), total - 1) : total - 1
    return route.fulfill({ status: 206, contentType, body: body.subarray(start, end + 1), headers: { "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${total}` } })
  }
  return route.fulfill({ status: 200, contentType, body, headers: { "accept-ranges": "bytes" } })
}

async function installRoutes(context, media, requests) {
  await context.route("https://fonts.googleapis.com/**", route => route.abort())
  await context.route("**/*", async route => {
    const url = new URL(route.request().url())
    const { pathname } = url
    const href = url.href
    if (url.hostname === "127.0.0.1" && !pathname.startsWith("/api/")) return route.fallback()
    if (url.hostname !== "127.0.0.1" && !/\.(example\.com)$/.test(url.hostname)) return route.fallback()
    requests.push(`${pathname}${url.search}`)
    let match
    if ((match = /^\/api\/assets\/([^/]+)\/thumbnail$/.exec(pathname))) {
      if (match[1].startsWith("gone")) return route.fulfill({ status: 404, body: "" })
      return route.fulfill({ contentType: "image/svg+xml", body: svg(match[1], 256, 256) })
    }
    if ((match = /^\/api\/assets\/([^/]+)$/.exec(pathname))) {
      const id = match[1]
      if (id.startsWith("gone")) return route.fulfill({ status: 404, body: "" })
      if (id.endsWith(".mp4")) return media.video ? ranged(route, media.video, "video/mp4") : route.fulfill({ status: 404, body: "" })
      if (id.endsWith(".mp3")) return ranged(route, media.audio, "audio/wav")
      if (id.endsWith(".json")) return route.fulfill({ contentType: "application/json", body: "{}" })
      return route.fulfill({ contentType: "image/svg+xml", body: svg(id, 1024, 768) })
    }
    if (pathname.startsWith("/api/apps/nova/")) return route.fulfill({ contentType: "image/svg+xml", body: svg(pathname, 1024, 768) })
    if (pathname === "/api/files") return route.fulfill({ contentType: "image/svg+xml", body: svg(url.search, 1024, 768) })
    if (href.endsWith("/cat.PNG")) return route.fulfill({ contentType: "image/svg+xml", body: svg("cat", 800, 800) })
    if (href.endsWith("/demo.webm")) return media.video ? ranged(route, media.video, "video/mp4") : route.fulfill({ status: 404, body: "" })
    if (href.endsWith("/theme.mp3")) return ranged(route, media.audio, "audio/wav")
    return route.fulfill({ status: 404, body: "" })
  })
}

async function settle(page) {
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime))
    .map(a => a.finished.catch(() => {}))))
  await page.waitForFunction(() => [...document.images].every(image => image.complete))
  await page.evaluate(() => document.fonts.ready)
}

async function main() {
  const packageRoot = path.resolve(__dirname, "../..")
  const scratch = process.env.REDLEAF_SCRATCH_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "chat-artifacts-"))
  const shots = path.join(scratch, "artifacts-panel")
  fs.mkdirSync(shots, { recursive: true })
  const phosphorRoot = process.env.PHOSPHOR_ROOT && fs.realpathSync(process.env.PHOSPHOR_ROOT)
  const { createServer } = await import(pathToFileURL(require.resolve("vite")))
  const tailwind = (await import(pathToFileURL(require.resolve("@tailwindcss/vite", { paths: [path.resolve(packageRoot, "../ui")] })))).default
  const server = await createServer({
    configFile: false, root: __dirname, plugins: [tailwind()],
    cacheDir: path.join(scratch, "artifacts-panel-vite-cache"),
    resolve: { alias: { react: path.join(packageRoot, "node_modules/react"), "react-dom": path.join(packageRoot, "node_modules/react-dom") } },
    server: { host: "127.0.0.1", port: 0, fs: { allow: [path.resolve(packageRoot, "../.."), scratch, ...(phosphorRoot ? [phosphorRoot] : [])] } },
  })

  const media = { audio: wav(2), video: makeVideo(scratch) }
  let browser
  const summary = { panel: [], focus: [] }
  try {
    await server.listen()
    const origin = server.resolvedUrls.local[0]
    browser = await chromium.launch({ headless: true })

    // ---- One context (and cache) for every variant, as the Playwright guidance asks.
    const context = await browser.newContext({ deviceScaleFactor: 2 })
    const requests = []
    await installRoutes(context, media, requests)
    const errors = []

    const open = async (query, viewport) => {
      const page = await context.newPage()
      await page.setViewportSize(viewport)
      page.on("pageerror", error => errors.push(`${query}: ${error.message}`))
      page.on("console", message => { if (message.type() === "error" && !/Failed to load resource/.test(message.text())) errors.push(`${query}: ${message.text()}`) })
      await page.goto(`${origin}?${query}`)
      if (phosphorRoot) {
        for (const weight of ["regular", "bold"]) {
          await page.addStyleTag({ url: `${origin}@fs/${path.join(phosphorRoot, "src", weight, "style.css").replace(/\\/g, "/")}` })
        }
      }
      return page
    }
    const ready = async page => {
      await page.locator('[data-slot="artifacts-panel"][data-status="ready"]').waitFor()
      await settle(page)
    }

    // ================= Screenshots: 300 / 420 dock and 390x844 sheet, dark and light, pink accent =================
    const variants = [
      { name: "dock-300", query: "w=300", viewport: { width: 1100, height: 800 } },
      { name: "dock-420", query: "w=420", viewport: { width: 1100, height: 800 } },
      { name: "sheet-390x844", query: "mode=sheet", viewport: { width: 390, height: 844 } },
    ]
    for (const variant of variants) {
      for (const theme of ["dark", "light"]) {
        const page = await open(`${variant.query}&theme=${theme}&accent=${PINK}`, variant.viewport)
        await ready(page)
        // Video posters are captured lazily from the first frame.
        if (media.video) await page.waitForFunction(() => [...document.querySelectorAll('[data-kind="video"]')].every(tile => tile.querySelector("img")), null, { timeout: 8000 }).catch(() => {})
        await page.locator('[data-slot="audio-player"]').first().waitFor()
        const base = `${variant.name}-${theme}`
        await page.screenshot({ path: path.join(shots, `${base}-1-media.png`) })
        for (const [index, tab] of ["documents", "links", "entities"].entries()) {
          await page.locator(`[data-artifact-tab="${tab}"]`).click()
          await settle(page)
          await page.screenshot({ path: path.join(shots, `${base}-${index + 2}-${tab}.png`) })
        }
        // No horizontal overflow at any of these widths.
        const overflow = await page.evaluate(() => {
          const content = document.querySelector('[data-slot="artifacts-content"]')
          const panel = document.querySelector('[data-slot="artifacts-panel"]')
          return { content: content.scrollWidth - content.clientWidth, panel: panel.scrollWidth - panel.clientWidth }
        })
        assert(overflow.content <= 0 && overflow.panel <= 0, `no horizontal overflow in ${base}: ${JSON.stringify(overflow)}`)
        await page.close()
      }
    }
    summary.panel.push("screenshots: 3 widths x 2 themes x 4 tabs")

    // ================= Behaviour (420 dock, dark) =================
    {
      const page = await open(`w=420&theme=dark&accent=${PINK}`, { width: 1100, height: 800 })
      await ready(page)
      const panel = page.locator('[data-slot="artifacts-panel"]')

      // Tabs with counts, in order; each count matches the data.
      const tabText = await page.locator('[data-slot="tabs-trigger"]').allInnerTexts()
      assert.deepEqual(tabText.map(text => text.replace(/\s+/g, " ").trim()), ["Media 17", "Documents 6", "Links 5", "Entities 5"])

      // Media: 13 image tiles + 2 video tiles in the grid, 2 audio rows below it.
      assert.equal(await panel.locator('[data-slot="artifact-grid"] [data-slot="artifact-tile"]').count(), 15)
      assert.equal(await panel.locator('[data-kind="video"]').count(), 2)
      assert.equal(await panel.locator('[data-slot="artifact-audio-list"] [data-kind="audio"]').count(), 2)
      assert.equal(await panel.locator('[data-slot="audio-player"]').count(), 2)

      // Asset images use the 256 px thumbnail route; full-size files are only requested as a fallback.
      const thumbs = requests.filter(url => /\/api\/assets\/[^/]+\/thumbnail\?w=256$/.test(url))
      assert(thumbs.length >= 9, `asset thumbnails requested (${thumbs.length})`)
      assert(!requests.some(url => /^\/api\/assets\/(9df7aa11|b03c5e72|c41e90ab)\.png$/.test(url)), "no full-size fetch for an image whose thumbnail loaded")

      // Lazy images, and no broken-image glyph: a deleted image is a muted Unavailable tile.
      const images = await panel.locator('[data-slot="artifact-grid"] [data-kind="image"] img').evaluateAll(list => list.map(image => ({ lazy: image.loading, ok: image.naturalWidth > 0 })))
      assert(images.length === 12, `12 images keep a thumbnail (${images.length})`)
      assert(images.every(image => image.lazy === "lazy"), "grid images are lazy")
      assert(images.every(image => image.ok), "no broken image is left in the grid")
      assert.equal(await panel.locator('[data-slot="artifact-unavailable"]').count(), 1)
      assert.match(await panel.locator('[data-slot="artifact-unavailable"]').innerText(), /Unavailable/)
      assert(requests.includes("/api/assets/gone0001.png"), "the deleted image fell back to its full-size URL before giving up")

      // The go-to-message action: hidden at rest for a mouse, shown on hover and on keyboard focus.
      const firstTile = panel.locator('[data-kind="image"]').first()
      const jumpButton = firstTile.locator('[data-slot="artifact-go-to-message"]')
      assert.equal(await jumpButton.evaluate(node => getComputedStyle(node).opacity), "0")
      await firstTile.hover()
      await page.waitForFunction(node => getComputedStyle(node).opacity === "1", await jumpButton.elementHandle())
      await page.mouse.move(700, 600)
      // Keyboard: Tab reaches the tile button, then its go-to-message button, which shows its tooltip.
      await firstTile.getByRole("button", { name: /^Open image/ }).focus()
      await page.keyboard.press("Tab")
      assert(await jumpButton.evaluate(node => node === document.activeElement), "go to message is reachable by keyboard")
      assert.equal(await jumpButton.evaluate(node => getComputedStyle(node).opacity), "1")
      await page.locator('[data-slot="tooltip-content"]', { hasText: "Go to message" }).waitFor({ timeout: 4000 })
      await page.keyboard.press("Enter")
      const log = () => page.evaluate(() => window.artifactsTest.log)
      assert.deepEqual((await log()).jumps, ["msg-sunset"])

      // Viewer: opens over all images and videos in panel order, with details and Go to message.
      await panel.getByRole("button", { name: "Open image Sunset over the harbour" }).click()
      const viewer = page.locator('[data-slot="media-viewer"]')
      await viewer.waitFor()
      await viewer.getByLabel("Item 1 of 15").waitFor()
      const details = viewer.locator('[data-slot="artifact-viewer-details"]')
      await details.getByText("Sunset over the harbour").waitFor()
      assert.match(await details.innerText(), /Linked · 4m ago/)
      await page.keyboard.press("ArrowRight")
      await viewer.getByLabel("Item 2 of 15").waitFor()
      await details.getByText("Moodboard, warm palette").waitFor()
      await page.screenshot({ path: path.join(shots, "viewer-dock-420-dark.png") })
      await details.getByRole("button", { name: "Go to message" }).click()
      await viewer.waitFor({ state: "detached" })
      assert.equal((await log()).jumps.at(-1).startsWith("msg-"), true, "viewer jump reached the host")

      // Video opens in the viewer too (third item after the two images is the payload image; the clip is 4th).
      await panel.getByRole("button", { name: "Play video Camera fly-through" }).click()
      await viewer.locator('[data-slot="media-viewer-video"]').waitFor()
      await page.keyboard.press("Escape")
      await viewer.waitFor({ state: "detached" })

      // Documents.
      await page.locator('[data-artifact-tab="documents"]').click()
      const created = panel.locator('[data-kind="document"]', { hasText: "design.md" })
      assert.match(await created.innerText(), /Created/)
      await created.getByRole("button", { name: "Open design.md" }).click()
      assert.deepEqual((await log()).opened, ["C:/Projects/atlas/docs/design.md"])
      await panel.getByRole("button", { name: "Open entry point" }).click()
      assert.equal((await log()).opened.at(-1), "C:/Projects/atlas/src/main.ts:42")
      const attached = panel.locator('[data-kind="document"]', { hasText: "Quarterly report.pdf" })
      assert.match(await attached.innerText(), /Attached/)
      const pdf = attached.getByRole("link", { name: /Open Quarterly report\.pdf/ })
      assert.equal(await pdf.getAttribute("target"), "_blank")
      assert.equal(await pdf.getAttribute("rel"), "noopener noreferrer")
      assert.equal(await pdf.getAttribute("href"), "/api/apps/nova/attachments/a2")
      assert.match(await panel.locator('[data-kind="document"]', { hasText: "spec bundle" }).innerText(), /Shared/)

      // Links.
      await page.locator('[data-artifact-tab="links"]').click()
      const external = panel.locator('[data-slot="external-web-link"]').first()
      assert.equal(await external.getAttribute("target"), "_blank")
      assert.equal(await external.getAttribute("rel"), "noopener noreferrer")
      const internal = panel.locator('[data-slot="internal-leaf-link"]').first()
      assert.equal(await internal.getAttribute("target"), null)
      assert(await internal.locator("i.ph-leaf").count() === 1, "internal links carry the leaf chip")
      assert.match(await external.innerText(), /react\.dev/)

      // Entities go through the shell interaction provider and do not navigate.
      await page.locator('[data-artifact-tab="entities"]').click()
      const before = page.url()
      await panel.getByRole("link", { name: "Inspect Release checklist" }).click()
      assert.deepEqual((await log()).inspected, ["page/abc-1"])
      assert.equal(page.url(), before, "an inspect click stays in the page")

      // Chat stays mounted: no remount while the panel changes tabs and opens the viewer.
      assert.equal((await log()).mounts, 1)
      summary.panel.push("420 dock behaviour")
      await page.close()
    }

    // ---- Hidden origins, live deltas, epoch reset, paging, errors, narrow widths.
    {
      const page = await open("w=420&hide=tool-write", { width: 1100, height: 800 })
      await ready(page)
      await page.locator('[data-artifact-tab="documents"]').click()
      assert.equal(await page.locator('[data-slot="artifacts-panel"] [data-kind="document"]').count(), 4)
      assert.equal(await page.locator('[data-slot="artifacts-panel"] [data-kind="document"]', { hasText: "design.md" }).count(), 0)
      summary.panel.push("hidden origin")
      await page.close()
    }
    {
      const page = await open("w=420&pageSize=10", { width: 1100, height: 800 })
      await ready(page)
      const calls = await page.evaluate(() => window.artifactsTest.server.requests)
      assert(calls.length >= 4 && calls.some(call => call.cursor), `initial load paged through nextCursor (${calls.length} calls)`)
      assert.equal(await page.locator('[data-slot="artifacts-panel"] [data-slot="tabs-trigger"]').count(), 4)
      assert.equal(await page.locator('[data-slot="artifact-tab-count"]').first().innerText(), "17")

      // A live delta: a new image arrives, a held key is updated, nothing duplicates.
      await page.evaluate(() => {
        window.artifactsTest.add({ key: "asset:fresh001.png", kind: "image", origin: "assistant-image", target: "/api/assets/fresh001.png", ago: 0, title: "Just generated", uid: "msg-fresh" })
        window.artifactsTest.add({ key: "asset:9df7aa11.png", kind: "image", origin: "assistant-text", target: "/api/assets/9df7aa11.png", ago: 0.5, title: "Sunset over the harbour", uid: "msg-sunset-2", occurrences: 2 })
      })
      await page.evaluate(() => window.artifactsTest.refresh())
      await page.waitForFunction(() => document.querySelector('[data-slot="artifact-tab-count"]').textContent === "18")
      const keys = await page.locator('[data-kind="image"]').evaluateAll(list => list.map(node => node.getAttribute("data-artifact-key")))
      assert.equal(keys[0], "asset:fresh001.png")
      assert.equal(keys[1], "asset:9df7aa11.png")
      assert.equal(new Set(keys).size, keys.length, "no duplicate tiles after an overlapping delta")
      const delta = (await page.evaluate(() => window.artifactsTest.server.requests)).at(-1)
      assert(delta.sinceSequence > 0, "refresh is a delta read")

      // Clearing the conversation (new epoch) empties the panel completely.
      await page.evaluate(() => window.artifactsTest.server.clear())
      await page.evaluate(() => window.artifactsTest.refresh())
      await page.getByText("Nothing shared in this conversation yet.").waitFor()
      assert.equal(await page.locator('[data-slot="tabs-trigger"]').count(), 0, "no empty tabs")
      summary.panel.push("paging, delta merge, epoch reset")
      await page.close()
    }
    {
      const page = await open("w=420&data=empty", { width: 1100, height: 800 })
      await ready(page)
      await page.getByText("Nothing shared in this conversation yet.").waitFor()
      assert.equal(await page.locator('[data-slot="tabs-trigger"]').count(), 0)
      await page.screenshot({ path: path.join(shots, "empty-dock-420-dark.png") })
      await page.close()

      const failing = await open("w=420&fail=1", { width: 1100, height: 800 })
      await failing.locator('[data-slot="artifacts-panel"][data-status="error"]').waitFor()
      await failing.getByText("The artifact service is unreachable").waitFor()
      await failing.screenshot({ path: path.join(shots, "error-dock-420-dark.png") })
      await failing.getByRole("button", { name: "Retry" }).click()
      await failing.locator('[data-slot="artifacts-panel"][data-status="ready"]').waitFor()
      assert.equal(await failing.locator('[data-slot="tabs-trigger"]').count(), 4)

      summary.panel.push("empty and error/retry")
      await failing.close()
    }
    {
      const page = await open(`w=260&accent=${PINK}`, { width: 900, height: 700 })
      await ready(page)
      const overflow = await page.evaluate(() => {
        const content = document.querySelector('[data-slot="artifacts-content"]')
        return content.scrollWidth - content.clientWidth
      })
      assert(overflow <= 0, "260 px minimum width has no horizontal overflow")
      const columns = await page.evaluate(() => getComputedStyle(document.querySelector('[data-slot="artifact-grid"]')).gridTemplateColumns.split(" ").length)
      assert.equal(columns, 3, "three thumbnail columns at the minimum width")
      await page.screenshot({ path: path.join(shots, "dock-260-dark-1-media.png") })
      // Tabs scroll rather than clip.
      await page.locator('[data-artifact-tab="entities"]').scrollIntoViewIfNeeded()
      await page.locator('[data-artifact-tab="entities"]').click()
      await page.screenshot({ path: path.join(shots, "dock-260-dark-4-entities.png") })
      summary.panel.push("260 px")
      await page.close()
    }
    {
      // 300 px has three columns; 420 px has four (container queries on the panel, not the viewport).
      for (const [width, expected] of [[300, 3], [420, 4]]) {
        const page = await open(`w=${width}`, { width: 1300, height: 800 })
        await ready(page)
        const columns = await page.evaluate(() => getComputedStyle(document.querySelector('[data-slot="artifact-grid"]')).gridTemplateColumns.split(" ").length)
        assert.equal(columns, expected, `${width}px dock grid columns`)
        await page.close()
      }
    }

    // ================= ChatPanel go to message =================
    for (const [width, height] of [[1100, 760], [390, 844]]) {
      const page = await context.newPage()
      await page.setViewportSize({ width, height })
      page.on("pageerror", error => errors.push(`focus ${width}: ${error.message}`))
      await page.goto(`${origin}focus.html?accent=${PINK}`)
      if (phosphorRoot) {
        for (const weight of ["regular", "bold"]) {
          await page.addStyleTag({ url: `${origin}@fs/${path.join(phosphorRoot, "src", weight, "style.css").replace(/\\/g, "/")}` })
        }
      }
      await page.locator('[data-message-uid="a-149"]').waitFor()
      const scroller = page.locator('[data-slot="chat-panel"] .overflow-y-auto').first()
      const metrics = () => scroller.evaluate(node => ({ top: node.scrollTop, height: node.scrollHeight, client: node.clientHeight }))
      const atBottom = async () => { const m = await metrics(); return m.height - m.top - m.client < 6 }
      const centreOffset = uid => page.evaluate(id => {
        const scrollerNode = document.querySelector('[data-slot="chat-panel"] .overflow-y-auto')
        const node = document.querySelector(`[data-message-uid="${id}"]`)
        if (!node) return null
        const box = scrollerNode.getBoundingClientRect(); const rect = node.getBoundingClientRect()
        return Math.round(rect.top + rect.height / 2 - (box.top + box.height / 2))
      }, uid)
      const results = () => page.evaluate(() => window.focusTest.results)
      const settleFocus = () => page.waitForTimeout(700) // the 600 ms late-layout settle window is intentional

      assert(await atBottom(), "starts pinned to the bottom")
      assert.equal(await page.locator('[data-message-uid="a-21"]').count(), 0, "block 21 is outside the render window")

      // 1. Focus into a block outside the window.
      await page.evaluate(() => window.focusTest.request("a-21", 1))
      await page.locator('[data-message-uid="a-21"]').waitFor()
      await page.waitForFunction(() => window.focusTest.results.length === 1)
      assert.deepEqual((await results())[0], { uid: "a-21", nonce: 1, found: true })
      await settleFocus()
      assert(Math.abs(await centreOffset("a-21")) <= 12, `block is centred (${await centreOffset("a-21")}px off)`)
      assert(!(await atBottom()), "bottom pinning is released")
      await page.screenshot({ path: path.join(shots, `focus-${width}-1-centred.png`) })
      assert(await page.getByTitle("Scroll to bottom").isVisible(), "scroll-to-bottom is offered")

      // The pulse is a transient animation: run it again on a block that is already rendered.
      await page.evaluate(() => window.focusTest.request("a-31", 2))
      await page.waitForFunction(() => window.focusTest.results.length === 2)
      const animated = await page.locator('[data-message-uid="a-31"]').first().evaluate(node => node.getAnimations().some(animation => animation.id === "message-focus"))
      assert(animated, "a highlight animation runs on the focused row")
      await page.waitForFunction(() => !document.querySelector('[data-message-uid="a-31"]').getAnimations().some(animation => animation.id === "message-focus"), null, { timeout: 3000 })
      await settleFocus()

      // 2. Streaming keeps going: the viewport must not snap back to the bottom.
      const before = (await metrics()).top
      await page.evaluate(() => window.focusTest.stream(40))
      await page.waitForFunction(() => window.focusTest.streamed >= 40)
      await page.waitForTimeout(150)
      const during = await metrics()
      assert(Math.abs(during.top - before) <= 3, `streaming does not move the viewport (${before} -> ${during.top})`)
      assert(!(await atBottom()), "still not pinned after streaming")
      assert(Math.abs(await centreOffset("a-31")) <= 12, "the focused block is still centred after streaming")

      // 3. Reveal-earlier anchoring: scrolling up reveals older blocks without jumping.
      const anchorBefore = await page.evaluate(() => document.querySelector('[data-message-uid="a-31"]').getBoundingClientRect().top)
      const scrollBefore = (await metrics()).top
      await scroller.evaluate(node => { node.scrollTop = 120 })
      await page.waitForFunction(() => document.querySelector('[data-message-uid="a-11"]'))
      await page.waitForTimeout(250)
      const anchorAfter = await page.evaluate(() => document.querySelector('[data-message-uid="a-31"]').getBoundingClientRect().top)
      const expectedAnchor = anchorBefore + (scrollBefore - 120)
      assert(Math.abs(anchorAfter - expectedAnchor) <= 4, `reveal-earlier keeps the anchor in place (${anchorAfter} vs ${expectedAnchor})`)

      // 4. Scroll to bottom still works afterwards, and pinning resumes.
      await page.getByTitle("Scroll to bottom").click()
      await page.waitForFunction(() => {
        const node = document.querySelector('[data-slot="chat-panel"] .overflow-y-auto')
        return node.scrollHeight - node.scrollTop - node.clientHeight < 6
      })
      await page.evaluate(() => window.focusTest.stream(24))
      await page.waitForFunction(() => window.focusTest.streamed >= 64)
      await page.waitForTimeout(150)
      assert(await atBottom(), "pinned again, new content stays in view")
      assert.equal(await page.getByTitle("Scroll to bottom").count(), 0)

      // 5. A uid that is not loaded reports found: false and does not move the viewport.
      const positionBefore = (await metrics()).top
      await page.evaluate(() => window.focusTest.request("not-loaded", 3))
      await page.waitForFunction(() => window.focusTest.results.length === 3)
      assert.deepEqual((await results())[2], { uid: "not-loaded", nonce: 3, found: false })
      assert.equal((await metrics()).top, positionBefore)
      assert(await atBottom(), "a miss leaves the bottom pin alone")

      // 6. A queued-input uid matches the canonical user block that carries it.
      await page.evaluate(() => window.focusTest.request("queued-six", 4))
      await page.waitForFunction(() => window.focusTest.results.length === 4)
      assert.deepEqual((await results())[3], { uid: "queued-six", nonce: 4, found: true })
      await settleFocus()
      assert(Math.abs(await centreOffset("u-6")) <= 12, "input uid focuses its block")

      // 7. The same request prop is handled once: a re-render does not pull the viewport back.
      await page.getByTitle("Scroll to bottom").click()
      await page.waitForFunction(() => {
        const node = document.querySelector('[data-slot="chat-panel"] .overflow-y-auto')
        return node.scrollHeight - node.scrollTop - node.clientHeight < 6
      })
      await page.evaluate(() => window.focusTest.rerenderSameRequest())
      await page.waitForTimeout(200)
      assert(await atBottom(), "re-rendering with the same request does not re-focus")
      assert.equal((await results()).length, 4)

      // 8. Switching conversation still lands pinned to the tail.
      await page.evaluate(() => window.focusTest.setSession("b"))
      await page.locator('[data-message-uid="b-u-118"], [data-message-uid="b-a-119"]').first().waitFor()
      assert(await atBottom(), "a new conversation opens at the tail")

      summary.focus.push(`${width}x${height}`)
      await page.close()
    }

    assert.deepEqual(errors, [], "no browser errors")
    summary.requests = requests.length
  } finally {
    await browser?.close()
    await server.close()
  }
  fs.writeFileSync(path.join(shots, "results.json"), JSON.stringify(summary, null, 2))
  console.log(`artifacts panel: ${summary.panel.length} panel checks, ${summary.focus.length} focus viewports passed; ${summary.requests} fixture-served requests (no real media); screenshots in ${shots}`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
