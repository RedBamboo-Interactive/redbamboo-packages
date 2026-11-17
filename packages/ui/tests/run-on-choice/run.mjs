import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { createServer } from "vite"

const fixtureDir = path.dirname(fileURLToPath(import.meta.url))
const outputDir = path.join(process.env.REDLEAF_SCRATCH_DIR || process.env.TEMP, "ui-run-on-choice")
await mkdir(outputDir, { recursive: true })

const server = await createServer({
  root: fixtureDir,
  configFile: path.join(fixtureDir, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0 },
  logLevel: "error",
})

const state = async (page) => JSON.parse(await page.getByTestId("state").textContent())

let browser
try {
  await server.listen()
  const baseUrl = server.resolvedUrls?.local[0]
  assert.ok(baseUrl, "Vite did not expose a local story URL")
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined })
  const context = await browser.newContext({ viewport: { width: 900, height: 640 } })
  // The person's session cookie, as the kernel sets it.
  await context.addCookies([{ name: "leaf_session", value: "person", url: baseUrl }])
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()) })

  // The default source: GET /compute/nodes on the page's origin, as the person.
  const nodeRequests = []
  await page.route("**/compute/nodes", async (route) => {
    const headers = await route.request().allHeaders()
    nodeRequests.push({ method: route.request().method(), cookie: headers.cookie ?? "", authorization: headers.authorization ?? null })
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        nodes: [{
          id: "local", name: "LAURENT-PC", kind: "local", isLocal: true, status: "online", confirmed: true,
          placement: { eligible: true, reason: null }, capabilities: [{ slug: "tts" }],
        }],
        legacyNodeId: "legacy",
      }),
    })
  })

  await page.goto(baseUrl, { waitUntil: "networkidle" })

  // One node: a read-only row, no picker.
  const single = page.getByTestId("single").locator('[data-slot="run-on-choice"]')
  await single.and(page.locator('[data-mode="single"]')).waitFor()
  assert.equal(await single.textContent(), "Runs on LAURENT-PC")
  assert.equal(await single.getAttribute("data-node-id"), "local")
  assert.equal(await page.getByTestId("single").getByRole("combobox").count(), 0, "one node is never a dropdown")
  assert.equal(nodeRequests.length, 1)
  assert.equal(nodeRequests[0].method, "GET")
  assert.match(nodeRequests[0].cookie, /leaf_session=person/, "the node list is read with the person's cookie")
  assert.equal(nodeRequests[0].authorization, null, "never with a bearer")
  await single.locator('[data-slot="tooltip-trigger"]').focus()
  await page.locator('[data-slot="tooltip-content"]', { hasText: "Add nodes from Compute › Nodes." }).waitFor()
  await page.waitForTimeout(200)
  await page.screenshot({ path: path.join(outputDir, "single.png"), clip: { x: 150, y: 0, width: 750, height: 400 } })
  await page.keyboard.press("Escape")

  // The node list cannot be read: a muted row, nothing chosen.
  const failed = page.getByTestId("failed").locator('[data-slot="run-on-choice"]')
  await failed.and(page.locator('[data-mode="unavailable"]')).waitFor()
  assert.equal(await failed.getAttribute("title"), "The node list answered 502")

  // Three nodes, two of which can run the work: a picker, Automatic first.
  const picker = page.getByTestId("picker")
  const trigger = picker.locator('[data-slot="run-on-choice-trigger"]')
  await trigger.waitFor()
  assert.equal((await trigger.textContent()).trim(), "Automatic (LAURENT-PC)")
  await page.screenshot({ path: path.join(outputDir, "page.png") })
  await trigger.click()
  const list = page.locator('[data-slot="run-on-choice-list"]')
  await list.waitFor()
  const items = list.locator('[data-slot="select-item"]')
  assert.deepEqual(await items.evaluateAll((els) => els.map((el) => [el.getAttribute("data-node-id"), el.hasAttribute("data-disabled"), el.getAttribute("data-reason")])), [
    ["", false, null],
    ["local", false, null],
    ["node_01STUDIO", false, null],
    ["node_01LAPTOP", true, "Offline"],
  ])
  await list.locator('[data-node-id="node_01LAPTOP"]', { hasText: "Offline" }).waitFor()
  await page.waitForTimeout(200)
  await page.screenshot({ path: path.join(outputDir, "picker-open.png") })

  // A disabled node cannot be picked.
  await list.locator('[data-node-id="node_01LAPTOP"]').click({ force: true })
  assert.equal((await state(page)).picked, null)
  await list.locator('[data-node-id="node_01STUDIO"]').click()
  await list.waitFor({ state: "hidden" })
  assert.equal((await state(page)).picked, "node_01STUDIO")
  assert.equal((await trigger.textContent()).trim(), "STUDIO")

  // Back to Automatic: null, so the caller sends nothing new.
  await trigger.click()
  await list.locator('[data-node-id=""]').click()
  await list.waitFor({ state: "hidden" })
  assert.equal((await state(page)).picked, null)

  assert.deepEqual(errors, [])
  console.log(`run-on choice story passed; screenshots in ${outputDir}`)
} finally {
  await browser?.close()
  await server.close()
}
