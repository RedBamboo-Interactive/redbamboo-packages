const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const os = require("node:os")
const { pathToFileURL } = require("node:url")
const { chromium } = require(require.resolve("playwright", { paths: [path.resolve(__dirname, "../../../testing")] }))

async function main() {
  const packageRoot = path.resolve(__dirname, "../..")
  const scratch = process.env.REDLEAF_SCRATCH_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "chat-image-read-"))
  const shots = path.join(scratch, "image-read-thumbnail")
  fs.mkdirSync(shots, { recursive: true })
  const { createServer } = await import(pathToFileURL(require.resolve("vite")))
  const tailwind = (await import(pathToFileURL(require.resolve("@tailwindcss/vite", { paths: [path.resolve(packageRoot, "../ui")] })))).default
  const server = await createServer({ configFile: false, root: __dirname, plugins: [tailwind()],
    cacheDir: path.join(scratch, "image-read-vite-cache"),
    resolve: { alias: { react: path.join(packageRoot, "node_modules/react"), "react-dom": path.join(packageRoot, "node_modules/react-dom") } },
    server: { host: "127.0.0.1", port: 0, fs: { allow: [path.resolve(packageRoot, "../.."), scratch] } },
  })
  let browser
  const results = []
  try {
    await server.listen()
    const origin = server.resolvedUrls.local[0]
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
    const page = await context.newPage()
    const errors = []
    page.on("pageerror", error => errors.push(error.message))
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      await page.setViewportSize({ width, height })
      await page.goto(origin)
      const portrait = page.locator('[data-tool-use-id="portrait"]')
      const map = page.locator('[data-tool-use-id="map"]')
      const source = page.locator('[data-tool-use-id="source"]')
      await portrait.locator("img").waitFor()
      await map.locator("img").waitFor()
      await page.waitForFunction(() => [...document.querySelectorAll('[data-tool-use-id="portrait"] img, [data-tool-use-id="map"] img')]
        .every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))
      await page.evaluate(() => Promise.all(document.getAnimations()
        .filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime))
        .map(animation => animation.finished.catch(() => {}))))
      for (const square of [portrait, map]) {
        const box = await square.boundingBox()
        assert.equal(box.width, 10, "thumbnail keeps the tool-square width")
        assert.equal(box.height, 10, "thumbnail keeps the tool-square height")
        assert.equal(await square.locator("img").evaluate(node => getComputedStyle(node).opacity), "1")
      }
      assert.equal(await source.locator("img").count(), 0, "text Read stays a coloured square")
      if (width === 1440) {
        const before = await Promise.all([map, source].map(square => square.boundingBox()))
        await portrait.hover()
        const preview = page.locator('[data-slot="image-read-hover-preview"]')
        await preview.waitFor()
        await page.waitForFunction(() => {
          const node = document.querySelector('[data-slot="image-read-hover-preview"]')
          return node && getComputedStyle(node).opacity === "1"
        })
        const previewBox = await preview.boundingBox()
        assert.equal(previewBox.width, 80, "hover preview matches the 80px image embed width")
        assert.equal(previewBox.height, 80, "hover preview matches the 80px image embed height")
        const after = await Promise.all([map, source].map(square => square.boundingBox()))
        assert.deepEqual(after, before, "hover preview does not move neighbouring tool squares")
        await page.screenshot({ path: path.join(shots, "image-read-hover-1440.png") })
        await page.mouse.move(1200, 700)
        await preview.waitFor({ state: "detached" })
      }
      await portrait.click()
      await page.getByRole("heading", { name: "view_image", exact: true }).waitFor()
      await page.keyboard.press("Escape")
      await page.locator('[data-slot="dialog-content"]').waitFor({ state: "detached" })
      await page.screenshot({ path: path.join(shots, `image-read-${width}.png`) })
      results.push({ width, images: 2, passed: true })
    }
    assert.deepEqual(errors, [], "no browser exceptions")
    await context.close()
  } finally {
    await browser?.close()
    await server.close()
  }
  fs.writeFileSync(path.join(shots, "results.json"), JSON.stringify(results, null, 2))
  console.log(`${results.length} image-read thumbnail viewports passed; screenshots in ${shots}`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
