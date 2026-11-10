const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const os = require("node:os")
const { pathToFileURL } = require("node:url")
const { chromium } = require(require.resolve("playwright", { paths: [path.resolve(__dirname, "../../../testing")] }))

// Mounted shared-Chat fixture for Message Info on a user message: the Nova Context rows, the
// stored injected context (sectioned, folded parts, exact text), the "not recorded" note, the XML
// fallback for other products, and nothing at all for a message without context. Phone first.
async function main() {
  const packageRoot = path.resolve(__dirname, "../..")
  const scratch = process.env.REDLEAF_SCRATCH_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "chat-message-info-"))
  const shots = path.join(scratch, "chat-message-info")
  fs.mkdirSync(shots, { recursive: true })
  const { createServer } = await import(pathToFileURL(require.resolve("vite")))
  const tailwind = (await import(pathToFileURL(require.resolve("@tailwindcss/vite", { paths: [path.resolve(packageRoot, "../ui")] })))).default
  const server = await createServer({ configFile: false, root: __dirname, plugins: [tailwind()],
    cacheDir: path.join(scratch, "message-info-vite-cache"),
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
    const context = await browser.newContext({ deviceScaleFactor: 2 })
    const phone = { width: 390, height: 844 }
    const desktop = { width: 1440, height: 900 }

    const open = async (kind, viewport) => {
      const page = await context.newPage()
      await page.setViewportSize(viewport)
      const errors = []
      page.on("pageerror", error => errors.push(error.message))
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()) })
      await page.goto(`${origin}?case=${kind}`)
      // Phone hides the rail until the message is tapped; the button itself is what matters here.
      await page.locator('button[title="Message info"]').dispatchEvent("click")
      await page.getByRole("dialog").waitFor()
      return { page, errors, dialog: page.getByRole("dialog") }
    }
    const shot = (page, name) => page.screenshot({ path: path.join(shots, `${name}.png`) })
    const fits = page => page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]').getBoundingClientRect()
      return dialog.left >= 0 && dialog.right <= window.innerWidth && dialog.bottom <= window.innerHeight
        && document.documentElement.scrollWidth <= window.innerWidth
        && [...document.querySelectorAll('[role="dialog"] *')].every(item => {
          const box = item.getBoundingClientRect()
          return box.width === 0 || (box.left >= dialog.left - 0.5 && box.right <= dialog.right + 0.5)
        })
    })
    const sectionTitles = dialog => dialog.locator('[data-slot="message-context-section"] > button').allInnerTexts()

    // ── A stored full context, phone width ──
    {
      const { page, errors, dialog } = await open("full", phone)
      const text = await dialog.innerText()
      assert.match(text, /Nova Context/i)
      assert.match(text, /Device type\s+desktop/)
      assert.doesNotMatch(text, /Nova Context Block|novaContextBlock/, "the payload is not a metadata row")
      assert.doesNotMatch(text, /No additional metadata/)
      const outfitRow = dialog.locator('[data-slot="message-info-folded-row"] button')
      assert.equal(await outfitRow.getAttribute("aria-expanded"), "false", "the outfit row starts folded")
      assert.ok((await outfitRow.boundingBox()).height < 24, "a folded outfit is one line")
      const toggle = dialog.locator('[data-slot="message-context-toggle"]')
      assert.equal(await toggle.getAttribute("aria-expanded"), "false")
      assert.match(await toggle.innerText(), /Injected context[\s\S]*KB/i)
      await shot(page, "01-phone-full-folded")
      await toggle.click()
      const section = title => dialog.locator('[data-slot="message-context-section"]').filter({ has: page.locator("button", { hasText: title }) }).first()
      const titles = (await sectionTitles(dialog)).map(t => t.replace(/\s+\d+$/, "").trim())
      assert.deepEqual(titles, [
        "Recent LIVE events", "Installed extension context",
        "Active discussions", "Recently archived", "Other agents' active discussions", "Outfit", "Other",
      ])
      assert.equal(await section("Active discussions").locator("button").getAttribute("aria-expanded"), "false", "a long list starts folded")
      assert.equal(await section("Outfit").locator("button").getAttribute("aria-expanded"), "false", "the outfit section starts folded")
      assert.equal(await section("Outfit").locator("pre").count(), 0)
      assert.match(await section("Recent LIVE events").locator("pre").innerText(), /\[callback\] Code session 3f2a finished/)
      assert.ok(await fits(page), "nothing sticks out of the dialog at phone width")
      // The sections scroll inside the dialog rather than growing it past the screen.
      const scrolls = await page.evaluate(() => {
        const body = document.querySelector('[role="dialog"] .overflow-y-auto')
        return body.scrollHeight > body.clientHeight
      })
      assert.ok(scrolls, "the long context scrolls within the dialog")
      await shot(page, "02-phone-full-sections")
      await section("Recent LIVE events").scrollIntoViewIfNeeded()
      await shot(page, "03-phone-full-live-events")
      await section("Outfit").locator("button").click()
      assert.match(await section("Outfit").locator("pre").innerText(), /Navy evening/)
      await dialog.locator('[data-slot="message-context-raw-toggle"]').click()
      const raw = await dialog.locator('[data-slot="message-context-raw"]').innerText()
      assert.equal(raw.trim(), (await page.evaluate(() => window.__context)).trim(), "the exact text is one click away")
      assert.ok(await fits(page))
      await shot(page, "04-phone-full-exact-text")
      assert.deepEqual(errors, [])
      await page.close()
      check("phone: full context folded, sectioned, outfit folded, exact text, fits and scrolls")
    }

    // ── A delta with the prior message, phone ──
    {
      const { page, errors, dialog } = await open("delta", phone)
      await dialog.locator('[data-slot="message-context-toggle"]').click()
      const titles = (await sectionTitles(dialog)).map(t => t.replace(/\s+\d+$/, "").trim())
      assert.deepEqual(titles, ["Changes since last message", "Outfit", "Previous assistant message", "Other"])
      const changes = await dialog.locator('[data-slot="message-context-section"][data-kind="changes"] pre').innerText()
      assert.match(changes, /\[automation\] Nightly build passed/)
      assert.doesNotMatch(changes, /Outfit changed/)
      assert.equal(await dialog.locator('[data-slot="message-context-section"][data-kind="prior-message"] pre').count(), 0)
      assert.ok(await fits(page))
      await shot(page, "05-phone-delta")
      assert.deepEqual(errors, [])
      await page.close()
      check("phone: delta shows its changes; outfit change and prior message folded")
    }

    // ── Desktop: the dialog widens for a stored context ──
    {
      const { page, errors, dialog } = await open("full", desktop)
      await dialog.locator('[data-slot="message-context-toggle"]').click()
      const width = (await dialog.boundingBox()).width
      assert.ok(width > 600, `desktop dialog is wide enough to read (${width}px)`)
      assert.ok(await fits(page))
      await shot(page, "06-desktop-full-sections")
      assert.deepEqual(errors, [])
      await page.close()
      check("desktop: wide dialog with the sectioned context")
    }

    // ── Older message: an honest note, not an empty section ──
    {
      const { page, errors, dialog } = await open("missing", phone)
      const text = await dialog.innerText()
      assert.match(text, /Context wasn't recorded for this message\./)
      assert.doesNotMatch(text, /No additional metadata/)
      assert.equal(await dialog.locator('[data-slot="message-context"]').count(), 0)
      assert.equal((await dialog.boundingBox()).width <= 390, true)
      await shot(page, "07-phone-not-recorded")
      assert.deepEqual(errors, [])
      await page.close()
      check("older message says its context wasn't recorded")
    }

    // ── Other products: the XML fallback, unchanged ──
    {
      const { page, errors, dialog } = await open("xml", phone)
      assert.match(await dialog.innerText(), /Nova Context[\s\S]*Laptop/i)
      await dialog.getByRole("button", { name: /Show raw context/ }).click()
      assert.match(await dialog.innerText(), /Some other product's context/)
      assert.doesNotMatch(await dialog.innerText(), /Context wasn't recorded/)
      await shot(page, "08-phone-xml-fallback")
      assert.deepEqual(errors, [])
      await page.close()
      check("a context in the message text still parses (other products)")
    }

    // ── No context at all ──
    {
      const { page, errors, dialog } = await open("none", phone)
      const text = await dialog.innerText()
      assert.match(text, /No additional metadata available\./)
      assert.doesNotMatch(text, /Context wasn't recorded/)
      assert.deepEqual(errors, [])
      await page.close()
      check("a message without any context reads as before")
    }
  } finally {
    await browser?.close()
    await server.close()
  }
  fs.writeFileSync(path.join(shots, "results.json"), JSON.stringify(checks, null, 2))
  console.log(`${checks.length} message-info checks passed; screenshots in ${shots}`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
