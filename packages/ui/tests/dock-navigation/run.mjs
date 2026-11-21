// A docked pane keeps its own working Back through every dock move: standalone,
// as a tab in a group, across tab switches, and split back out. Each pane's
// history is its own; Back in one tab never walks another's. Standalone, Back is
// first in the dock's header row; in a tab group that row is shared by every
// tab, so Back moves into the pane: a compact `[Back] title` row of its own.
import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { createServer } from "vite"

const fixtureDir = path.dirname(fileURLToPath(import.meta.url))
const outputDir = path.join(process.env.REDLEAF_SCRATCH_DIR || process.env.TEMP, "ui-dock-navigation")
await mkdir(outputDir, { recursive: true })

const server = await createServer({
  root: fixtureDir,
  configFile: path.join(fixtureDir, "..", "dock", "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0 },
  logLevel: "error",
})

const box = async (locator) => {
  const rect = await locator.boundingBox()
  assert.ok(rect, "element has no box")
  return rect
}

async function drag(page, handle, to, fromX = 80) {
  const from = await box(handle)
  const startX = from.x + Math.min(fromX, from.width / 2)
  const startY = from.y + from.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await page.locator('[data-slot="dock-drag-overlay"]').waitFor()
  const target = await page.locator('[data-slot="dock-drag-overlay"]').getAttribute("data-dock-drop-target")
  await page.mouse.up()
  await page.locator('[data-slot="dock-drag-overlay"]').waitFor({ state: "detached" })
  return target
}

async function pointIn(locator, fx, fy) {
  const rect = await box(locator)
  return { x: rect.x + rect.width * fx, y: rect.y + rect.height * fy }
}

const groupOf = (page, panelId) => page.locator("[data-dock-group]", { has: page.locator(`[data-dock-panel="${panelId}"]`) })
const rowOf = (page, panelId) => groupOf(page, panelId).locator("[data-dock-group-header]")
const location = (page, panelId) => page.getByTestId(`${panelId}-pane`).getAttribute("data-location")
const mounts = (page) => page.evaluate(() => ({ ...window.__mounts }))
const BACK = { name: /^Back in / }
const FIRST_PAGE = { pages: "Alpha", bookmarks: "Inbox" }
const paneRow = (page, panelId) => page.locator(`[data-dock-panel="${panelId}"] [data-slot="panel-header-back-row"]`)
/** Standalone, Back is in the dock row; in a tab group, in the pane's own row. */
const backIn = (page, panelId) => rowOf(page, panelId).getByRole("button", BACK).or(paneRow(page, panelId).getByRole("button", BACK))

/** A standalone pane's Back is first in its header row (or absent without history). */
async function assertRowBack(page, panelId, title, expected, step) {
  const back = rowOf(page, panelId).getByRole("button", BACK)
  assert.equal(await paneRow(page, panelId).count(), 0, `${step}: no in-pane row when standalone`)
  if (!expected) {
    assert.equal(await back.count(), 0, `${step}: no Back without history`)
    return
  }
  assert.equal(await back.count(), 1, `${step}: one Back in the header row`)
  assert.equal(await back.getAttribute("aria-label"), `Back in ${title}`, `${step}: the Back is ${title}'s own`)
  assert.ok(await back.isVisible(), `${step}: Back is visible`)
}

/**
 * A tabbed pane: the shared dock row never carries a Back. With history the
 * active pane shows `[Back] current` at the top of its own content; without, no row.
 */
async function assertTabBack(page, panelId, title, current, step) {
  assert.equal(await rowOf(page, panelId).getByRole("button", BACK).count(), 0, `${step}: no Back in the shared tab row`)
  const row = paneRow(page, panelId)
  if (!current) {
    assert.equal(await row.count(), 0, `${step}: no Back row without history`)
    return
  }
  assert.equal(await row.count(), 1, `${step}: one Back row in the pane`)
  const back = row.getByRole("button", BACK)
  assert.equal(await back.getAttribute("aria-label"), `Back in ${title}`, `${step}: the Back is ${title}'s own`)
  assert.ok(await back.isVisible(), `${step}: Back is visible`)
  assert.equal(await row.getByText(current, { exact: true }).count(), 1, `${step}: the row names the current page`)
  assert.equal(await rowOf(page, panelId).getByText(current, { exact: true }).count(), 0, `${step}: the page title is not in the shared row`)
  // The row tops the pane's content, before the page itself.
  const rowBox = await box(row)
  const hostBox = await box(page.locator(`[data-dock-panel="${panelId}"]`))
  const bodyBox = await box(page.getByTestId(`${panelId}-open-${FIRST_PAGE[panelId]}`))
  assert.ok(Math.abs(rowBox.y - hostBox.y) <= 1 && rowBox.y + rowBox.height <= bodyBox.y, `${step}: the row tops the pane`)
}

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

  const open = async (slot) => {
    await page.goto(`${baseUrl}${slot ? `?slot=${slot}` : ""}`, { waitUntil: "networkidle" })
    await page.evaluate(() => localStorage.clear())
    await page.reload({ waitUntil: "networkidle" })
    await page.getByTestId("pages-pane").waitFor()
  }

  // --- standalone: Back appears with history and walks it -----------------
  await open()
  assert.notEqual(await groupOf(page, "pages").getAttribute("data-dock-group"), await groupOf(page, "bookmarks").getAttribute("data-dock-group"), "two standalone panes")
  await assertRowBack(page, "pages", "Pages", false, "standalone, no history")
  await page.getByTestId("pages-open-Alpha").click()
  await page.getByTestId("pages-open-Beta").click()
  await page.getByTestId("pages-open-Gamma").click()
  assert.equal(await location(page, "pages"), "Alpha/Beta/Gamma")
  await assertRowBack(page, "pages", "Pages", true, "standalone")
  await backIn(page, "pages").click()
  assert.equal(await location(page, "pages"), "Alpha/Beta", "standalone Back pops one entry")
  assert.equal(await rowOf(page, "pages").getByText("Beta", { exact: true }).count(), 1, "standalone shows the current page title")
  await page.getByTestId("bookmarks-open-Inbox").click()
  await assertRowBack(page, "bookmarks", "Bookmarks", true, "second standalone")
  await page.screenshot({ path: path.join(outputDir, "01-standalone.png") })
  const baseline = await mounts(page)
  assert.deepEqual(baseline, { pages: 1, bookmarks: 1 })

  // --- merge: drag Pages onto Bookmarks ---------------------------------
  const tabbed = await drag(page, rowOf(page, "pages"), await pointIn(groupOf(page, "bookmarks"), 0.5, 0.5))
  assert.match(tabbed, /^tab:/)
  const tablist = groupOf(page, "pages").getByRole("tablist")
  assert.deepEqual(await tablist.getByRole("tab").allTextContents(), ["Bookmarks", "Pages"])
  assert.equal(await tablist.getByRole("tab", { name: "Pages" }).getAttribute("aria-selected"), "true")
  // State first: the move neither remounts the pane nor touches its history.
  assert.deepEqual(await mounts(page), baseline, "merge: no remount")
  assert.equal(await location(page, "pages"), "Alpha/Beta", "merge: Pages keeps its history")
  assert.equal(await location(page, "bookmarks"), "Inbox", "merge: Bookmarks keeps its history")
  await assertTabBack(page, "pages", "Pages", "Beta", "tab after merge")
  await page.screenshot({ path: path.join(outputDir, "02-tabbed.png") })
  await backIn(page, "pages").click()
  assert.equal(await location(page, "pages"), "Alpha", "tab Back pops the active pane")
  assert.equal(await location(page, "bookmarks"), "Inbox", "tab Back never walks another tab")
  await page.screenshot({ path: path.join(outputDir, "03-tab-after-back.png") })

  // --- switch tabs: each tab shows its own Back -------------------------
  await tablist.getByRole("tab", { name: "Bookmarks" }).click()
  await assertTabBack(page, "bookmarks", "Bookmarks", "Inbox", "after switching to Bookmarks")
  // The inactive tab keeps its own row, hidden and inert with its pane.
  assert.equal(await paneRow(page, "pages").count(), 1, "Pages keeps its row while inactive")
  assert.equal(await paneRow(page, "pages").isVisible(), false, "an inactive tab's Back is not shown")
  await backIn(page, "bookmarks").click()
  assert.equal(await location(page, "bookmarks"), "", "Bookmarks Back pops Bookmarks")
  assert.equal(await location(page, "pages"), "Alpha", "Bookmarks Back leaves Pages alone")
  // A tab without history behaves like a standalone pane without history.
  await assertTabBack(page, "bookmarks", "Bookmarks", null, "tab without history")
  await tablist.getByRole("tab", { name: "Pages" }).click()
  await assertTabBack(page, "pages", "Pages", "Alpha", "after switching back to Pages")
  await page.getByTestId("pages-open-Gamma").click()
  assert.equal(await location(page, "pages"), "Alpha/Gamma")

  // --- split: drag the Pages tab out below Bookmarks ----------------------
  const split = await drag(page, tablist.getByRole("tab", { name: "Pages" }), await pointIn(groupOf(page, "bookmarks"), 0.5, 0.94), 20)
  assert.match(split, /^split:.*:after$/)
  assert.notEqual(await groupOf(page, "pages").getAttribute("data-dock-group"), await groupOf(page, "bookmarks").getAttribute("data-dock-group"), "split: two groups again")
  assert.deepEqual(await mounts(page), baseline, "split: no remount")
  await assertRowBack(page, "pages", "Pages", true, "split")
  await assertRowBack(page, "bookmarks", "Bookmarks", false, "split, no history")
  assert.equal(await rowOf(page, "pages").getByText("Gamma", { exact: true }).count(), 1, "split: the title is back in the row")
  await backIn(page, "pages").click()
  assert.equal(await location(page, "pages"), "Alpha", "split Back pops one entry")
  await backIn(page, "pages").click()
  assert.equal(await location(page, "pages"), "")
  await assertRowBack(page, "pages", "Pages", false, "split, history emptied")
  await page.screenshot({ path: path.join(outputDir, "04-split.png") })

  // --- the identity slot is what a tab group hides --------------------------
  await open("leading")
  await page.getByTestId("pages-open-Alpha").click()
  await assertRowBack(page, "pages", "Pages", true, "leading, standalone")
  await drag(page, rowOf(page, "pages"), await pointIn(groupOf(page, "bookmarks"), 0.5, 0.5))
  assert.equal(await backIn(page, "pages").count(), 0, "leading is identity: a tab group hides it")
  assert.equal(await paneRow(page, "pages").count(), 0, "without `back` a tab gets no extra row")

  assert.deepEqual(errors, [])
  console.log(`dock navigation story passed; screenshots in ${outputDir}`)
} finally {
  await browser?.close()
  await server.close()
}
