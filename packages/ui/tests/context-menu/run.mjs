import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { createServer } from "vite"

const fixtureDir = path.dirname(fileURLToPath(import.meta.url))
const outputDir = path.join(process.env.REDLEAF_SCRATCH_DIR || process.env.TEMP, "ui-context-menu")
await mkdir(outputDir, { recursive: true })

const server = await createServer({
  root: fixtureDir,
  configFile: path.join(fixtureDir, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0 },
  logLevel: "error",
})

const ROW_ITEMS = ["info", "rename", "pinned", "busy", "move", "close"]

/** Normalised rendering of the row's items, for ⋮ vs context-menu parity. */
function describeItems(root) {
  return root.locator("[data-menu-item]").evaluateAll((elements, ids) => elements
    .filter((element) => ids.includes(element.dataset.menuItem))
    .map((element) => ({
      id: element.dataset.menuItem,
      slot: element.dataset.slot,
      role: element.getAttribute("role"),
      text: element.textContent.trim(),
      variant: element.dataset.variant ?? null,
      disabled: element.hasAttribute("data-disabled"),
      checked: element.getAttribute("aria-checked"),
      className: element.className,
      icon: element.querySelector(":scope > i")?.className ?? null,
      shortcut: element.querySelector('[data-slot="dropdown-menu-shortcut"]')?.textContent ?? null,
      uiAction: element.dataset.uiAction ?? null,
      separatorBefore: element.previousElementSibling?.dataset.slot === "dropdown-menu-separator",
    })), ROW_ITEMS)
}

let browser
try {
  await server.listen()
  const baseUrl = server.resolvedUrls?.local[0]
  assert.ok(baseUrl, "Vite did not expose a local story URL")
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined })
  const context = await browser.newContext({ viewport: { width: 1100, height: 760 } })
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseUrl })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("404")) errors.push(message.text())
  })

  const leafMenu = page.locator('[data-slot="leaf-context-menu"]')
  const sheet = page.locator('[data-slot="leaf-context-sheet"]')
  const row = (id) => page.locator(`[data-row="${id}"]`)
  const ran = () => page.evaluate(() => window.__ran.slice())
  const prevented = () => page.evaluate(() => window.__lastPrevented)
  const resetPrevented = () => page.evaluate(() => { window.__lastPrevented = null })
  const closeMenus = async () => {
    await page.keyboard.press("Escape")
    await leafMenu.waitFor({ state: "detached" })
  }
  const expectNoLeafMenu = async (label) => {
    await page.waitForTimeout(150) // a menu would open synchronously on the event; give React one frame
    assert.equal(await leafMenu.count(), 0, `${label}: no Leaf menu`)
  }

  await page.goto(baseUrl, { waitUntil: "networkidle" })
  assert.equal(await page.evaluate(() => window.__contextListeners()), 6, "the host's six listeners when on")
  assert.ok(await page.evaluate(() => window.__hasTarget('[data-row="alpha"]')), "row registered when on")

  // --- object row: sections and parity with the ⋮ menu ------------------------
  await row("alpha").getByRole("button", { name: "Actions for alpha" }).click()
  const dropdown = page.locator('[data-slot="dropdown-menu-content"]').first()
  await dropdown.waitFor()
  const kebabItems = await describeItems(dropdown)
  await page.screenshot({ path: path.join(outputDir, "kebab-row-menu.png") })
  await page.keyboard.press("Escape")
  await dropdown.waitFor({ state: "detached" })

  await resetPrevented()
  await row("alpha").getByText("Row alpha").click({ button: "right" })
  await leafMenu.waitFor()
  assert.equal(await prevented(), true, "Leaf menu prevents the native one")
  const contextItems = await describeItems(leafMenu)
  assert.deepEqual(contextItems.map((item) => item.id), ROW_ITEMS)
  assert.deepEqual(contextItems, kebabItems, "⋮ and context menu render the same descriptors identically")
  assert.equal(await leafMenu.locator('[data-slot="leaf-context-menu-page"] [data-menu-item]').count(), 4, "page icon row")
  assert.equal(await leafMenu.locator('[data-menu-item="command-palette"]').count(), 1, "palette entry")
  const order = await leafMenu.locator("[data-menu-item]").evaluateAll((els) => els.map((el) => el.dataset.menuItem))
  assert.deepEqual(order, [...ROW_ITEMS, "page-back", "page-forward", "page-reload", "page-copy-link", "command-palette"])
  await page.screenshot({ path: path.join(outputDir, "context-row-menu.png") })

  // --- keyboard: arrows, submenu, Enter ----------------------------------------
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("ArrowDown")
  assert.equal(await leafMenu.locator("[data-highlighted]").getAttribute("data-menu-item"), "rename", "arrow keys move through items")
  await page.keyboard.press("ArrowDown") // pinned
  await page.keyboard.press("ArrowDown") // busy: Base UI keeps disabled items focusable, not runnable
  assert.equal(await leafMenu.locator("[data-highlighted]").getAttribute("data-menu-item"), "busy")
  await page.keyboard.press("Enter")
  assert.equal(await leafMenu.count(), 1, "a disabled item does not run or close")
  await page.keyboard.press("ArrowDown") // move
  await page.keyboard.press("ArrowRight")
  const submenu = page.locator('[data-slot="dropdown-menu-sub-content"]')
  await submenu.waitFor()
  await submenu.locator('[data-menu-item="move-inbox"][data-highlighted]').waitFor()
  await page.keyboard.press("ArrowDown")
  await submenu.locator('[data-menu-item="move-archive"][data-highlighted]').waitFor()
  await page.keyboard.press("Enter")
  await leafMenu.waitFor({ state: "detached" })
  assert.deepEqual((await ran()).slice(-1), ["alpha:archive"], "submenu item ran from the keyboard")

  // --- async items are waited for briefly, so the first frame already has them ----
  await page.getByText("Async row").click({ button: "right" })
  await leafMenu.waitFor()
  assert.equal(await leafMenu.locator("[data-menu-item]").first().getAttribute("data-menu-item"), "async-delete", "async section present on open")
  await closeMenus()

  // --- a slow permission check never holds back the rest of the section --------------
  await page.getByText("Slow entity").click({ button: "right" })
  await leafMenu.waitFor()
  assert.equal(await leafMenu.locator('[data-menu-item="story-open"]').count(), 1, "sync items open without waiting")
  assert.equal(await leafMenu.locator('[data-menu-item="story-delete"]').count(), 0)
  await leafMenu.locator('[data-menu-item="story-delete"]').waitFor()
  const slowIds = await leafMenu.locator("[data-menu-item]").evaluateAll((els) => els.map((el) => el.dataset.menuItem))
  assert.deepEqual(slowIds.slice(0, 2), ["story-open", "story-delete"], "deferred item lands in its provider's group")
  await closeMenus()

  // --- a scoped target's menu renders in its own portal container ------------------
  await page.getByText("Scoped row").click({ button: "right" })
  await leafMenu.waitFor()
  assert.equal(await leafMenu.evaluate((element) => Boolean(element.closest('[data-story-scope="plugin"]'))), true, "menu portals into the target's scope")
  assert.equal(await leafMenu.locator('[data-menu-item="scoped-float"]').isVisible(), false, "the scope's own CSS applies to its items")
  await closeMenus()

  // --- viewport collision at the bottom-right corner ---------------------------
  const corner = await row("corner").getByText("Row corner").boundingBox()
  await page.mouse.click(corner.x + corner.width - 4, corner.y + corner.height - 4, { button: "right" })
  await leafMenu.waitFor()
  const menuBox = await leafMenu.boundingBox()
  const viewport = page.viewportSize()
  assert.ok(menuBox.x >= 0 && menuBox.y >= 0, "menu inside the top-left")
  assert.ok(menuBox.x + menuBox.width <= viewport.width && menuBox.y + menuBox.height <= viewport.height, "menu flipped/shifted inside the viewport")
  await page.screenshot({ path: path.join(outputDir, "context-corner-collision.png") })
  await closeMenus()

  // --- link, media, selection, empty space --------------------------------------
  await page.getByText("Internal link").click({ button: "right" })
  await leafMenu.waitFor()
  assert.deepEqual(await leafMenu.locator("[data-menu-item]").evaluateAll((els) => els.map((el) => el.dataset.menuItem)),
    ["link-open", "link-open-tab", "link-copy", "page-back", "page-forward", "page-reload", "page-copy-link", "command-palette"])
  await page.screenshot({ path: path.join(outputDir, "context-link.png") })
  await leafMenu.locator('[data-menu-item="link-copy"]').click()
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), new URL("/apps/nova/chat/42", baseUrl).href, "Copy link")
  await page.getByText("Internal link").click({ button: "right" })
  await leafMenu.locator('[data-menu-item="link-open"]').click()
  assert.deepEqual(await page.evaluate(() => window.__navigated.slice()), ["/apps/nova/chat/42"], "internal link opens through the navigate adapter")

  await page.getByTestId("pic").click({ button: "right" })
  await leafMenu.waitFor()
  const mediaIds = await leafMenu.locator("[data-menu-item]").evaluateAll((els) => els.map((el) => el.dataset.menuItem))
  assert.deepEqual(mediaIds.slice(0, 4), ["image-open", "image-save", "image-copy", "image-copy-url"], "image items, Copy image in a secure context")
  await closeMenus()

  await page.getByTestId("prose").selectText()
  const prose = await page.getByTestId("prose").boundingBox()
  await page.mouse.click(prose.x + 20, prose.y + prose.height / 2, { button: "right" })
  await leafMenu.waitFor()
  assert.equal(await leafMenu.locator("[data-menu-item]").first().getAttribute("data-menu-item"), "selection-copy")
  await leafMenu.locator('[data-menu-item="selection-copy"]').click()
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "Selectable prose for the copy item.")
  await page.evaluate(() => getSelection().removeAllRanges())

  await page.getByTestId("empty").click({ button: "right" })
  await leafMenu.waitFor()
  assert.deepEqual(await leafMenu.locator("[data-menu-item]").evaluateAll((els) => els.map((el) => el.dataset.menuItem)),
    ["page-back", "page-forward", "page-reload", "page-copy-link", "command-palette"])
  await page.screenshot({ path: path.join(outputDir, "context-empty-space.png") })
  await leafMenu.locator('[data-menu-item="command-palette"]').click()
  assert.equal(await page.evaluate(() => window.__palette), 1)

  // --- native passthrough -------------------------------------------------------
  for (const testId of ["input", "textarea", "editable", "native-child"]) {
    await resetPrevented()
    await page.getByTestId(testId).click({ button: "right" })
    await expectNoLeafMenu(testId)
    assert.equal(await prevented(), false, `${testId}: browser menu allowed`)
  }
  await resetPrevented()
  await row("beta").getByText("Row beta").click({ button: "right", modifiers: ["Shift"] })
  await expectNoLeafMenu("shift")
  assert.equal(await prevented(), false, "Shift+right-click: browser menu allowed")

  await resetPrevented()
  await page.getByTestId("none-zone").click({ button: "right" })
  await expectNoLeafMenu("data-context-menu=none")
  assert.equal(await prevented(), true, "data-context-menu=none suppresses the browser menu too")

  await page.getByTestId("base-trigger").click({ button: "right" })
  await page.getByTestId("base-menu").waitFor()
  await expectNoLeafMenu("Base UI ContextMenu trigger")
  assert.equal(await page.evaluate(() => window.__baseMenuOpened), 1, "existing Base UI context menu still opens")
  await page.keyboard.press("Escape")
  await page.getByTestId("base-menu").waitFor({ state: "detached" })

  // Right-drag: synthetic, since the platform decides whether contextmenu follows down or up.
  const dragPrevented = await page.evaluate(() => {
    const target = document.querySelector('[data-row="beta"] button')
    const rect = target.getBoundingClientRect()
    const x = rect.left + 10
    const y = rect.top + 5
    target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true, button: 2, buttons: 2, pointerType: "mouse", clientX: x, clientY: y }))
    target.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, composed: true, buttons: 2, pointerType: "mouse", clientX: x + 30, clientY: y }))
    const event = new PointerEvent("contextmenu", { bubbles: true, cancelable: true, composed: true, button: 2, pointerType: "mouse", clientX: x + 30, clientY: y })
    target.dispatchEvent(event)
    return event.defaultPrevented
  })
  await expectNoLeafMenu("right-drag")
  assert.equal(dragPrevented, true, "right-drag shows neither menu")

  // --- touch long-press opens a bottom sheet ------------------------------------
  const pressTouch = (selector, move = 0) => page.evaluate(({ selector, move }) => {
    const target = document.querySelector(selector)
    const rect = target.getBoundingClientRect()
    const x = rect.left + 12
    const y = rect.top + rect.height / 2
    target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true, pointerType: "touch", pointerId: 7, isPrimary: true, clientX: x, clientY: y }))
    if (move) target.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, composed: true, pointerType: "touch", pointerId: 7, clientX: x + move, clientY: y }))
    window.__touchAt = { x, y }
  }, { selector, move })
  const releaseTouch = (selector) => page.evaluate((selector) => {
    const target = document.querySelector(selector)
    const { x, y } = window.__touchAt
    target.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, composed: true, pointerType: "touch", pointerId: 7, clientX: x, clientY: y }))
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y }))
  }, selector)

  const clicksBefore = await page.evaluate(() => window.__rowClicks)
  await pressTouch('[data-row="alpha"] button')
  await page.waitForTimeout(650) // measured: the 500 ms long-press
  await sheet.waitFor()
  await releaseTouch('[data-row="alpha"] button')
  assert.equal(await page.evaluate(() => window.__rowClicks), clicksBefore, "the release that ends a long-press does not activate the row")
  assert.equal(await sheet.isVisible(), true, "sheet survives the release")
  assert.deepEqual(await sheet.locator("[data-menu-item]").evaluateAll((els) => els.map((el) => el.dataset.menuItem)), ROW_ITEMS, "sheet: object items only")
  await page.screenshot({ path: path.join(outputDir, "touch-sheet.png") })
  await sheet.locator('[data-menu-item="move"]').click()
  await sheet.locator('[data-menu-item="move-inbox"]').click()
  await sheet.waitFor({ state: "detached" })
  assert.deepEqual((await ran()).slice(-1), ["alpha:inbox"], "sheet submenu item ran")

  await pressTouch('[data-row="alpha"] button', 20)
  await page.waitForTimeout(650)
  assert.equal(await sheet.count(), 0, "moving cancels the long-press")
  await releaseTouch('[data-row="alpha"] button')

  for (const selector of ['[data-testid="chat-row"]', '[data-testid="base-trigger"]', '[data-testid="empty"]']) {
    await pressTouch(selector)
    await page.waitForTimeout(650)
    assert.equal(await sheet.count(), 0, `${selector}: no sheet`)
    await releaseTouch(selector)
  }

  // --- toggle off: byte-for-byte native ------------------------------------------
  await page.evaluate(() => window.__setEnabled(false))
  await page.waitForFunction(() => window.__contextListeners() === 0)
  assert.equal(await page.evaluate(() => window.__hasTarget('[data-row="alpha"]')), false, "registrations dropped when off")
  for (const target of [row("alpha").getByText("Row alpha"), page.getByTestId("empty"), page.getByText("Internal link")]) {
    await resetPrevented()
    await target.click({ button: "right" })
    await expectNoLeafMenu("off")
    assert.equal(await prevented(), false, "off: browser menu allowed")
  }
  await pressTouch('[data-row="alpha"] button')
  await page.waitForTimeout(650)
  assert.equal(await sheet.count(), 0, "off: no long-press sheet")
  await releaseTouch('[data-row="alpha"] button')
  await page.getByTestId("base-trigger").click({ button: "right" })
  await page.getByTestId("base-menu").waitFor()
  await page.keyboard.press("Escape")
  await row("alpha").getByRole("button", { name: "Actions for alpha" }).click()
  await page.locator('[data-slot="dropdown-menu-content"]').waitFor()
  assert.deepEqual(await describeItems(page.locator('[data-slot="dropdown-menu-content"]')), kebabItems, "off: ⋮ menu unchanged")
  await page.keyboard.press("Escape")

  await page.evaluate(() => window.__setEnabled(true))
  await page.waitForFunction(() => window.__contextListeners() === 6)
  assert.equal(await page.evaluate(() => window.__hasTarget('[data-row="alpha"]')), true, "on again: row re-registers")

  assert.deepEqual(errors, [])
  console.log(`context menu fixture passed; screenshots in ${outputDir}`)
} finally {
  await browser?.close()
  await server.close()
}
