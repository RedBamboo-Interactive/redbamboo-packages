import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { createServer } from "vite"

const fixtureDir = path.dirname(fileURLToPath(import.meta.url))
const outputDir = path.join(process.env.REDLEAF_SCRATCH_DIR || process.env.TEMP, "ui-dock")
await mkdir(outputDir, { recursive: true })

const server = await createServer({
  root: fixtureDir,
  configFile: path.join(fixtureDir, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0 },
  logLevel: "error",
})

const mounts = (page) => page.evaluate(() => ({ ...window.__mounts }))
const dockState = async (page) => JSON.parse(await page.getByTestId("dock-state").textContent())
const zoneOf = async (page, panelId) => (await dockState(page)).find(([id]) => id === panelId)?.[1] ?? null
const host = (page, panelId) => page.locator(`[data-dock-panel="${panelId}"]`)
const box = async (locator) => {
  const rect = await locator.boundingBox()
  assert.ok(rect, "element has no box")
  return rect
}

/** Drags with real pointer events from a handle to a point. */
async function drag(page, handle, to, options = {}) {
  const { escape = false, screenshot } = options
  const from = await box(handle)
  const startX = from.x + (options.fromGrip ? 14 : 80)
  const startY = from.y + from.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + 2, startY + 1)
  assert.equal(await page.locator('[data-slot="dock-drag-overlay"]').count(), 0, "no drag below the 4px threshold")
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await page.locator('[data-slot="dock-drag-overlay"]').waitFor()
  const target = await page.locator('[data-slot="dock-drag-overlay"]').getAttribute("data-dock-drop-target")
  if (screenshot) await page.screenshot({ path: path.join(outputDir, screenshot) })
  if (escape) await page.keyboard.press("Escape")
  await page.mouse.up()
  await page.locator('[data-slot="dock-drag-overlay"]').waitFor({ state: "detached" })
  return target
}

/** Point inside a fraction of a group's box (fx, fy in 0..1). */
async function pointIn(locator, fx, fy) {
  const rect = await box(locator)
  return { x: rect.x + rect.width * fx, y: rect.y + rect.height * fy }
}

const groupOf = (page, panelId) => page.locator("[data-dock-group]", { has: page.locator(`[data-dock-panel="${panelId}"]`) })

let browser
try {
  await server.listen()
  const baseUrl = server.resolvedUrls?.local[0]
  assert.ok(baseUrl, "Vite did not expose a local story URL")
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("404")) errors.push(message.text())
  })

  // --- defaults ------------------------------------------------------------
  await page.goto(`${baseUrl}?app=a`, { waitUntil: "networkidle" })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: "networkidle" })
  await page.getByTestId("toggle-console").click()
  await page.getByTestId("toggle-settings").click()
  await page.getByTestId("toggle-history").click()
  assert.deepEqual(await dockState(page), [["list", "left", false], ["console", "right", false], ["settings", "right", false], ["history", "right", false]])
  // Default stacking follows declared order, not open order.
  const rightOrder = await page.locator('[data-dock-zone="right"] [data-dock-panel]').evaluateAll((els) => els.map((el) => el.dataset.dockPanel))
  assert.deepEqual(rightOrder, ["history", "console", "settings"])
  assert.equal(await page.locator('[data-dock-zone="bottom"]').count(), 0, "an empty zone renders nothing")
  // The list is seeded from the pre-dock layoutKey default width.
  assert.equal(Math.round((await box(page.locator('[data-dock-zone="left"]'))).width), 320)
  // Docked plugin content keeps its plugin CSS scope.
  assert.equal(await host(page, "list").locator('[data-plugin-css="story-plugin"]').count(), 1)
  assert.equal(await page.locator('[data-slot="master-detail"]').getAttribute("data-docked"), "")
  await page.screenshot({ path: path.join(outputDir, "01-defaults.png") })

  // --- state that must survive every move --------------------------------
  await page.getByTestId("composer").fill("draft that must survive")
  await page.getByTestId("row-41").click()
  await page.getByTestId("list-scroll").evaluate((el) => { el.scrollTop = 1200 })
  await page.getByTestId("console-scroll").evaluate((el) => { el.scrollTop = 400 })
  await page.evaluate(() => {
    window.__nodes = {
      list: document.querySelector('[data-testid="list-scroll"]'),
      chat: document.querySelector('[data-testid="chat-body"]'),
      console: document.querySelector('[data-testid="console-scroll"]'),
      main: document.querySelector('[data-testid="main"]'),
    }
  })
  const baseline = await mounts(page)
  assert.deepEqual(baseline, { story: 1, chat: 1, list: 1, console: 1, settings: 1, history: 1 })
  const sameNodes = () => page.evaluate(() => Object.entries(window.__nodes).every(([key, node]) =>
    node.isConnected && node === document.querySelector(`[data-testid="${key === "main" ? "main" : key === "chat" ? "chat-body" : `${key}-scroll`}"]`)))
  const assertPreserved = async (step) => {
    assert.deepEqual(await mounts(page), { ...baseline, ...(await page.evaluate(() => window.__extraMounts ?? {})) }, `${step}: no remount`)
    assert.ok(await sameNodes(), `${step}: same DOM nodes`)
    assert.equal(await page.getByTestId("composer").inputValue(), "draft that must survive", `${step}: composer draft`)
    assert.equal(await page.getByTestId("row-41").getAttribute("aria-selected"), "true", `${step}: list selection`)
    assert.equal(await page.getByTestId("list-scroll").evaluate((el) => el.scrollTop), 1200, `${step}: list scroll`)
  }

  // --- below the threshold and Escape both cancel -------------------------
  // One header row per group: the dock's row carries the panel's own header content.
  const assertOneHeaderRow = async (step) => {
    for (const group of await page.locator("[data-dock-group]").all()) {
      assert.equal(await group.locator("[data-dock-group-header]").count(), 1, `${step}: one header row`)
      assert.equal(await group.locator('[data-dock-group-body] [data-slot="panel-header"]:visible').count(), 0, `${step}: no second header inside the panel`)
      assert.equal(await group.locator("[data-dock-menu]").count(), 1, `${step}: one dock menu`)
    }
  }
  await assertOneHeaderRow("defaults")
  // Surfaces: zones and tool panels paint nothing (the shell and any wallpaper show
  // through); the list's elevated surface covers its header row and body as one element.
  const painted = (locator) => locator.evaluate((el) => getComputedStyle(el).backgroundColor)
  for (const zone of await page.locator("[data-dock-zone]").all()) assert.equal(await painted(zone), "rgba(0, 0, 0, 0)", "zones paint nothing")
  const listSurface = groupOf(page, "list")
  assert.equal(await listSurface.getAttribute("data-dock-surface"), "elevated")
  assert.notEqual(await painted(listSurface), "rgba(0, 0, 0, 0)", "the list surface is painted")
  assert.equal(await listSurface.locator("[data-dock-group-header]").count(), 1, "the list surface includes its header row")
  assert.equal(await painted(host(page, "list").locator('[data-slot="master-detail-sidebar"]')), "rgba(0, 0, 0, 0)", "the docked sidebar does not paint a second layer")
  assert.equal(await groupOf(page, "console").getAttribute("data-dock-surface"), "none")
  assert.equal(await painted(groupOf(page, "console")), "rgba(0, 0, 0, 0)", "tool panels paint nothing")
  // The row is the panel's own header: same padding, so the title keeps its x position.
  const rowBox = await box(groupOf(page, "list").locator("[data-dock-group-header]"))
  const titleBox = await box(groupOf(page, "list").locator("[data-dock-group-header]").getByText("Discussions", { exact: true }))
  assert.equal(Math.round(titleBox.x - rowBox.x), 12, "title sits at the header's 12px padding; the grip lives inside the padding")
  const listRow = groupOf(page, "list").locator("[data-dock-group-header]")
  assert.equal(await listRow.getByText("Discussions", { exact: true }).count(), 1, "the list's own title is in the row")
  assert.equal(await listRow.getByRole("button", { name: "New discussion" }).count(), 1, "the list's own action is in the row")
  const consoleRow = groupOf(page, "console").locator("[data-dock-group-header]")
  assert.equal(await consoleRow.getByRole("button", { name: /^Close console$/i }).count(), 1, "single close: the panel's own")
  const listHeader = listRow
  assert.equal(await listHeader.getAttribute("data-dock-handle"), "list", "the list's PanelHeader is its handle")
  const cancelled = await drag(page, listHeader, await pointIn(groupOf(page, "settings"), 0.5, 0.5), { escape: true })
  assert.notEqual(cancelled, "none")
  assert.equal(await zoneOf(page, "list"), "left", "Escape cancels the drop")
  await assertPreserved("escape")

  // --- drag the list to the right zone (split below Settings) -------------
  const dropped = await drag(page, listHeader, await pointIn(groupOf(page, "settings"), 0.5, 0.94), { screenshot: "02-dragging-list.png", fromGrip: true })
  assert.equal(await page.getByRole("menu").count(), 0, "dragging from the grip does not open its menu")
  assert.match(dropped, /^split:.*:after$/)
  assert.equal(await zoneOf(page, "list"), "right")
  assert.equal(await page.locator('[data-dock-zone="left"]').count(), 0, "the emptied left zone takes no space")
  await assertPreserved("list to right")
  assert.equal(await page.getByTestId("console-scroll").evaluate((el) => el.scrollTop), 400, "other panels keep scroll")
  await page.screenshot({ path: path.join(outputDir, "03-list-right.png") })

  // --- tabs: History onto Settings ----------------------------------------
  const historyHeader = groupOf(page, "history").locator("[data-dock-group-header]")
  const tabbed = await drag(page, historyHeader, await pointIn(groupOf(page, "settings"), 0.5, 0.5))
  assert.match(tabbed, /^tab:/)
  const tablist = groupOf(page, "settings").getByRole("tablist")
  assert.deepEqual(await tablist.getByRole("tab").allTextContents(), ["Settings", "History"])
  await assertOneHeaderRow("tabs")
  const tabRow = groupOf(page, "settings").locator("[data-dock-group-header]")
  assert.equal(await tabRow.getByText("History", { exact: true }).count(), 1, "tab group: the title appears once, in the tab")
  assert.equal(await tabRow.getByRole("button", { name: /^Close/ }).count(), 1, "tab group: one close, the active panel's")
  assert.equal(await tabRow.getByRole("button", { name: "Close history" }).count(), 1)
  assert.equal(await tablist.getByRole("tab", { name: "History" }).getAttribute("aria-selected"), "true")
  assert.equal(await host(page, "settings").evaluate((el) => el.inert), true, "inactive tab is inert")
  await tablist.getByRole("tab", { name: "Settings" }).click()
  assert.equal(await host(page, "history").evaluate((el) => el.style.visibility), "hidden")
  await tablist.getByRole("tab", { name: "Settings" }).press("ArrowRight")
  assert.equal(await tablist.getByRole("tab", { name: "History" }).getAttribute("aria-selected"), "true", "arrow keys switch tabs")
  await assertPreserved("tabs")

  // --- keyboard: header menu moves Console to the bottom ------------------
  const consoleMenu = groupOf(page, "console").getByRole("button", { name: "Console panel options" })
  await consoleMenu.focus()
  await page.keyboard.press("Enter")
  const moveBottom = page.getByRole("menuitem", { name: "Move to bottom" })
  await moveBottom.waitFor()
  assert.equal(await page.getByRole("menuitem", { name: "Move to right" }).getAttribute("aria-disabled"), "true")
  await moveBottom.focus()
  await page.keyboard.press("Enter")
  await page.locator('[data-dock-zone="bottom"] [data-dock-panel="console"]').waitFor()
  assert.equal(await page.getByTestId("console-scroll").evaluate((el) => el.scrollTop), 400, "moved panel keeps scroll")
  await assertPreserved("console to bottom")

  // --- the centre keeps its width when a panel moves ----------------------
  await page.screenshot({ path: path.join(outputDir, "04-arranged.png") })

  // --- headerless panels get a fallback handle ----------------------------
  await page.getByTestId("toggle-notes").click()
  await page.evaluate(() => { window.__extraMounts = { notes: 1 } })
  const notesGroup = groupOf(page, "notes")
  assert.equal(await notesGroup.locator("[data-dock-group-header]").getByText("Notes", { exact: true }).count(), 1, "headerless panels get the dock title")
  await assertOneHeaderRow("notes")
  await assertPreserved("notes open")

  // --- zone resize is saved ------------------------------------------------
  const rightSeparator = page.getByRole("separator", { name: "Resize right dock" })
  const separatorBox = await box(rightSeparator)
  const rightBefore = (await box(page.locator('[data-dock-zone="right"]'))).width
  await page.mouse.move(separatorBox.x + separatorBox.width / 2, separatorBox.y + 200)
  await page.mouse.down()
  await page.mouse.move(separatorBox.x - 60, separatorBox.y + 200, { steps: 6 })
  await page.mouse.up()
  const rightResized = Math.round((await box(page.locator('[data-dock-zone="right"]'))).width)
  assert.ok(Math.abs(rightResized - (rightBefore + 60)) <= 2, `right zone widened (${rightBefore} -> ${rightResized})`)
  await assertPreserved("resize")

  // --- persistence ---------------------------------------------------------
  const savedA = await page.evaluate(() => localStorage.getItem("story:dock:a:v1"))
  assert.ok(savedA, "layout saved under the app key")
  await page.reload({ waitUntil: "networkidle" })
  assert.deepEqual(await dockState(page), [["list", "right", false]], "transient panels reopen closed")
  for (const name of ["console", "settings", "history"]) await page.getByTestId(`toggle-${name}`).click()
  assert.equal(await zoneOf(page, "console"), "bottom")
  assert.deepEqual(await groupOf(page, "settings").getByRole("tab").allTextContents(), ["Settings", "History"])
  assert.equal(await groupOf(page, "settings").getByRole("tab", { name: "History" }).getAttribute("aria-selected"), "true", "active tab persists")
  const rightAfterReload = await page.locator('[data-dock-zone="right"] [data-dock-group]').evaluateAll((els) => els.map((el) => [...el.querySelectorAll("[data-dock-panel]")].map((p) => p.dataset.dockPanel)))
  assert.deepEqual(rightAfterReload, [["settings", "history"], ["list"]])
  assert.ok(Math.abs(Math.round((await box(page.locator('[data-dock-zone="right"]'))).width) - rightResized) <= 2, "zone size persists")
  await page.screenshot({ path: path.join(outputDir, "05-after-reload.png") })

  // --- per-app independence -----------------------------------------------
  await page.getByTestId("app-b").click()
  await page.getByTestId("app-b-content").waitFor()
  assert.equal(await zoneOf(page, "console"), "right", "app B starts from defaults")
  const bMenu = groupOf(page, "console").getByRole("button", { name: "Console panel options" })
  await bMenu.click()
  await page.getByRole("menuitem", { name: "Move to left" }).click()
  assert.equal(await zoneOf(page, "console"), "left")
  const savedB = await page.evaluate(() => localStorage.getItem("story:dock:b:v1"))
  await page.getByTestId("app-a").click()
  await host(page, "list").waitFor()
  assert.equal(await zoneOf(page, "console"), "bottom", "app A layout is untouched by app B")
  assert.equal(await zoneOf(page, "list"), "right")

  // --- reset applies to the current app only ------------------------------
  await page.getByTestId("reset").click()
  assert.equal(await zoneOf(page, "list"), "left")
  assert.equal(await zoneOf(page, "console"), "right")
  assert.equal(Math.round((await box(page.locator('[data-dock-zone="left"]'))).width), 320, "reset restores default sizes")
  assert.equal(await page.evaluate(() => localStorage.getItem("story:dock:b:v1")), savedB, "reset leaves app B alone")

  // --- collapse persists ---------------------------------------------------
  await groupOf(page, "list").getByRole("button", { name: "Discussions panel options" }).click()
  await page.getByRole("menuitem", { name: "Collapse" }).click()
  await page.getByRole("button", { name: "Expand Discussions" }).waitFor()
  assert.equal(Math.round((await box(page.locator('[data-dock-zone="left"]'))).width), 36, "collapsed zone is a rail")
  await page.reload({ waitUntil: "networkidle" })
  await page.getByRole("button", { name: "Expand Discussions" }).click()
  await host(page, "list").getByTestId("list-scroll").waitFor()
  assert.equal(Math.round((await box(page.locator('[data-dock-zone="left"]'))).width), 320, "expanding restores the zone size")

  // --- corrupt storage falls back to defaults ------------------------------
  await page.evaluate(() => localStorage.setItem("story:dock:a:v1", "{not json"))
  await page.reload({ waitUntil: "networkidle" })
  assert.deepEqual(await dockState(page), [["list", "left", false]])
  await page.evaluate(() => localStorage.setItem("story:dock:a:v1", JSON.stringify({ version: 1, zones: { right: [{ id: "g", panels: ["list", "ghost"], active: "ghost" }] } })))
  await page.reload({ waitUntil: "networkidle" })
  assert.equal(await zoneOf(page, "list"), "right", "valid parts of stored data still apply; unknown panels are skipped")

  // --- narrow: docking is off and the inline layout is unchanged ----------
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: "networkidle" })
  await page.setViewportSize({ width: 900, height: 900 })
  await page.locator('[data-slot="master-detail"]:not([data-docked])').waitFor()
  assert.equal(await page.locator("[data-dock-zone]").count(), 0)
  assert.equal(await page.locator('[data-slot="master-detail"] [data-slot="master-detail-sidebar"]').count(), 1, "inline sidebar")
  await page.screenshot({ path: path.join(outputDir, "06-narrow.png") })
  await page.setViewportSize({ width: 600, height: 900 })
  await page.getByRole("tab", { name: "Discussions" }).waitFor()
  await page.screenshot({ path: path.join(outputDir, "07-mobile.png") })
  await page.setViewportSize({ width: 1440, height: 900 })
  await host(page, "list").waitFor()

  // --- live resize: the desktop layout survives a phone-width pass --------
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: "networkidle" })
  await page.getByTestId("toggle-console").click()
  await groupOf(page, "list").getByRole("button", { name: "Discussions panel options" }).click()
  await page.getByRole("menuitem", { name: "Move to right" }).click()
  await groupOf(page, "console").getByRole("button", { name: "Console panel options" }).click()
  await page.getByRole("menuitem", { name: "Move to bottom" }).click()
  await page.getByTestId("composer").fill("draft across breakpoints")
  await page.evaluate(() => { window.__composer = document.querySelector('[data-testid="composer"]') })
  const desktopLayout = await page.evaluate(() => localStorage.getItem("story:dock:a:v1"))
  const chatMounts = (await mounts(page)).chat
  const sameComposer = () => page.evaluate(() => window.__composer === document.querySelector('[data-testid="composer"]') && window.__composer.isConnected)
  await page.setViewportSize({ width: 900, height: 900 })
  await page.locator('[data-slot="master-detail"]:not([data-docked])').waitFor()
  assert.equal(await page.locator("[data-dock-zone], [data-dock-panel], [data-dock-handle]").count(), 0, "tablet band: nothing docked")
  assert.ok(await sameComposer(), "tablet band: composer not remounted")
  await page.screenshot({ path: path.join(outputDir, "08-resize-tablet.png") })
  await page.setViewportSize({ width: 412, height: 900 })
  await page.getByRole("tab", { name: "Discussions" }).click()
  await page.getByTestId("row-3").waitFor()
  assert.equal(await page.getByTestId("composer").count(), 0, "list tab hides the chat")
  await page.getByRole("tab", { name: "Chat" }).click()
  await page.getByTestId("composer").waitFor()
  assert.ok(await sameComposer(), "phone: composer not remounted after using the tabs")
  assert.equal(await page.getByTestId("composer").inputValue(), "draft across breakpoints")
  await page.screenshot({ path: path.join(outputDir, "09-resize-phone.png") })
  assert.equal(await page.evaluate(() => localStorage.getItem("story:dock:a:v1")), desktopLayout, "the narrow pass writes nothing")
  await page.setViewportSize({ width: 1440, height: 900 })
  await host(page, "list").waitFor()
  assert.equal(await zoneOf(page, "list"), "right", "desktop layout restored: list")
  assert.equal(await zoneOf(page, "console"), "bottom", "desktop layout restored: console")
  assert.ok(await sameComposer(), "desktop again: composer not remounted")
  assert.equal(await page.getByTestId("composer").inputValue(), "draft across breakpoints")
  assert.equal((await mounts(page)).chat, chatMounts, "chat mounted once across every breakpoint")
  assert.equal(await page.evaluate(() => localStorage.getItem("story:dock:a:v1")), desktopLayout)
  await page.screenshot({ path: path.join(outputDir, "10-resize-desktop-again.png") })

  // --- real mobile emulation: the dock is inert ----------------------------
  const mobile = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true })
  await mobile.addInitScript(() => {
    window.__dockStorage = { reads: 0, writes: 0 }
    const { getItem, setItem } = Storage.prototype
    Storage.prototype.getItem = function (key) {
      if (String(key).startsWith("story:dock")) window.__dockStorage.reads += 1
      return getItem.call(this, key)
    }
    Storage.prototype.setItem = function (key, value) {
      if (String(key).startsWith("story:dock")) window.__dockStorage.writes += 1
      return setItem.call(this, key, value)
    }
  })
  const phone = await mobile.newPage()
  phone.on("pageerror", (error) => errors.push(`mobile: ${error.message}`))
  await phone.goto(`${baseUrl}?app=a`, { waitUntil: "networkidle" })
  await phone.evaluate((layout) => localStorage.setItem("story:dock:a:v1", layout), desktopLayout)
  await phone.reload({ waitUntil: "networkidle" })
  await phone.getByTestId("toggle-console").tap()
  await phone.getByRole("tab", { name: "Discussions" }).waitFor()
  assert.equal(await phone.locator("[data-dock-zone], [data-dock-panel], [data-dock-handle], [data-dock-enabled]").count(), 0, "mobile: no dock DOM")
  const header = phone.locator('[data-slot="panel-header"]').first()
  const headerBox = await box(header)
  const cdp = await mobile.newCDPSession(phone)
  const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] })
  await touch("touchStart", headerBox.x + 30, headerBox.y + headerBox.height / 2)
  for (let step = 1; step <= 8; step += 1) await touch("touchMove", headerBox.x + 30 + step * 20, headerBox.y + headerBox.height / 2 + step * 10)
  assert.equal(await phone.locator('[data-slot="dock-drag-overlay"]').count(), 0, "mobile: a touch drag on a header starts nothing")
  await touch("touchEnd")
  // A tap during the fling would only stop it, as on a real phone.
  await phone.waitForTimeout(1200)
  await phone.getByRole("tab", { name: "Chat" }).tap()
  await phone.getByTestId("composer").waitFor()
  await phone.getByRole("tab", { name: "Discussions" }).tap()
  const scroller = phone.getByTestId("list-scroll")
  const scrollBox = await box(scroller)
  const startY = Math.round(scrollBox.y + Math.min(600, scrollBox.height - 20))
  await touch("touchStart", scrollBox.x + 100, startY)
  for (let step = 1; step <= 16; step += 1) await touch("touchMove", scrollBox.x + 100, startY - step * 25)
  await touch("touchEnd")
  await phone.waitForFunction(() => document.querySelector('[data-testid="list-scroll"]').scrollTop > 100)
  assert.ok(await scroller.evaluate((el) => el.scrollTop) > 100, "mobile: touch scrolling works")
  assert.deepEqual(await phone.evaluate(() => window.__dockStorage), { reads: 0, writes: 0 }, "mobile: no dock layout reads or writes")
  await phone.screenshot({ path: path.join(outputDir, "11-mobile-inert.png") })
  await mobile.close()

  // --- compact (Floating Nova) keeps its original tabs exactly -------------
  const compact = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const compactPage = await compact.newPage()
  compactPage.on("pageerror", (error) => errors.push(`compact: ${error.message}`))
  await compactPage.goto(`${baseUrl}?app=a&compact=1`, { waitUntil: "networkidle" })
  await compactPage.getByRole("tab", { name: "Discussions" }).waitFor()
  assert.equal(await compactPage.locator("[data-dock-panel], [data-slot='master-detail-detail-slot']").count(), 0, "compact: no dock, no detail host")
  await compactPage.getByRole("tab", { name: "Chat" }).click()
  await compactPage.getByTestId("composer").waitFor()
  await compactPage.getByRole("tab", { name: "Discussions" }).click()
  await compactPage.getByRole("tab", { name: "Chat" }).click()
  await compactPage.getByTestId("composer").waitFor()
  assert.equal((await mounts(compactPage)).chat, 2, "compact: tab switching remounts the chat exactly as before")
  await compact.close()

  assert.deepEqual(errors, [])
  console.log(`dock story passed; screenshots in ${outputDir}`)
} finally {
  await browser?.close()
  await server.close()
}
