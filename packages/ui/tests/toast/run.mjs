import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { createServer } from "vite"

const fixtureDir = path.dirname(fileURLToPath(import.meta.url))
const outputDir = path.join(process.env.REDLEAF_SCRATCH_DIR || process.env.TEMP, "ui-toast")
await mkdir(outputDir, { recursive: true })

const server = await createServer({
  root: fixtureDir,
  configFile: path.join(fixtureDir, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0 },
  logLevel: "error",
})

const raise = (page, api, input) => page.evaluate(({ api, input }) => window[api].toast(input), { api, input })
const toastCount = (page, selector = '[data-slot="toast"]') => page.locator(selector).count()

let browser
try {
  await server.listen()
  const baseUrl = server.resolvedUrls?.local[0]
  assert.ok(baseUrl, "Vite did not expose a local story URL")
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined })
  const context = await browser.newContext({
    viewport: { width: 1100, height: 760 },
    recordVideo: process.env.TOAST_VIDEO ? { dir: outputDir, size: { width: 1100, height: 760 } } : undefined,
  })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("404")) errors.push(message.text())
  })
  await page.goto(baseUrl)
  await page.waitForFunction(() => window.__plugin && window.__detached)

  // ── One stack per document, outside every plugin scope ──────────────
  await raise(page, "__plugin", { title: "From the plugin", variant: "success", duration: 60_000 })
  await page.evaluate(() => window.__toast({ title: "From outside React", variant: "default", duration: 60_000 }))
  await page.locator('[data-slot="toast"]').nth(1).waitFor()
  const stacks = await page.evaluate(() => [...document.querySelectorAll('[data-slot="toaster"]')].map((toaster) => ({
    parent: toaster.parentElement === document.body,
    inPluginScope: !!toaster.closest('[data-story-scope="plugin"]'),
    toasts: toaster.querySelectorAll('[data-slot="toast"]').length,
    right: Math.round(window.innerWidth - toaster.getBoundingClientRect().right),
  })))
  assert.deepEqual(stacks, [{ parent: true, inPluginScope: false, toasts: 2, right: 16 }],
    "two providers, a plugin provider and a second Toaster still render one stack, portalled to body, bottom-right")

  await raise(page, "__detached", { title: "From the detached window", variant: "default", duration: 60_000 })
  const detached = page.frameLocator('iframe[title="Detached window"]')
  await detached.locator('[data-slot="toast"]').waitFor()
  assert.equal(await detached.locator('[data-slot="toaster"]').count(), 1)
  assert.equal(await toastCount(page), 2, "the detached window's toast stays in its own document")

  // ── Arrival: slides in while its slot grows, then settles ──────────
  await page.evaluate(() => document.querySelectorAll('[data-slot="toast-dismiss"]').forEach((button) => button.click()))
  await page.waitForFunction(() => !document.querySelector('[data-slot="toast"]'))
  await raise(page, "__plugin", { title: "First", variant: "default", duration: 60_000 })
  await page.locator('[data-slot="toast-slot"]:not([data-entering])').waitFor()
  const firstSettled = await page.locator('[data-slot="toast"]').first().boundingBox()
  await raise(page, "__plugin", { title: "Second", variant: "success", duration: 60_000 })
  const arriving = await page.evaluate(() => {
    const slot = document.querySelectorAll('[data-slot="toast-slot"]')[1]
    const toastEl = slot.querySelector('[data-slot="toast"]')
    return { entering: slot.hasAttribute("data-entering"), slot: getComputedStyle(slot).animationName, toast: getComputedStyle(toastEl).animationName }
  })
  assert.deepEqual(arriving, { entering: true, slot: "rb-toast-grow", toast: "rb-toast-in" })
  await page.waitForTimeout(110)
  await page.screenshot({ path: path.join(outputDir, "arriving.png"), clip: { x: 600, y: 520, width: 500, height: 240 } })
  const firstMidway = await page.locator('[data-slot="toast"]').first().boundingBox()
  await page.locator('[data-slot="toast-slot"]:nth-child(2):not([data-entering])').waitFor()
  const firstAfter = await page.locator('[data-slot="toast"]').first().boundingBox()
  assert.ok(firstMidway.y < firstSettled.y && firstMidway.y > firstAfter.y,
    `the older toast glides up while the new one arrives (${firstSettled.y} → ${firstMidway.y} → ${firstAfter.y})`)
  await page.screenshot({ path: path.join(outputDir, "settled.png"), clip: { x: 600, y: 520, width: 500, height: 240 } })

  // ── Exit: slides out, then the slot collapses and the stack settles ─
  await page.locator('[data-slot="toast-dismiss"]').nth(1).click()
  const leaving = page.locator('[data-slot="toast-slot"][data-phase="closing"]')
  assert.equal(await leaving.count(), 1, "dismiss starts an exit instead of removing at once")
  assert.equal(await leaving.evaluate((slot) => getComputedStyle(slot.querySelector('[data-slot="toast"]')).animationName), "rb-toast-out")
  await page.waitForTimeout(90)
  await page.screenshot({ path: path.join(outputDir, "leaving.png"), clip: { x: 600, y: 520, width: 500, height: 240 } })
  const opacity = await leaving.evaluate((slot) => Number(getComputedStyle(slot.querySelector('[data-slot="toast"]')).opacity))
  assert.ok(opacity > 0 && opacity < 1, `the leaving toast fades (opacity ${opacity})`)
  await page.waitForFunction(() => document.querySelectorAll('[data-slot="toast"]').length === 1, null, { timeout: 2000 })
  const firstBack = await page.locator('[data-slot="toast"]').first().boundingBox()
  assert.ok(Math.abs(firstBack.y - firstSettled.y) < 1, "the stack settles back where it was")

  // ── Hover holds the timeout ────────────────────────────────────────
  await page.locator('[data-slot="toast-dismiss"]').click()
  await page.waitForFunction(() => !document.querySelector('[data-slot="toast"]'))
  await raise(page, "__plugin", { title: "Short", variant: "default", duration: 700 })
  await page.locator('[data-slot="toast"]').hover()
  await page.waitForTimeout(1200)
  assert.equal(await page.locator('[data-slot="toast-slot"][data-phase="open"]').count(), 1, "a hovered toast does not leave")
  await page.mouse.move(10, 10)
  await page.waitForFunction(() => !document.querySelector('[data-slot="toast"]'), null, { timeout: 2000 })

  // ── Errors are announced; a group overflows into one toast ─────────
  await raise(page, "__plugin", { title: "Failed", variant: "error", duration: 60_000 })
  assert.equal(await page.locator('[data-slot="toast"][role="alert"]').count(), 1)
  for (let i = 1; i <= 5; i++) await raise(page, "__plugin", { title: `Run ${i}`, variant: "default", group: "codered", groupLabel: "Code", duration: 60_000 })
  assert.deepEqual(await page.locator('[data-slot="toast"] p.font-medium').allTextContents(), ["Failed", "Run 1", "Run 2", "Run 3", "+2 more from Code"])
  await page.waitForFunction(() => !document.querySelector('[data-slot="toast-slot"][data-entering]'))
  await page.screenshot({ path: path.join(outputDir, "group.png"), clip: { x: 600, y: 360, width: 500, height: 400 } })
  await page.evaluate(() => document.querySelectorAll('[data-slot="toast-dismiss"]').forEach((button) => button.click()))
  await page.waitForFunction(() => !document.querySelector('[data-slot="toast"]'))

  // ── Reduced motion: a fade, no travel ─────────────────────────────
  await page.emulateMedia({ reducedMotion: "reduce" })
  await raise(page, "__plugin", { title: "Calm", variant: "default", duration: 60_000 })
  const calm = await page.evaluate(() => {
    const el = document.querySelector('[data-slot="toast"]')
    const style = getComputedStyle(el)
    return { translate: style.translate, duration: style.animationDuration }
  })
  assert.ok(calm.translate === "none" || /^0px/.test(calm.translate), `no travel under reduced motion (${calm.translate})`)
  assert.equal(calm.duration, "0.15s")

  assert.deepEqual(errors, [])
  await context.close()
  console.log(`toast story passed; screenshots in ${outputDir}`)
} finally {
  await browser?.close()
  await server.close()
}
