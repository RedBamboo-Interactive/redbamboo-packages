const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const os = require("node:os")
const { pathToFileURL } = require("node:url")
const { chromium } = require(require.resolve("playwright", { paths: [path.resolve(__dirname, "../../../testing")] }))

// Mounted shared-Chat fixture for "Rewind to before this message": the message menu on desktop and
// the touch sheet on a phone, the visible button on a refusal row whatever the menu preference, the
// confirmation, and the text coming back to the composer.
const REWIND = "message-rewind"
const LABEL = "Rewind to before this message"

async function main() {
  const packageRoot = path.resolve(__dirname, "../..")
  const scratch = process.env.REDLEAF_SCRATCH_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "chat-rollback-"))
  const shots = path.join(scratch, "chat-rollback")
  fs.mkdirSync(shots, { recursive: true })
  const { createServer } = await import(pathToFileURL(require.resolve("vite")))
  const tailwind = (await import(pathToFileURL(require.resolve("@tailwindcss/vite", { paths: [path.resolve(packageRoot, "../ui")] })))).default
  const server = await createServer({ configFile: false, root: __dirname, plugins: [tailwind()],
    cacheDir: path.join(scratch, "rollback-vite-cache"),
    resolve: { alias: {
      react: path.join(packageRoot, "node_modules/react"), "react-dom": path.join(packageRoot, "node_modules/react-dom"),
    } },
    server: { host: "127.0.0.1", port: 0, fs: { allow: [path.resolve(packageRoot, "../.."), scratch] } },
  })
  let browser
  const checks = []
  const check = name => checks.push(name)
  try {
    await server.listen()
    const origin = server.resolvedUrls.local[0]
    browser = await chromium.launch({ headless: true })

    const open = async (query, options = {}) => {
      const context = await browser.newContext({
        viewport: options.phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        isMobile: !!options.phone,
        hasTouch: !!options.phone,
      })
      const page = await context.newPage()
      const errors = []
      page.on("pageerror", error => errors.push(error.message))
      await page.goto(`${origin}?${query}`)
      await page.locator('[data-message-uid="user-1"]').first().waitFor()
      return { page, errors, close: () => context.close() }
    }
    const shot = (page, name) => page.screenshot({ path: path.join(shots, `${name}.png`) })
    const requests = page => page.evaluate(() => window.__requests.slice())
    const userText = (page, uid) => page.locator(`[data-message-uid="${uid}"] [data-chat-user-text]`)
    const errorButton = page => page.locator("[data-chat-error-rewind]")
    const dialog = page => page.locator("[data-chat-rollback-dialog]")
    const composer = page => page.locator("textarea").first()
    const menu = page => page.locator('[data-slot="leaf-context-menu"]')
    const menuIds = locator => locator.locator("[data-menu-item]").evaluateAll(elements =>
      elements.map(element => element.dataset.menuItem).filter(id => !id.startsWith("page-") && id !== "command-palette"))

    const rightClick = async (page, uid) => {
      await userText(page, uid).click({ button: "right", position: { x: 4, y: 4 } })
      await menu(page).waitFor()
    }
    const longPress = async (page, locator) => {
      await locator.scrollIntoViewIfNeeded()
      const box = await locator.boundingBox()
      const x = box.x + Math.min(box.width / 2, 24)
      const y = box.y + box.height / 2
      const cdp = await page.context().newCDPSession(page)
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] })
      await page.waitForTimeout(700)
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
      await cdp.detach()
      await page.waitForTimeout(150)
    }
    const expectConfirmation = async page => {
      await dialog(page).waitFor()
      const text = await dialog(page).innerText()
      assert(text.includes("Files are not changed"), "the confirmation says files are not changed")
      assert(text.includes("comes back to the composer"), "the confirmation says the message comes back")
    }
    const confirm = async page => {
      await dialog(page).getByRole("button", { name: "Rewind" }).click()
      await dialog(page).waitFor({ state: "detached" })
    }

    // ── Desktop, Leaf menu on ──────────────────────────────────────────────────
    {
      const { page, errors, close } = await open("leaf=1")
      await rightClick(page, "user-2")
      const ids = await menuIds(menu(page))
      assert(ids.includes(REWIND), "a person's message has the action")
      assert.equal(await menu(page).locator(`[data-menu-item="${REWIND}"]`).innerText(), LABEL)
      await shot(page, "01-desktop-message-menu")
      await menu(page).locator(`[data-menu-item="${REWIND}"]`).click()
      await expectConfirmation(page)
      await shot(page, "02-desktop-confirmation")
      assert.deepEqual(await requests(page), [], "nothing happens before the person confirms")

      await page.keyboard.press("Escape")
      await dialog(page).waitFor({ state: "detached" })
      assert.deepEqual(await requests(page), [], "cancelling does nothing")

      await composer(page).fill("something I was typing")
      await rightClick(page, "user-2")
      await menu(page).locator(`[data-menu-item="${REWIND}"]`).click()
      await confirm(page)
      assert.deepEqual(await requests(page), ["user-2"])
      await page.locator('[data-message-uid="user-2"]').waitFor({ state: "detached" })
      assert.equal(await page.locator('[data-message-uid="assistant-2"]').count(), 0, "everything after it left the view")
      assert.equal(await composer(page).inputValue(), "The message that was refused\n\nsomething I was typing",
        "the removed text comes back, without its hidden envelope, and nothing typed is lost")
      assert.equal(await page.evaluate(() => document.activeElement?.tagName), "TEXTAREA")
      await shot(page, "03-desktop-after-rewind")
      assert.deepEqual(errors, [])
      await close()
      check("desktop: menu item, confirmation, cancel, rewind, view and composer")
    }

    // An assistant's message does not have it.
    {
      const { page, errors, close } = await open("leaf=1")
      await page.locator('[data-message-uid="assistant-1"] [data-chat-assistant-text] p').first()
        .click({ button: "right", position: { x: 4, y: 4 } })
      await menu(page).waitFor()
      assert(!(await menuIds(menu(page))).includes(REWIND))
      assert.deepEqual(errors, [])
      await close()
      check("desktop: an assistant message has no rewind")
    }

    // ── A refusal row, whatever the Leaf menu preference ───────────────────────
    for (const [leaf, phone] of [[1, false], [0, false], [1, true], [0, true]]) {
      const label = `${phone ? "phone" : "desktop"}, menu ${leaf ? "on" : "off"}`
      const { page, errors, close } = await open(`leaf=${leaf}`, { phone })
      await errorButton(page).waitFor({ state: "visible" })
      assert.equal(await errorButton(page).innerText(), LABEL, label)
      await shot(page, `04-refusal-row-${phone ? "phone" : "desktop"}-${leaf ? "on" : "off"}`)
      await errorButton(page).click()
      await expectConfirmation(page)
      await shot(page, `05-refusal-confirm-${phone ? "phone" : "desktop"}-${leaf ? "on" : "off"}`)
      await confirm(page)
      assert.deepEqual(await requests(page), ["user-2"], `${label}: it targets the person's message before the error`)
      assert.equal(await composer(page).inputValue(), "The message that was refused", label)
      assert.equal(await errorButton(page).count(), 0, `${label}: the row went with it`)
      assert.deepEqual(errors, [])
      await close()
      check(`refusal row, ${label}: visible, confirmed, rewinds to the message before it`)
    }

    // ── Phone, Leaf menu on: the shared sheet ──────────────────────────────────
    {
      const { page, errors, close } = await open("leaf=1", { phone: true })
      await longPress(page, userText(page, "user-1"))
      const sheet = page.locator('[data-slot="leaf-context-sheet"]')
      await sheet.waitFor()
      assert((await menuIds(sheet)).includes(REWIND), "the touch sheet has the action")
      await shot(page, "06-phone-sheet")
      await sheet.locator(`[data-menu-item="${REWIND}"]`).click()
      await expectConfirmation(page)
      await confirm(page)
      assert.deepEqual(await requests(page), ["user-1"])
      assert.deepEqual(errors, [])
      await close()
      check("phone: long-press sheet, confirmation, rewind")
    }

    // ── Not offered ────────────────────────────────────────────────────────────
    for (const [query, why] of [
      ["leaf=1&capable=0", "a provider without the capability"],
      ["leaf=1&state=streaming", "a running turn"],
      ["leaf=1&state=question", "a parked question"],
      ["leaf=1&state=background", "running background work"],
    ]) {
      const { page, errors, close } = await open(query)
      await rightClick(page, "user-1")
      assert(!(await menuIds(menu(page))).includes(REWIND), `no menu item with ${why}`)
      await page.keyboard.press("Escape")
      assert.equal(await errorButton(page).count(), 0, `no refusal button with ${why}`)
      assert.deepEqual(errors, [])
      await close()
      check(`not offered with ${why}`)
    }

    // ── The server says no ─────────────────────────────────────────────────────
    {
      const { page, errors, close } = await open("leaf=1&refuse=1")
      await errorButton(page).click()
      await dialog(page).getByRole("button", { name: "Rewind" }).click()
      await dialog(page).getByRole("alert").waitFor()
      assert((await dialog(page).getByRole("alert").innerText()).includes("a turn is running"), "the server's words are shown")
      assert.equal(await page.locator('[data-message-uid="user-2"]').count() > 0, true, "the conversation is untouched")
      assert.equal(await composer(page).inputValue(), "", "nothing came back")
      await shot(page, "07-server-refused")
      assert.deepEqual(errors, [])
      await close()
      check("a server refusal stays in the dialog, in its words")
    }
  } finally {
    await browser?.close()
    await server.close()
  }
  fs.writeFileSync(path.join(shots, "results.json"), JSON.stringify(checks, null, 2))
  console.log(`${checks.length} rollback checks passed; screenshots in ${shots}`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
