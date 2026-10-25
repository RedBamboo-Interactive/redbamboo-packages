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
  // Surfaces: zones paint nothing; every panel is one elevated surface (the default)
  // covering its header row and body, the list and the tool panels alike.
  const painted = (locator) => locator.evaluate((el) => getComputedStyle(el).backgroundColor)
  for (const zone of await page.locator("[data-dock-zone]").all()) assert.equal(await painted(zone), "rgba(0, 0, 0, 0)", "zones paint nothing")
  const listSurface = groupOf(page, "list")
  assert.equal(await listSurface.getAttribute("data-dock-surface"), "elevated")
  assert.notEqual(await painted(listSurface), "rgba(0, 0, 0, 0)", "the list surface is painted")
  assert.equal(await listSurface.locator("[data-dock-group-header]").count(), 1, "the list surface includes its header row")
  assert.equal(await painted(host(page, "list").locator('[data-slot="master-detail-sidebar"]')), "rgba(0, 0, 0, 0)", "the docked sidebar does not paint a second layer")
  assert.equal(await groupOf(page, "console").getAttribute("data-dock-surface"), "elevated")
  assert.equal(await painted(groupOf(page, "console")), await painted(listSurface), "tool panels share the list's surface")
  // The grip has its own slot: 8px from the panel edge, a 24px-tall hit target, then the
  // header's own 8px gap before the title.
  for (const id of ["list", "console"]) {
    const row = groupOf(page, id).locator("[data-dock-group-header]")
    const rowBox = await box(row)
    const gripBox = await box(row.locator("[data-dock-grip]"))
    const title = id === "list" ? "Discussions" : "Console"
    const titleBox = await box(row.getByText(title, { exact: true }))
    assert.equal(Math.round(gripBox.x - rowBox.x), 8, `${id}: grip 8px from the panel edge`)
    assert.ok(gripBox.height >= 24, `${id}: grip hit target at least 24px tall`)
    assert.equal(Math.round(titleBox.x - (gripBox.x + gripBox.width)), 8, `${id}: 8px between grip and title`)
  }
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
  const savedA = await page.evaluate(() => localStorage.getItem("story:dock:a:v2"))
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
  const savedB = await page.evaluate(() => localStorage.getItem("story:dock:b:v2"))
  await page.getByTestId("app-a").click()
  await host(page, "list").waitFor()
  assert.equal(await zoneOf(page, "console"), "bottom", "app A layout is untouched by app B")
  assert.equal(await zoneOf(page, "list"), "right")

  // --- reset applies to the current app only ------------------------------
  await page.getByTestId("reset").click()
  assert.equal(await zoneOf(page, "list"), "left")
  assert.equal(await zoneOf(page, "console"), "right")
  assert.equal(Math.round((await box(page.locator('[data-dock-zone="left"]'))).width), 320, "reset restores default sizes")
  assert.equal(await page.evaluate(() => localStorage.getItem("story:dock:b:v2")), savedB, "reset leaves app B alone")

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
  await page.evaluate(() => localStorage.setItem("story:dock:a:v2", "{not json"))
  await page.reload({ waitUntil: "networkidle" })
  assert.deepEqual(await dockState(page), [["list", "left", false]])
  await page.evaluate(() => localStorage.setItem("story:dock:a:v2", JSON.stringify({ version: 2, zones: { right: [{ id: "l", groups: [{ id: "g", panels: ["list", "ghost"], active: "ghost" }] }, "junk"] } })))
  await page.reload({ waitUntil: "networkidle" })
  assert.equal(await zoneOf(page, "list"), "right", "valid parts of stored data still apply; unknown panels are skipped")

  // --- lanes: side-by-side columns on one side ------------------------------
  /** Panel ids per lane of a zone, in screen order (left to right). */
  const lanesOnScreen = (zone) => page.evaluate((zone) => [...document.querySelectorAll(`[data-dock-lane][data-dock-zone="${zone}"]`)]
    .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
    .map((lane) => [...lane.querySelectorAll("[data-dock-panel]")].map((panel) => panel.dataset.dockPanel)), zone)
  const laneBox = (panelId) => box(page.locator("[data-dock-lane]", { has: page.locator(`[data-dock-panel="${panelId}"]`) }))
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: "networkidle" })
  // The tester's flow: list to the right, then Settings opens beside it, toward the centre.
  await groupOf(page, "list").getByRole("button", { name: "Discussions panel options" }).click()
  await page.getByRole("menuitem", { name: "Move to right" }).click()
  await page.getByTestId("composer").fill("draft across lanes")
  await page.getByTestId("row-41").click()
  await page.getByTestId("list-scroll").evaluate((el) => { el.scrollTop = 1200 })
  await page.getByTestId("toggle-settings").click()
  await host(page, "settings").waitFor()
  assert.deepEqual(await lanesOnScreen("right"), [["settings"], ["list"]], "centre | Settings | list")
  assert.equal(await page.locator('[data-dock-zone="left"]').count(), 0)
  const listLaneBox = await laneBox("list")
  assert.ok(Math.abs(listLaneBox.x + listLaneBox.width - 1440) <= 1, "the list stays pinned to the screen edge")
  assert.equal(Math.round(listLaneBox.width), 320, "the list's column keeps its width")
  assert.equal(Math.round((await laneBox("settings")).width), 340, "Settings opens at its declared width")
  assert.equal(await page.getByRole("region", { name: "Right dock, column 1 of 2" }).count(), 1)
  assert.equal(await page.getByRole("region", { name: "Right dock, column 2 of 2" }).count(), 1)
  await assertOneHeaderRow("lanes")
  await page.screenshot({ path: path.join(outputDir, "12-lanes-settings-beside-list.png") })
  await page.evaluate(() => {
    window.__laneNodes = {
      list: document.querySelector('[data-testid="list-scroll"]'),
      chat: document.querySelector('[data-testid="chat-body"]'),
      composer: document.querySelector('[data-testid="composer"]'),
      settings: document.querySelector('[data-testid="settings-scroll"]'),
    }
  })
  await page.getByTestId("settings-scroll").evaluate((el) => { el.scrollTop = 300 })
  const laneMounts = await mounts(page)
  const assertLanesPreserved = async (step) => {
    assert.deepEqual(await mounts(page), laneMounts, `${step}: no remount`)
    assert.ok(await page.evaluate(() => Object.values(window.__laneNodes).every((node) => node.isConnected)), `${step}: same DOM nodes`)
    assert.equal(await page.getByTestId("composer").inputValue(), "draft across lanes", `${step}: composer draft`)
    assert.equal(await page.getByTestId("row-41").getAttribute("aria-selected"), "true", `${step}: list selection`)
    assert.equal(await page.getByTestId("list-scroll").evaluate((el) => el.scrollTop), 1200, `${step}: list scroll`)
    assert.equal(await page.getByTestId("settings-scroll").evaluate((el) => el.scrollTop), 300, `${step}: settings scroll`)
  }
  assert.equal(laneMounts.chat, 1, "the chat mounted once")

  // Fold: 340 + 320 + 2 separators + the 640px centre floor needs 1302px.
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.locator('[data-dock-folded][data-dock-zone="right"]').waitFor()
  assert.equal(await page.locator('[data-slot="dock-frame"]').getAttribute("data-dock-fold"), "right")
  assert.deepEqual(await page.locator('[data-dock-folded] [data-dock-panel]').evaluateAll((els) => els.map((el) => el.dataset.dockPanel)),
    ["settings", "list"], "folded: stacked in screen order")
  assert.equal(Math.round((await box(page.locator('[data-dock-folded]'))).width), 340, "the folded column takes the widest lane's width")
  await assertLanesPreserved("fold")
  await assertOneHeaderRow("folded")
  await page.screenshot({ path: path.join(outputDir, "13-lanes-folded-1280.png") })
  const foldedTargets = await (async () => {
    const handle = groupOf(page, "settings").locator("[data-dock-group-header]")
    const from = await box(handle)
    await page.mouse.move(from.x + 80, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + 100, from.y + 40, { steps: 4 })
    await page.locator('[data-slot="dock-drag-overlay"]').waitFor()
    const kinds = await page.locator("[data-dock-drop-candidate]").evaluateAll((els) => els.map((el) => el.dataset.dockDropCandidate.split(":")[0]))
    await page.keyboard.press("Escape")
    await page.mouse.up()
    return kinds
  })()
  assert.ok(!foldedTargets.includes("lane") && !foldedTargets.includes("edge"), "a folded side offers no new-column targets")
  assert.deepEqual(await lanesOnScreen("right"), [], "folding never changes the saved lanes")
  const savedFolded = JSON.parse(await page.evaluate(() => localStorage.getItem("story:dock:a:v2")))
  assert.equal(savedFolded.zones.right.length, 2, "the saved layout still has two lanes")
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.locator('[data-dock-folded]').waitFor({ state: "detached" })
  assert.deepEqual(await lanesOnScreen("right"), [["settings"], ["list"]], "unfolds when space returns")
  await assertLanesPreserved("unfold")

  // Drag Settings to the list's outer edge (the zone edge), then back to its inner edge.
  const settingsHeader = () => groupOf(page, "settings").locator("[data-dock-group-header]")
  const listLane = await laneBox("list")
  const toEdge = await drag(page, settingsHeader(), { x: listLane.x + listLane.width - 6, y: listLane.y + listLane.height / 2 }, { screenshot: "14-dragging-to-edge.png" })
  assert.equal(toEdge, "edge:right")
  assert.deepEqual(await lanesOnScreen("right"), [["list"], ["settings"]], "centre | list | Settings")
  await assertLanesPreserved("edge")
  const listLaneNow = await laneBox("list")
  const toInner = await drag(page, settingsHeader(), { x: listLaneNow.x + 8, y: listLaneNow.y + listLaneNow.height / 2 }, { screenshot: "15-dragging-to-inner.png" })
  assert.match(toInner, /^lane:.*:inner$/)
  assert.deepEqual(await lanesOnScreen("right"), [["settings"], ["list"]], "back to centre | Settings | list")
  await assertLanesPreserved("inner")

  // Stack Settings under the list, then "Move to own column" from its header menu.
  const stacked = await drag(page, settingsHeader(), await pointIn(groupOf(page, "list"), 0.5, 0.94))
  assert.match(stacked, /^split:.*:after$/)
  assert.deepEqual(await lanesOnScreen("right"), [["list", "settings"]])
  await groupOf(page, "list").getByRole("button", { name: "Discussions panel options" }).click()
  assert.equal(await page.getByRole("menuitem", { name: "Move to own column" }).getAttribute("aria-disabled"), null)
  await page.keyboard.press("Escape")
  await groupOf(page, "settings").getByRole("button", { name: "Settings panel options" }).click()
  await page.getByRole("menuitem", { name: "Move to own column" }).click()
  assert.deepEqual(await lanesOnScreen("right"), [["settings"], ["list"]], "own column: tools go toward the centre")
  await groupOf(page, "settings").getByRole("button", { name: "Settings panel options" }).click()
  assert.equal(await page.getByRole("menuitem", { name: "Move to own column" }).getAttribute("aria-disabled"), "true", "disabled when alone")
  await page.keyboard.press("Escape")
  await assertLanesPreserved("own column")

  // A lane separator resizes the two columns and persists per lane.
  const between = page.getByRole("separator", { name: "Resize right dock columns" })
  const betweenBox = await box(between)
  const settingsBefore = (await laneBox("settings")).width
  await page.mouse.move(betweenBox.x + betweenBox.width / 2, betweenBox.y + 300)
  await page.mouse.down()
  await page.mouse.move(betweenBox.x + 40, betweenBox.y + 300, { steps: 6 })
  await page.mouse.up()
  const settingsResized = Math.round((await laneBox("settings")).width)
  assert.ok(Math.abs(settingsResized - (settingsBefore + 40)) <= 2, `settings lane widened (${settingsBefore} -> ${settingsResized})`)
  const listResized = Math.round((await laneBox("list")).width)
  assert.ok(Math.abs(listResized - 280) <= 2, `its neighbour gave the space (${listResized})`)
  await page.screenshot({ path: path.join(outputDir, "16-lanes-resized.png") })
  await page.reload({ waitUntil: "networkidle" })
  await page.getByTestId("toggle-settings").click()
  await host(page, "settings").waitFor()
  assert.deepEqual(await lanesOnScreen("right"), [["settings"], ["list"]], "lanes persist")
  assert.ok(Math.abs(Math.round((await laneBox("settings")).width) - settingsResized) <= 1, "lane widths persist")
  assert.ok(Math.abs(Math.round((await laneBox("list")).width) - listResized) <= 1)

  // A collapsed list keeps its column as a rail at the screen edge.
  await groupOf(page, "list").getByRole("button", { name: "Discussions panel options" }).click()
  await page.getByRole("menuitem", { name: "Collapse" }).click()
  await page.getByRole("button", { name: "Expand Discussions" }).waitFor()
  const rail = await box(page.locator("[data-dock-rail]"))
  assert.equal(Math.round(rail.width), 36)
  assert.ok(Math.abs(rail.x + rail.width - 1440) <= 1, "the rail stays at the edge")
  await page.getByRole("button", { name: "Expand Discussions" }).click()
  await host(page, "list").getByTestId("list-scroll").waitFor()

  // A layout saved before lanes existed (v1, list alone on the right) migrates without loss.
  await page.evaluate(() => {
    localStorage.clear()
    localStorage.setItem("story:dock:a:v1", JSON.stringify({
      version: 1,
      zones: { left: [], right: [{ id: "g:list", panels: ["list"], active: "list" }], bottom: [] },
      zoneSizes: { right: 300 },
      collapsed: [],
    }))
  })
  await page.reload({ waitUntil: "networkidle" })
  assert.equal(await zoneOf(page, "list"), "right", "v1 placement kept")
  assert.equal(Math.round((await laneBox("list")).width), 300, "v1 zone size kept")
  const migrated = JSON.parse(await page.evaluate(() => localStorage.getItem("story:dock:a:v2")))
  assert.equal(migrated.version, 2)
  assert.deepEqual(migrated.zones.right.map((lane) => [lane.size, lane.groups.map((group) => group.panels)]), [[300, [["list"]]]])
  assert.ok(await page.evaluate(() => localStorage.getItem("story:dock:a:v1")), "the v1 key is left for older builds")
  await page.getByTestId("toggle-settings").click()
  await host(page, "settings").waitFor()
  assert.deepEqual(await lanesOnScreen("right"), [["settings"], ["list"]], "migrated: Settings opens beside the list")
  await page.screenshot({ path: path.join(outputDir, "17-migrated-v1.png") })

  // The reporter's v1 layout: Settings already stacked under the list on the right. Once both have
  // registered, the legacy lane is normalized once: centre | Settings | list. Reloads keep it.
  await page.evaluate(() => {
    localStorage.clear()
    localStorage.setItem("story:dock:a:v1", JSON.stringify({
      version: 1,
      zones: { left: [], right: [{ id: "g:list", panels: ["list"], active: "list" }, { id: "g:settings", panels: ["settings"], active: "settings" }], bottom: [] },
      zoneSizes: { right: 300 },
      collapsed: [],
    }))
  })
  await page.reload({ waitUntil: "networkidle" })
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem("story:dock:a:v2"))).zones.right[0].legacy, true, "Settings unknown yet: lane stays legacy")
  await page.getByTestId("toggle-settings").click()
  await host(page, "settings").waitFor()
  assert.deepEqual(await lanesOnScreen("right"), [["settings"], ["list"]], "reporter's stack becomes centre | Settings | list")
  assert.equal(Math.round((await laneBox("list")).width), 300, "the list keeps its column width")
  await page.screenshot({ path: path.join(outputDir, "18-migrated-reporter-v1.png") })
  const normalized = await page.evaluate(() => localStorage.getItem("story:dock:a:v2"))
  assert.ok(!normalized.includes("legacy"), "no legacy flag remains")
  // A stack built in v2 is left alone across reloads.
  const stackedAgain = await drag(page, groupOf(page, "settings").locator("[data-dock-group-header]"), await pointIn(groupOf(page, "list"), 0.5, 0.94))
  assert.match(stackedAgain, /^split:.*:after$/)
  await page.reload({ waitUntil: "networkidle" })
  await page.getByTestId("toggle-settings").click()
  await host(page, "settings").waitFor()
  assert.deepEqual(await lanesOnScreen("right"), [["list", "settings"]], "a deliberate v2 stack survives reload")

  // Reset restores defaults for this app (and forgets the v1 copy too).
  await page.getByTestId("reset").click()
  assert.equal(await zoneOf(page, "list"), "left")
  assert.equal(await page.evaluate(() => localStorage.getItem("story:dock:a:v1")), null)

  // --- a closed panel's host never covers the panels beneath it -------------
  // Tester's report: an inspector tabbed over Discussions closes; its emptied host
  // stayed in the group body (absolute, inset 0, visible) and swallowed every click.
  /** What the user hits at the centre of a row: "ok", or the dock panel host (or tag) that intercepts it. */
  const hitRow = (index) => page.getByTestId(`row-${index}`).evaluate((row) => {
    row.scrollIntoView({ block: "center" })
    const rect = row.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    if (hit && row.contains(hit)) return "ok"
    return hit?.closest("[data-dock-panel]")?.getAttribute("data-dock-panel") ?? hit?.tagName ?? "nothing"
  })
  const inBody = (panelId) => page.evaluate((id) => !!document.querySelector(`[data-dock-group-body] > [data-dock-panel="${id}"]`), panelId)
  const assertListUsable = async (step, row) => {
    assert.equal(await hitRow(row), "ok", `${step}: the row receives the hit, not an empty host`)
    await page.getByTestId(`row-${row}`).click({ timeout: 2000 })
    assert.equal(await page.getByTestId(`row-${row}`).getAttribute("aria-selected"), "true", `${step}: the click selects the row`)
    const before = await page.getByTestId("list-scroll").evaluate((el) => el.scrollTop)
    const rowBox = await box(page.getByTestId(`row-${row}`))
    await page.mouse.move(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2)
    await page.mouse.wheel(0, 240)
    await page.waitForFunction((top) => document.querySelector('[data-testid="list-scroll"]').scrollTop !== top, before, { timeout: 2000 })
    await page.mouse.wheel(0, -240)
  }
  assert.equal(await zoneOf(page, "settings"), "right")
  // Settings, the stand-in for the inspector, goes over Discussions as a tab and is the active one.
  const overList = await drag(page, groupOf(page, "settings").locator("[data-dock-group-header]"), await pointIn(groupOf(page, "list"), 0.5, 0.5))
  assert.match(overList, /^tab:/)
  assert.deepEqual(await groupOf(page, "list").getByRole("tab").allTextContents(), ["Discussions", "Settings"])
  assert.equal(await groupOf(page, "list").getByRole("tab", { name: "Settings" }).getAttribute("aria-selected"), "true")
  // Close it while it is the active tab: Discussions shows again and must take clicks and scroll.
  await page.getByTestId("toggle-settings").click()
  await page.getByTestId("settings-panel").waitFor({ state: "detached" })
  await assertListUsable("active tab closed", 3)
  assert.equal(await inBody("settings"), false, "the released host left the group body")
  await page.screenshot({ path: path.join(outputDir, "19-closed-tab-list-clickable.png") })
  // Reopen: it comes back in its saved place, with its content, and closing it again stays harmless.
  await page.getByTestId("toggle-settings").click()
  await page.getByTestId("settings-panel").waitFor()
  assert.deepEqual(await groupOf(page, "list").getByRole("tab").allTextContents(), ["Discussions", "Settings"], "reopens as the same tab")
  assert.equal(await groupOf(page, "list").getByRole("tab", { name: "Settings" }).getAttribute("aria-selected"), "true")
  assert.ok(await page.getByTestId("settings-panel").isVisible(), "reopened content is back")
  assert.equal(await page.getByTestId("settings-scroll").locator("p").count(), 80)
  // Switch to Discussions with Settings still open (switching discussion), then close the inactive tab.
  await groupOf(page, "list").getByRole("tab", { name: "Discussions" }).click()
  await assertListUsable("inactive tab open", 7)
  await page.getByTestId("toggle-settings").click()
  await page.getByTestId("settings-panel").waitFor({ state: "detached" })
  assert.equal(await inBody("settings"), false, "an inactive released host leaves too")
  await assertListUsable("inactive tab closed", 9)
  // Move and regroup: reopen, pull Settings out to its own column, close it there, reopen,
  // tab it back over Discussions, close it once more.
  await page.getByTestId("toggle-settings").click()
  await page.getByTestId("settings-panel").waitFor({ state: "attached" })
  assert.equal(await groupOf(page, "list").getByRole("tab", { name: "Discussions" }).getAttribute("aria-selected"), "true",
    "a reopened tab keeps the group's last active tab")
  await assertListUsable("reopened behind Discussions", 10)
  await groupOf(page, "list").getByRole("tab", { name: "Settings" }).click()
  await page.getByTestId("settings-panel").waitFor()
  await groupOf(page, "settings").getByRole("button", { name: "Settings panel options" }).click()
  await page.getByRole("menuitem", { name: "Move to own column" }).click()
  assert.notEqual(await groupOf(page, "settings").getAttribute("data-dock-group-lane"), await groupOf(page, "list").getAttribute("data-dock-group-lane"),
    "Settings has its own column")
  await assertListUsable("moved out", 11)
  await page.getByTestId("toggle-settings").click()
  await page.getByTestId("settings-panel").waitFor({ state: "detached" })
  await assertListUsable("closed in its own column", 13)
  await page.getByTestId("toggle-settings").click()
  await page.getByTestId("settings-panel").waitFor()
  const regrouped = await drag(page, groupOf(page, "settings").locator("[data-dock-group-header]"), await pointIn(groupOf(page, "list"), 0.5, 0.5))
  assert.match(regrouped, /^tab:/)
  await page.getByTestId("toggle-settings").click()
  await page.getByTestId("settings-panel").waitFor({ state: "detached" })
  assert.equal(await inBody("settings"), false)
  await assertListUsable("regrouped then closed", 15)
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll("[data-dock-group-body] > [data-dock-panel]")].map((el) => el.dataset.dockPanel)), ["list"],
    "only shown panels sit in group bodies")
  await page.getByTestId("toggle-settings").click()
  await page.getByTestId("settings-panel").waitFor()
  assert.ok(await page.getByTestId("settings-panel").isVisible(), "content comes back after every close")
  await page.screenshot({ path: path.join(outputDir, "20-reopened-after-regroup.png") })
  // Collapsing the active tab follows the same rule: its host keeps its content but cannot be hit.
  await groupOf(page, "settings").getByRole("tab", { name: "Discussions" }).click()
  await groupOf(page, "settings").getByRole("button", { name: "Discussions panel options" }).click()
  await page.getByRole("menuitem", { name: "Collapse" }).click()
  await page.getByRole("button", { name: "Expand Discussions" }).waitFor()
  assert.ok(await page.getByTestId("settings-panel").isVisible(), "Settings shows once Discussions collapses")
  assert.equal(await page.getByTestId("settings-scroll").evaluate((scroller) => {
    const rect = scroller.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return hit && scroller.contains(hit) ? "ok" : hit?.closest("[data-dock-panel]")?.getAttribute("data-dock-panel") ?? "nothing"
  }), "ok", "the collapsed list's host does not cover Settings")
  await page.getByRole("button", { name: "Expand Discussions" }).click()
  await host(page, "list").getByTestId("list-scroll").waitFor()
  await groupOf(page, "settings").getByRole("tab", { name: "Discussions" }).click()
  await assertListUsable("expanded again", 17)
  await page.getByTestId("toggle-settings").click()
  await page.getByTestId("reset").click()


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
  const desktopLayout = await page.evaluate(() => localStorage.getItem("story:dock:a:v2"))
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
  assert.equal(await page.evaluate(() => localStorage.getItem("story:dock:a:v2")), desktopLayout, "the narrow pass writes nothing")
  await page.setViewportSize({ width: 1440, height: 900 })
  await host(page, "list").waitFor()
  assert.equal(await zoneOf(page, "list"), "right", "desktop layout restored: list")
  assert.equal(await zoneOf(page, "console"), "bottom", "desktop layout restored: console")
  assert.ok(await sameComposer(), "desktop again: composer not remounted")
  assert.equal(await page.getByTestId("composer").inputValue(), "draft across breakpoints")
  assert.equal((await mounts(page)).chat, chatMounts, "chat mounted once across every breakpoint")
  assert.equal(await page.evaluate(() => localStorage.getItem("story:dock:a:v2")), desktopLayout)
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
  await phone.evaluate((layout) => localStorage.setItem("story:dock:a:v2", layout), desktopLayout)
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
  // A tap that lands while the fling still runs only stops it: tap again until the tab switches.
  for (let attempt = 0; attempt < 5 && !(await phone.getByTestId("composer").isVisible()); attempt += 1) {
    await phone.getByRole("tab", { name: "Chat" }).tap()
    await phone.getByTestId("composer").waitFor({ timeout: 2000 }).catch(() => {})
  }
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
