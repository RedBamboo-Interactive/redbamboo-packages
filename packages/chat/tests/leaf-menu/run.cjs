const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const os = require("node:os")
const { pathToFileURL } = require("node:url")
const { chromium } = require(require.resolve("playwright", { paths: [path.resolve(__dirname, "../../../testing")] }))

// Mounted shared-Chat fixture for the Leaf context menu: message, code-block,
// activity-square and media menus while the preference is on, the touch
// long-press hand-off per host, and the unchanged rendering while it is off.
async function main() {
  const packageRoot = path.resolve(__dirname, "../..")
  const scratch = process.env.REDLEAF_SCRATCH_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "chat-leaf-menu-"))
  const shots = path.join(scratch, "chat-leaf-menu")
  fs.mkdirSync(shots, { recursive: true })
  const { createServer } = await import(pathToFileURL(require.resolve("vite")))
  const tailwind = (await import(pathToFileURL(require.resolve("@tailwindcss/vite", { paths: [path.resolve(packageRoot, "../ui")] })))).default
  const server = await createServer({ configFile: false, root: __dirname, plugins: [tailwind()], logLevel: "error",
    cacheDir: path.join(scratch, "leaf-menu-vite-cache"),
    resolve: { alias: {
      react: path.join(packageRoot, "node_modules/react"), "react-dom": path.join(packageRoot, "node_modules/react-dom"),
    } },
    server: { host: "127.0.0.1", port: 0, fs: { allow: [path.resolve(packageRoot, "../.."), scratch] } },
  })
  let browser
  const checks = []
  const check = (name) => checks.push(name)
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
        permissions: ["clipboard-read", "clipboard-write"],
      })
      const page = await context.newPage()
      const errors = []
      page.on("pageerror", error => errors.push(error.message))
      await page.goto(`${origin}?${query}`)
      await page.locator('[data-message-uid="assistant-1"]').first().waitFor()
      return { page, errors, close: () => context.close() }
    }
    const fixture = page => page.evaluate(() => window.__fixture)
    const events = page => page.evaluate(() => window.__events.slice())
    // The Windows clipboard stores line breaks as CRLF; compare the text.
    const clipboard = page => page.evaluate(() => navigator.clipboard.readText()).then(text => text.replace(/\r\n/g, "\n"))
    const clearClipboard = page => page.evaluate(() => navigator.clipboard.writeText(""))
    const menuIds = locator => locator.locator("[data-menu-item]").evaluateAll(elements => elements.map(element => element.dataset.menuItem))
    const shot = (page, name) => page.screenshot({ path: path.join(shots, `${name}.png`) })
    // The assistant message renders as two text segments around its activity row;
    // the last segment owns the hover rail.
    const assistant = page => page.locator('[data-message-uid="assistant-1"]')
    const owner = page => assistant(page).last()
    const firstCode = page => assistant(page).locator('[data-chat-assistant-text] pre').first()

    // ── Desktop, menu on, a host that describes its side actions ──────────────
    {
      const { page, errors, close } = await open("leaf=1&host=nova")
      const data = await fixture(page)
      const menu = page.locator('[data-slot="leaf-context-menu"]')
      const rightClick = async (locator) => {
        await locator.click({ button: "right", position: { x: 4, y: 4 } })
        await menu.waitFor()
      }
      const closeMenu = async () => {
        await page.keyboard.press("Escape")
        await menu.waitFor({ state: "detached" })
      }
      const choose = async (id) => {
        await menu.locator(`[data-menu-item="${id}"]`).click()
        await menu.waitFor({ state: "detached" })
      }

      // Code block: visible Copy, then the right-click item; both copy the source.
      const code = firstCode(page)
      const source = data.CODE_SOURCE.replace(/\n$/, "")
      await code.hover()
      await clearClipboard(page)
      await code.locator('[data-slot="chat-code-copy"]').click()
      assert.equal(await clipboard(page), source, "Copy button copies the authored source")
      await code.locator('[data-slot="chat-code-copy"][aria-label="Copied"]').waitFor()
      await shot(page, "01-code-copy-hover")
      await clearClipboard(page)
      await rightClick(code.locator("code"))
      assert.deepEqual((await menuIds(menu)).filter(id => !id.startsWith("page-") && id !== "command-palette"), ["code-copy"], "a code block's own menu")
      await shot(page, "02-code-context-menu")
      await choose("code-copy")
      assert.equal(await clipboard(page), source, "Copy code copies the authored source")
      check("code copy (button and menu) equals the fenced source")

      // Message: copy pair, host React, Info, from any text segment of the message.
      const paragraph = assistant(page).first().locator("[data-chat-assistant-text] p").first()
      await rightClick(paragraph)
      const messageIds = (await menuIds(menu)).filter(id => !id.startsWith("page-"))
      assert.deepEqual(messageIds, ["message-copy-text", "message-copy-markdown", "message-react", "message-info"])
      await shot(page, "03-message-context-menu")
      await clearClipboard(page)
      await choose("message-copy-markdown")
      assert.equal(await clipboard(page), `${data.ASSISTANT_FIRST}\n\n${data.ASSISTANT_LAST}`, "Copy as Markdown is the text parts")
      await rightClick(paragraph)
      await choose("message-copy-text")
      const text = await clipboard(page)
      assert(text.startsWith("Here is the fix:") && !text.includes("**") && text.includes('return "x"') && text.includes("See"), `Copy text is the rendered text: ${JSON.stringify(text)}`)
      await rightClick(paragraph)
      await menu.locator('[data-menu-item="message-react"]').hover()
      await page.locator('[data-menu-item="message-react:🔥"]').click()
      await menu.waitFor({ state: "detached" })
      assert.deepEqual(await events(page), ["react:assistant-1:🔥"])
      await rightClick(paragraph)
      await choose("message-info")
      await page.getByRole("heading", { name: "Message Info" }).waitFor()
      await shot(page, "04-message-info")
      await page.keyboard.press("Escape")
      await page.getByRole("heading", { name: "Message Info" }).waitFor({ state: "detached" })
      check("message menu: Copy text, Copy as Markdown, React, Info")

      // A person's message copies what the bubble renders, without the envelope.
      await rightClick(page.locator('[data-message-uid="user-1"] [data-chat-user-text] p').first())
      await clearClipboard(page)
      await choose("message-copy-markdown")
      assert.equal(await clipboard(page), data.USER_TEXT)
      check("user Copy as Markdown drops the nova-context envelope")

      await rightClick(owner(page).locator("[data-chat-assistant-text] p").first())
      assert.deepEqual((await menuIds(menu)).filter(id => !id.startsWith("page-")), messageIds, "every segment has the message's menu")
      await closeMenu()

      // The hover ⋮ shows the same items.
      await owner(page).locator("[data-chat-assistant-text] p").first().hover()
      const kebab = owner(page).getByRole("button", { name: "Message actions" })
      await kebab.click()
      const dropdown = page.locator('[data-slot="chat-message-actions"]')
      await dropdown.waitFor()
      assert.deepEqual(await menuIds(dropdown), messageIds, "⋮ and context menu render one array")
      await shot(page, "05-message-kebab")
      await page.keyboard.press("Escape")
      await dropdown.waitFor({ state: "detached" })
      check("hover ⋮ lists the context menu's items")

      // Squares keep their geometry and click, and gain their own menu.
      const read = page.getByRole("button", { name: "Read", exact: true })
      const box = await read.boundingBox()
      assert(Math.abs(box.width - 10) < 0.5 && Math.abs(box.height - 10) < 0.5, `square stays 10x10, got ${box.width}x${box.height}`)
      await rightClick(read)
      assert.deepEqual((await menuIds(menu)).filter(id => !id.startsWith("page-")), ["part-open-details", "part-open-file"])
      await shot(page, "06-square-context-menu")
      await choose("part-open-file")
      assert.deepEqual((await events(page)).slice(-1), ["open-file:T:/Projects/example/src/app.ts:12"])
      await rightClick(read)
      await choose("part-open-details")
      const dialog = page.locator('[data-slot="dialog-content"]')
      await dialog.getByRole("heading", { name: "Read", exact: true }).waitFor()
      await page.keyboard.press("Escape")
      await dialog.waitFor({ state: "detached" })
      await read.click()
      await dialog.getByRole("heading", { name: "Read", exact: true }).waitFor()
      await page.keyboard.press("Escape")
      await dialog.waitFor({ state: "detached" })
      const job = page.locator("button[data-part-index]").nth(1)
      await rightClick(job)
      assert.deepEqual((await menuIds(menu)).filter(id => !id.startsWith("page-")), ["part-open-details", "part-open-job"])
      await choose("part-open-job")
      assert.match((await events(page)).slice(-1)[0], /^navigate:\/apps\/compute\/jobs\?select=job-42$/)
      check("square menu: Open details, Open in editor, Open job in Compute; click unchanged")

      // Chat thumbnails are their full image; links keep the built-ins.
      await rightClick(owner(page).locator('[data-slot="chat-image-embed"]'))
      const imageIds = await menuIds(menu)
      assert(imageIds.includes("message-copy-text") && imageIds.includes("image-open") && imageIds.includes("image-copy-url"), imageIds.join(","))
      await shot(page, "07-image-context-menu")
      await clearClipboard(page)
      await choose("image-copy-url")
      assert.equal(await clipboard(page), `${origin.replace(/\/$/, "")}/pic.svg`)
      await rightClick(owner(page).getByRole("link", { name: /the docs/ }))
      assert((await menuIds(menu)).includes("link-copy"))
      await closeMenu()
      check("chat image thumbnail and link get media and link items")

      // A local file link declares its file: Copy path after the message's items.
      await rightClick(owner(page).locator('[data-slot="local-file-link"]'))
      const fileIds = await menuIds(menu)
      assert(fileIds.indexOf("message-copy-text") < fileIds.indexOf("file-copy-path") && fileIds.includes("file-copy-path"), fileIds.join(","))
      await shot(page, "08-local-file-context-menu")
      await clearClipboard(page)
      await choose("file-copy-path")
      assert.equal(await clipboard(page), "T:/Projects/example/src/app.ts")
      check("local file link: Copy path after the message items")

      assert.deepEqual(errors, [], "no page errors with the menu on")
      await close()
    }

    // ── Markdown parity: on adds only the Copy button and the pre's hooks ─────
    {
      const off = await open("host=nova")
      const on = await open("leaf=1&host=nova")
      const normalised = page => page.evaluate(() => Array.from(document.querySelectorAll(".markdown-body")).map(body => {
        const copy = body.cloneNode(true)
        for (const pre of copy.querySelectorAll("pre")) {
          pre.querySelector('[data-slot="chat-code-copy"]')?.remove()
        }
        for (const file of copy.querySelectorAll("[data-context-file]")) {
          file.removeAttribute("data-context-file")
          file.removeAttribute("data-context-file-line")
        }
        for (const pre of copy.querySelectorAll("pre")) {
          if (pre.getAttribute("data-slot") === "chat-code-block") {
            pre.removeAttribute("data-slot")
            pre.removeAttribute("style")
            if (pre.getAttribute("class")?.trim() === "group/code") pre.removeAttribute("class")
          }
        }
        return copy.outerHTML
      }))
      const offHtml = await normalised(off.page)
      assert.equal(offHtml.length, 3, "three Markdown bodies")
      assert.deepEqual(await normalised(on.page), offHtml, "Markdown output is otherwise identical")
      // Layout geometry: a background page's entrance animation is paused mid-scale.
      const geometry = page => firstCode(page).evaluate(pre => [pre.offsetTop, pre.offsetHeight, pre.offsetWidth, getComputedStyle(pre).marginTop])
      assert.deepEqual(await geometry(on.page), await geometry(off.page), "the code block keeps its place and size")
      assert.equal(await off.page.locator('[data-slot="chat-code-copy"]').count(), 0)
      assert.equal(await off.page.getByRole("button", { name: "Message actions" }).count(), 0)
      assert.equal(await off.page.locator("[data-leaf-long-press]").count(), 0)
      const prevented = await off.page.locator('[data-message-uid="assistant-1"] [data-chat-assistant-text] p').first().evaluate(element => {
        const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 })
        element.dispatchEvent(event)
        return event.defaultPrevented
      })
      assert.equal(prevented, false, "off: the browser menu stays")
      assert.deepEqual([...off.errors, ...on.errors], [])
      await off.close()
      await on.close()
      check("off: no Copy button, no ⋮, no hand-off, browser menu; Markdown identical apart from the button")
    }

    // ── Phone ────────────────────────────────────────────────────────────────
    // CDP touch has no long-press recogniser, so a release always arrives as a
    // tap (mousedown, click) where a phone sends contextmenu instead. `during`
    // runs while the finger is still down.
    const longPress = async (page, locator, ms = 700, during) => {
      await locator.scrollIntoViewIfNeeded()
      const box = await locator.boundingBox()
      const x = box.x + Math.min(box.width / 2, 24)
      const y = box.y + box.height / 2
      const cdp = await page.context().newCDPSession(page)
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] })
      await page.waitForTimeout(ms)
      await during?.()
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
      await cdp.detach()
      await page.waitForTimeout(150)
    }
    const sheetOf = page => page.locator('[data-slot="leaf-context-sheet"]')

    {
      const { page, errors, close } = await open("leaf=1&host=nova", { phone: true })
      const row = owner(page)
      assert.equal(await row.getAttribute("data-leaf-long-press"), "")
      await longPress(page, row.locator("[data-chat-assistant-text] p").first())
      const sheet = sheetOf(page)
      await sheet.waitFor()
      assert.deepEqual(await menuIds(sheet), ["message-copy-text", "message-copy-markdown", "message-react", "message-info"])
      assert.equal(await row.getAttribute("data-actions"), null, "the hand-rolled row stays closed")
      await shot(page, "08-phone-message-sheet")
      await sheet.locator('[data-menu-item="message-react"]').click()
      await sheet.locator('[data-menu-item="message-react:👍"]').waitFor()
      await shot(page, "09-phone-react-submenu")
      await sheet.locator('[data-menu-item="message-react:👍"]').click()
      await sheet.waitFor({ state: "detached" })
      assert.deepEqual(await events(page), ["react:assistant-1:👍"], "reactions reachable on touch")

      // No click-through: the long-press on a thumbnail must not open the lightbox.
      await longPress(page, row.locator('[data-slot="chat-image-embed"]'))
      await sheet.waitFor()
      const ids = await menuIds(sheet)
      assert(ids.includes("image-open") && ids.includes("message-info"), ids.join(","))
      assert.equal(await page.getByRole("dialog", { name: "chart" }).count(), 0, "no lightbox under the sheet")
      await shot(page, "10-phone-image-sheet")
      await page.keyboard.press("Escape")
      await sheet.waitFor({ state: "detached" })
      assert.equal(await page.getByRole("dialog", { name: "chart" }).count(), 0)
      // An ordinary tap still opens it.
      await row.locator('[data-slot="chat-image-embed"]').tap()
      await page.getByRole("dialog", { name: "chart" }).waitFor()
      await page.keyboard.press("Escape")
      assert.deepEqual(errors, [])
      await close()
      check("phone, described host: long-press opens the sheet, reactions reachable, no click-through")
    }

    for (const [query, label] of [["leaf=1&host=roleplay", "menu on, undescribed side action"], ["host=nova", "menu off"]]) {
      const { page, errors, close } = await open(query, { phone: true })
      const row = owner(page)
      assert.equal(await row.getAttribute("data-leaf-long-press"), null)
      await longPress(page, row.locator("[data-chat-assistant-text] p").first(), 700, async () => {
        assert.equal(await row.getAttribute("data-actions"), "true", `${label}: the row opened its action row`)
        assert.equal(await sheetOf(page).count(), 0, `${label}: no sheet`)
        await row.locator("[data-fixture-side-action]").waitFor({ state: "visible" })
        await shot(page, `11-phone-row-${query.includes("roleplay") ? "roleplay" : "off"}`)
      })
      assert.equal(await sheetOf(page).count(), 0, `${label}: no sheet after release`)
      assert.deepEqual(errors, [])
      await close()
      check(`phone, ${label}: the hand-rolled action row as before`)
    }
  } finally {
    await browser?.close()
    await server.close()
  }
  fs.writeFileSync(path.join(shots, "results.json"), JSON.stringify(checks, null, 2))
  console.log(`${checks.length} leaf menu checks passed; screenshots in ${shots}`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
