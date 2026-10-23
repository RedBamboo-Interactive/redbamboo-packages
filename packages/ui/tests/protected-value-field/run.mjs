import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { createServer } from "vite"

const fixtureDir = path.dirname(fileURLToPath(import.meta.url))
const outputDir = path.join(process.env.REDLEAF_SCRATCH_DIR || process.env.TEMP, "ui-protected-value-field")
await mkdir(outputDir, { recursive: true })

const ROTATED = "rotated-token-0123456789abcdefghijklmnopqrstuvwxyz"

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
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(baseUrl).origin })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()) })

  await page.goto(`${baseUrl}?theme=light&spacer=900px`, { waitUntil: "networkidle" })
  const field = page.getByTestId("token-field").locator('[data-slot="protected-value-field"]')
  const rotate = field.getByRole("button", { name: "Rotate" })

  // Without a revealed value the card shows only its protection state.
  assert.equal(await field.getAttribute("data-revealed"), null)
  assert.equal(await field.locator('[data-slot="protected-value-revealed"]').count(), 0)
  assert.equal(await field.locator('[data-slot="protected-value-copy"]').count(), 0)

  // Rotate sits at the bottom edge of a phone screen, as it does after scrolling to it.
  await rotate.evaluate((element) => element.scrollIntoView({ block: "end" }))
  await rotate.click()

  // The new value is revealed inside the same card, focused, and brought on screen.
  const revealed = field.locator('[data-slot="protected-value-revealed"]')
  await revealed.waitFor()
  assert.equal(await field.getAttribute("data-revealed"), "true")
  // The value is the design system Input, read-only, labelled, and described by the notice.
  const value = field.getByRole("textbox", { name: "New token" })
  assert.equal(await value.inputValue(), ROTATED)
  assert.equal(await value.getAttribute("data-slot"), "protected-value-revealed-value")
  assert.equal(await value.getAttribute("readonly"), "")
  const noticeId = await value.getAttribute("aria-describedby")
  assert.equal(await page.locator(`[id="${noticeId}"]`).textContent(), "Shown only once. Copy it now.")
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-slot") === "protected-value-revealed-value")
  await page.waitForFunction(() => {
    const box = document.querySelector('[data-slot="protected-value-revealed"]').getBoundingClientRect()
    return box.top >= 0 && box.bottom <= window.innerHeight
  })
  await field.getByText("Stored securely").waitFor()
  await rotate.waitFor()
  await page.getByTestId("token-field").screenshot({ path: path.join(outputDir, "revealed-light.png") })

  // Copy writes the value to the clipboard and reports success.
  await field.locator('[data-slot="protected-value-copy"]').click()
  await field.getByRole("button", { name: "Copied" }).waitFor()
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), ROTATED)
  assert.deepEqual((await state(page)).copies, ["copied"])

  // A blocked clipboard selects the value for manual copy and reports failure.
  await page.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.reject(new DOMException("blocked", "NotAllowedError"))
  })
  await field.locator('[data-slot="protected-value-copy"]').click()
  await field.getByText("Copy is blocked here. The value is selected; copy it manually.").waitFor()
  assert.deepEqual(await value.evaluate((input) => [document.activeElement === input, input.selectionStart, input.selectionEnd]), [true, 0, ROTATED.length])
  assert.deepEqual((await state(page)).copies, ["copied", "failed"])

  // Clearing the value returns the card to its stored-only state.
  await page.getByTestId("clear").click()
  await revealed.waitFor({ state: "detached" })
  assert.equal(await field.getAttribute("data-revealed"), null)
  assert.equal(await field.locator('[data-slot="protected-value-copy"]').count(), 0)

  // A rejected rotation is reported inside the field, and nothing is revealed.
  const failing = page.getByTestId("failing-field").locator('[data-slot="protected-value-field"]')
  await failing.getByRole("button", { name: "Rotate" }).click()
  assert.equal(await failing.getByRole("alert").textContent(), "The service rejected the rotation")
  assert.equal(await failing.getAttribute("data-revealed"), null)

  // The dark theme keeps the reveal legible.
  await page.goto(`${baseUrl}?theme=dark`, { waitUntil: "networkidle" })
  await page.getByTestId("token-field").getByRole("button", { name: "Rotate" }).click()
  await page.locator('[data-slot="protected-value-revealed"]').waitFor()
  await page.getByTestId("token-field").screenshot({ path: path.join(outputDir, "revealed-dark.png") })

  assert.deepEqual(errors, [])
  console.log(`protected value field story passed; screenshots in ${outputDir}`)
} finally {
  await browser?.close()
  await server.close()
}
