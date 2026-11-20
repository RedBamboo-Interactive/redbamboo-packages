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
          icon: "desktop-tower", color: "blue", os: "windows",
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
  assert.equal(await single.locator('[data-slot="node-icon"]').getAttribute("data-icon"), "desktop-tower", "the node's own icon")
  assert.equal(nodeRequests.length, 2, "the plain and the compact one-node rows each read the list once")
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
  assert.equal(await trigger.locator('[data-slot="node-icon"]').getAttribute("data-color"), "violet")

  // Back to Automatic: null, so the caller sends nothing new.
  await trigger.click()
  await list.locator('[data-node-id=""]').click()
  await list.waitFor({ state: "hidden" })
  assert.equal((await state(page)).picked, null)

  // Compact, one node: the node's icon in its colour, focusable, a tooltip, never a button or a list.
  const compactSingle = page.getByTestId("compact-single").locator('[data-slot="run-on-choice"]')
  await compactSingle.and(page.locator('[data-mode="single"]')).waitFor()
  const singleIcon = compactSingle.locator('[data-slot="run-on-choice-trigger"]')
  assert.equal(await singleIcon.getAttribute("aria-label"), "Runs on LAURENT-PC (Online). Work runs on this node. Add nodes from Compute › Nodes.")
  assert.equal((await singleIcon.textContent()).trim(), "", "no visible text")
  assert.equal(await page.getByTestId("compact-single").getByRole("combobox").count(), 0)
  assert.equal(await page.getByTestId("compact-single").locator("button").count(), 0)
  assert.equal(await singleIcon.locator('[data-slot="node-icon"]').evaluate(el => getComputedStyle(el).color), "rgb(59, 130, 246)")
  assert.equal(await singleIcon.getAttribute("tabindex"), "0", "reachable by Tab")
  await singleIcon.hover()
  await page.locator('[data-slot="tooltip-content"]', { hasText: "Runs on LAURENT-PC (Online)" }).waitFor()
  await page.waitForTimeout(200)
  await page.screenshot({ path: path.join(outputDir, "compact-single.png") })
  await singleIcon.focus()
  await page.keyboard.press("Enter")
  assert.equal(await page.locator('[data-slot="run-on-choice-list"]:visible').count(), 0, "Enter on one node opens nothing")
  await page.keyboard.press("Escape")
  await page.mouse.move(0, 0)

  // Compact, three nodes: an icon button named by the choice; the keyboard opens, moves and closes the clist.
  const compactTrigger = page.getByTestId("compact-picker").locator('[data-slot="run-on-choice-trigger"]')
  await compactTrigger.waitFor()
  // The plain picker's list stays mounted, closed: the compact one is the last.
  const clist = page.locator('[data-slot="run-on-choice-list"]').last()
  assert.equal(await compactTrigger.getAttribute("aria-label"), "Run on: Automatic (LAURENT-PC)")
  assert.equal((await compactTrigger.textContent()).trim(), "", "no visible text")
  assert.equal(await compactTrigger.locator('[data-slot="node-icon"]').first().getAttribute("data-icon"), "signpost")
  await compactTrigger.focus()
  await page.keyboard.press("Enter")
  await clist.waitFor()
  const compactItems = clist.locator('[data-slot="select-item"]')
  assert.deepEqual(await compactItems.evaluateAll((els) => els.map((el) => [el.getAttribute("data-node-id"), el.textContent.trim()])), [
    ["", "Automatic (LAURENT-PC)"],
    ["local", "LAURENT-PC"],
    ["node_01STUDIO", "STUDIO"],
    ["node_01LAPTOP", "LAPTOPOffline"],
  ])
  assert.deepEqual(await clist.locator('[data-slot="node-icon"]').evaluateAll(els => els.map(el => el.getAttribute("data-icon"))),
    ["signpost", "desktop-tower", "graphics-card", "laptop"])
  await page.waitForTimeout(200)
  await page.screenshot({ path: path.join(outputDir, "compact-picker-open.png") })
  await page.keyboard.press("Escape")
  await clist.waitFor({ state: "hidden" })
  assert.equal((await state(page)).compactPicked, null, "Escape changes nothing")
  await compactTrigger.focus()
  await page.keyboard.press(" ")
  await clist.waitFor()
  // The list opens on the choice (Automatic); arrows move. The offline laptop can be read but Enter does not pick it.
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("ArrowDown")
  assert.equal(await clist.locator("[data-highlighted]").getAttribute("data-node-id"), "node_01LAPTOP")
  await page.keyboard.press("Enter")
  assert.equal((await state(page)).compactPicked, null, "a disabled node is never picked")
  await page.keyboard.press("ArrowUp")
  assert.equal(await clist.locator("[data-highlighted]").getAttribute("data-node-id"), "node_01STUDIO")
  await page.keyboard.press("Enter")
  await clist.waitFor({ state: "hidden" })
  assert.equal((await state(page)).compactPicked, "node_01STUDIO")
  assert.equal(await compactTrigger.getAttribute("aria-label"), "Run on: STUDIO (Online)")
  assert.equal(await compactTrigger.locator('[data-slot="node-icon"]').first().getAttribute("data-color"), "violet")

  // Compact, unreadable list: Automatic's icon, the reason in the label.
  const compactFailed = page.getByTestId("compact-failed").locator('[data-slot="run-on-choice-trigger"]')
  assert.equal(await compactFailed.getAttribute("aria-label"),
    "Runs automatically. The node list could not be read (The node list answered 502)")

  assert.deepEqual(errors, [])
  console.log(`run-on choice story passed; screenshots in ${outputDir}`)
} finally {
  await browser?.close()
  await server.close()
}
