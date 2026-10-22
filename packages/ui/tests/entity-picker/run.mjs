import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { createServer } from "vite"

const fixtureDir = path.dirname(fileURLToPath(import.meta.url))
const outputDir = path.join(process.env.REDLEAF_SCRATCH_DIR || process.env.TEMP, "ui-entity-picker")
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
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()) })

  await page.goto(`${baseUrl}?theme=dark`, { waitUntil: "networkidle" })
  const agentField = page.getByTestId("agent-field").locator('[data-slot="entity-ref-field"]')
  assert.equal(await agentField.getAttribute("data-entity-ref-type"), "agent")

  // A slug reference resolves through the host into the canonical outlined card.
  const agentCard = agentField.locator('[data-slot="entity-card"]')
  await agentCard.waitFor()
  assert.equal(await agentCard.getAttribute("data-entity-id"), "a1")
  assert.equal(await agentCard.getAttribute("data-entity-action"), "inspect")
  assert.equal(await agentCard.getAttribute("data-entity-href"), "/database/entities/agent/a1")
  await agentCard.locator('[data-slot="entity-subtitle"]', { hasText: "Household assistant" }).waitFor()
  await agentCard.locator('[title="System entity"]').waitFor()
  await page.getByTestId("agent-field").screenshot({ path: path.join(outputDir, "field-selected.png") })

  // Change opens the picker on the current selection with search focused.
  await agentField.getByRole("button", { name: "Change Nova" }).click()
  const dialog = page.locator('[data-entity-picker-type="agent"]')
  await dialog.waitFor()
  assert.equal(await dialog.getAttribute("data-entity-picker-mode"), "single")
  await dialog.getByRole("heading", { name: "Choose an Agent" }).waitFor()
  const search = dialog.locator('[data-slot="entity-picker-search"]')
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-slot") === "entity-picker-search")
  const rows = dialog.locator('[data-slot="entity-picker-list"] [data-slot="entity-card"]')
  await rows.nth(3).waitFor()
  assert.equal(await rows.count(), 4)
  assert.notEqual(await dialog.locator('[data-slot="entity-card"][data-entity-id="a1"]').getAttribute("data-selected"), null)
  await dialog.locator('[data-slot="entity-card"][data-entity-id="a2"] [data-slot="entity-detail"]', { hasText: "Research partner" }).waitFor()
  await page.screenshot({ path: path.join(outputDir, "dialog-single.png") })

  // Search refines through the host.
  await search.fill("or")
  await page.waitForFunction(() => document.querySelectorAll('[data-slot="entity-picker-list"] [data-slot="entity-card"]').length === 1)
  await search.fill("zzz")
  await dialog.locator('[data-slot="entity-picker-status"]', { hasText: "No matches" }).waitFor()
  await search.fill("orion")
  await dialog.getByRole("button", { name: "Select Orion" }).click()
  await dialog.waitFor({ state: "hidden" })
  assert.equal((await state(page)).agent, "a2", "single selection stores the entity id")
  await agentField.locator('[data-slot="entity-card"][data-entity-id="a2"]').waitFor()

  // Re-opening starts with an empty search.
  await agentField.getByRole("button", { name: "Change Orion" }).click()
  await dialog.waitFor()
  assert.equal(await search.inputValue(), "")
  await page.keyboard.press("Escape")
  await dialog.waitFor({ state: "hidden" })

  // Host invalidation re-resolves the mounted reference in place.
  await page.evaluate(() => window.__renameEntity("a2", "Orion Prime"))
  await agentField.locator('[data-entity-name="Orion Prime"]').first().waitFor()

  // Clear empties the field; the dashed None button reopens the picker.
  await agentField.getByRole("button", { name: "Clear Orion Prime" }).click()
  assert.equal((await state(page)).agent, null)
  const empty = agentField.locator('[data-slot="entity-ref-empty"]')
  await empty.waitFor()
  assert.equal((await empty.textContent()).trim(), "None")
  await page.getByTestId("agent-field").screenshot({ path: path.join(outputDir, "field-empty.png") })
  await empty.click()
  await dialog.waitFor()
  await dialog.getByRole("button", { name: "Select Lyra" }).click()
  await dialog.waitFor({ state: "hidden" })
  assert.equal((await state(page)).agent, "a3")

  // Multiple selection: toggles, Done count, audio preview controls.
  const voicesField = page.getByTestId("voices-field").locator('[data-slot="entity-ref-field"]')
  await voicesField.locator('[data-slot="entity-card"][data-entity-id="v1"]').waitFor()
  await voicesField.getByRole("button", { name: "Change selection" }).click()
  const voiceDialog = page.locator('[data-entity-picker-type="voice"]')
  await voiceDialog.waitFor()
  assert.equal(await voiceDialog.getAttribute("data-entity-picker-mode"), "multiple")
  await voiceDialog.getByRole("button", { name: "Play Bright host preview" }).waitFor()
  const toggle = voiceDialog.locator('[data-slot="entity-card"][data-entity-id="v2"] [data-slot="entity-picker-toggle"]')
  assert.equal(await toggle.getAttribute("aria-pressed"), "false")
  await toggle.click()
  assert.equal(await toggle.getAttribute("aria-pressed"), "true")
  await voiceDialog.getByRole("button", { name: "Done (2)" }).waitFor()
  await page.screenshot({ path: path.join(outputDir, "dialog-multiple.png") })
  await voiceDialog.getByRole("button", { name: "Done (2)" }).click()
  await voiceDialog.waitFor({ state: "hidden" })
  assert.deepEqual((await state(page)).voices, ["v1", "v2"])
  await voicesField.locator('[data-slot="entity-card"][data-entity-id="v2"]').waitFor()
  await voicesField.getByRole("button", { name: "Clear Warm narrator" }).click()
  assert.deepEqual((await state(page)).voices, ["v2"])

  // Cancel discards multi edits.
  await voicesField.getByRole("button", { name: "Change selection" }).click()
  await voiceDialog.waitFor()
  await voiceDialog.locator('[data-slot="entity-card"][data-entity-id="v1"] [data-slot="entity-picker-toggle"]').click()
  await voiceDialog.getByRole("button", { name: "Cancel" }).click()
  await voiceDialog.waitFor({ state: "hidden" })
  assert.deepEqual((await state(page)).voices, ["v2"])

  // A reference the host cannot resolve stays visible and clearable.
  const missingField = page.getByTestId("missing-field").locator('[data-slot="entity-ref-field"]')
  const unresolved = missingField.locator('[data-slot="entity-ref-unresolved"][data-status="missing"]')
  await unresolved.waitFor()
  assert.match(await unresolved.textContent(), /deleted-agent/)
  await missingField.getByRole("button", { name: "Clear deleted-agent" }).click()
  assert.equal((await state(page)).missing, null)

  // Without a host source the picker says so rather than inventing data.
  await page.getByTestId("orphan-field").locator('[data-slot="entity-ref-empty"]').click()
  await page.locator('[data-slot="entity-picker-status"][data-status="unavailable"]').waitFor()
  await page.keyboard.press("Escape")
  await page.locator('[data-slot="entity-picker-status"]').waitFor({ state: "hidden" })

  await page.getByTestId("agent-field").locator('[data-slot="entity-card"][data-entity-id="a3"]').waitFor()
  await page.locator("main").screenshot({ path: path.join(outputDir, "fields-overview.png") })

  // Light theme spot check on one dialog.
  await page.evaluate(() => document.documentElement.classList.remove("dark"))
  await page.getByTestId("agent-field").getByRole("button", { name: "Change Lyra" }).click()
  await dialog.locator('[data-slot="entity-picker-list"]').waitFor()
  await page.screenshot({ path: path.join(outputDir, "dialog-single-light.png") })
  await page.keyboard.press("Escape")

  const calls = await page.evaluate(() => window.__pickerCalls)
  assert.ok(calls.includes("resolve:agent:nova"), "slug reference resolved through the host")
  assert.ok(calls.includes("search:agent:orion"), "search query forwarded to the host")
  assert.deepEqual(errors, [])
  console.log(`entity picker story passed; screenshots in ${outputDir}`)
} finally {
  await browser?.close()
  await server.close()
}
