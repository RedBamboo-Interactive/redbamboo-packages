const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const os = require("node:os")
const { pathToFileURL } = require("node:url")
const { chromium } = require(require.resolve("playwright", { paths: [path.resolve(__dirname, "../../../testing")] }))

// Mounted shared-Chat fixture for previous/next navigation in activity-square
// details. PHOSPHOR_ROOT optionally points at an @phosphor-icons/web package so
// screenshots show the icons the Leaf shell normally provides.
async function main() {
  const packageRoot = path.resolve(__dirname, "../..")
  const scratch = process.env.REDLEAF_SCRATCH_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "chat-part-nav-"))
  const shots = path.join(scratch, "part-navigation")
  fs.mkdirSync(shots, { recursive: true })
  const phosphorRoot = process.env.PHOSPHOR_ROOT && fs.realpathSync(process.env.PHOSPHOR_ROOT)
  const { createServer } = await import(pathToFileURL(require.resolve("vite")))
  const tailwind = (await import(pathToFileURL(require.resolve("@tailwindcss/vite", { paths: [path.resolve(packageRoot, "../ui")] })))).default
  const server = await createServer({ configFile: false, root: __dirname, plugins: [tailwind()],
    cacheDir: path.join(scratch, "part-nav-vite-cache"),
    resolve: { alias: {
      react: path.join(packageRoot, "node_modules/react"), "react-dom": path.join(packageRoot, "node_modules/react-dom"),
    } },
    server: { host: "127.0.0.1", port: 0, fs: { allow: [path.resolve(packageRoot, "../.."), scratch, ...(phosphorRoot ? [phosphorRoot] : [])] } },
  })
  let browser
  const results = []
  try {
    await server.listen()
    const origin = server.resolvedUrls.local[0]
    browser = await chromium.launch({ headless: true })
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 })
      const errors = []
      page.on("pageerror", error => errors.push(error.message))
      await page.goto(origin)
      if (phosphorRoot) {
        for (const weight of ["regular", "bold"]) {
          await page.addStyleTag({ url: `${origin}@fs/${path.join(phosphorRoot, "src", weight, "style.css").replace(/\\/g, "/")}` })
        }
        await page.evaluate(() => document.fonts.ready)
      }
      const dialog = page.locator('[data-slot="dialog-content"]')
      const counter = dialog.getByRole("group", { name: "Activity navigation" })
      const settle = async () => {
        await page.evaluate(() => Promise.all(document.getAnimations()
          .filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime))
          .map(a => a.finished.catch(() => {}))))
      }
      const expectAt = async (title, position) => {
        await dialog.getByRole("heading", { name: title, exact: true }).waitFor()
        await counter.getByText(`${position} / 6`, { exact: true }).waitFor()
      }
      const shot = async name => {
        await settle()
        await page.screenshot({ path: path.join(shots, `${name}-${width}.png`) })
      }
      const navTop = async () => (await counter.boundingBox()).y

      await page.getByRole("button", { name: "Read", exact: true }).click()
      await expectAt("Read", 2)
      await shot("01-read")
      const readHeight = (await dialog.boundingBox()).height
      const readTop = await navTop()

      // A shorter result must not shrink the dialog out from under the arrows.
      await dialog.getByRole("button", { name: "Next activity" }).click()
      await expectAt("Grep", 3)
      await settle()
      assert((await dialog.boundingBox()).height >= readHeight - 1, "stepping holds the dialog height")
      assert(Math.abs((await navTop()) - readTop) <= 1, "arrows stay under the pointer")
      await shot("02-grep-held")

      await page.keyboard.press("ArrowRight")
      await expectAt("Glob", 4)
      // Edit sits after commentary text, in the next frieze of the same turn.
      await page.keyboard.press("ArrowRight")
      await expectAt("Edit", 5)
      await shot("03-edit-after-commentary")

      // Reach the end by pointer: focus then sits on Next as it goes inert.
      await dialog.getByRole("button", { name: "Next activity" }).click()
      await expectAt("Bash", 6)
      assert.equal(await dialog.getByRole("button", { name: "Next activity" }).getAttribute("aria-disabled"), "true", "no wrap at the end")
      assert(await dialog.evaluate(node => node.contains(document.activeElement)), "focus stays in the dialog at the end")
      await page.keyboard.press("ArrowRight")
      await expectAt("Bash", 6)
      await shot("04-last")

      await page.keyboard.press("ArrowLeft")
      await expectAt("Edit", 5)

      await page.keyboard.press("Escape")
      await dialog.waitFor({ state: "detached" })
      await page.getByRole("button", { name: "Thinking", exact: true }).click()
      await expectAt("Thinking", 1)
      assert.equal(await dialog.getByRole("button", { name: "Previous activity" }).getAttribute("aria-disabled"), "true", "no wrap at the start")
      await settle()
      assert((await dialog.boundingBox()).height < readHeight, "reopening releases the held height")
      await shot("05-first-reopened")
      await page.keyboard.press("Escape")
      await dialog.waitFor({ state: "detached" })

      // ── Job twins (89efca37): stops in the same sequence, in their visual place ──
      // Row markers with jobs off, to prove a twin changes nothing else in any row.
      const friezeMarkers = () => page.$$eval('[data-message-uid^="activity:"] .flex.flex-wrap', friezes => friezes.map(frieze =>
        [...frieze.children].filter(node => node.getAttribute("data-slot") !== "job-twin").map(node => node.outerHTML).join("")))
      await page.goto(`${origin}?jobs&off`)
      await page.locator('[data-message-uid^="activity:"]').first().waitFor()
      await settle()
      const markersOff = await friezeMarkers()
      const heightsOff = await page.$$eval('[data-message-uid]', nodes => nodes.map(node => Math.round(node.getBoundingClientRect().height)))
      assert.equal(await page.locator('[data-slot="job-twin"]').count(), 0, "jobs off: no twin")
      await page.goto(`${origin}?jobs`)
      await page.locator('[data-slot="job-twin"]').first().waitFor()
      await settle()
      assert.deepEqual(await friezeMarkers(), markersOff, "squares, origin dot, inline label and approval ring are unchanged beside twins")
      assert.deepEqual(await page.$$eval('[data-message-uid]', nodes => nodes.map(node => Math.round(node.getBoundingClientRect().height))), heightsOff,
        "twins change no row's height")
      assert.equal(await page.locator('[data-awaiting-approval]').count(), 1, "the approval ring is still on its square")
      const twinRow = await page.$$eval('[data-slot="job-twin"]', nodes => nodes.map(node => {
        const frieze = node.parentElement
        const kids = [...frieze.children]
        return { at: kids.indexOf(node), of: kids.length, squaresBefore: kids.slice(0, kids.indexOf(node)).filter(kid => kid.hasAttribute("data-part-index")).length,
          size: [node.offsetWidth, node.offsetHeight] }
      }))
      assert.deepEqual(twinRow, [{ at: 2, of: 4, squaresBefore: 2, size: [23, 10] }, { at: 3, of: 4, squaresBefore: 2, size: [23, 10] }],
        `twins trail Edit and Bash in the turn's last frieze: ${JSON.stringify(twinRow)}`)
      const at = async (position, title, { job = false } = {}) => {
        await counter.getByText(`${position} / 11`, { exact: true }).waitFor()
        if (job) await page.locator(`[role="dialog"][data-slot="job-summary"]`).getByRole("heading", { name: title, exact: true }).waitFor()
        else await dialog.getByRole("heading", { name: title, exact: true }).waitFor()
      }
      const anyDialog = page.locator('[role="dialog"]')
      const jobCounter = anyDialog.getByRole("group", { name: "Activity navigation" })
      // Open a square in the first row; the twins live in the second.
      await page.getByRole("button", { name: "Read", exact: true }).first().click()
      await counter.getByText("2 / 11", { exact: true }).waitFor()
      await anyDialog.evaluate(node => { node.__navMark = true })
      for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight")
      await counter.getByText("6 / 11", { exact: true }).waitFor()
      const squareHeight = (await anyDialog.boundingBox()).height
      await page.keyboard.press("ArrowRight")
      await jobCounter.getByText("7 / 11", { exact: true }).waitFor()
      await anyDialog.getByRole("heading", { name: "Launch covers", exact: true }).waitFor()
      assert.equal(await anyDialog.getAttribute("data-slot"), "job-summary", "stepping onto a twin shows the job's summary")
      assert.ok(await anyDialog.evaluate(node => node.__navMark === true), "in the same dialog: it was not closed or remounted")
      assert.ok((await anyDialog.locator("[data-job-summary-status]").innerText()).includes("62% done"), "the summary's own content")
      assert.ok(await anyDialog.locator("[data-job-stop]").isVisible(), "Stop, from a dialog opened on another row's square")
      await settle()
      assert.ok((await anyDialog.boundingBox()).height >= squareHeight - 1, "stepping onto a twin holds the dialog height")
      await shot("06-twin-covers")
      // Arrow keys belong to an open menu, not to stepping. (This job has no Compute link, so its ⋯ is absent here.)
      await page.keyboard.press("ArrowRight")
      await jobCounter.getByText("8 / 11", { exact: true }).waitFor()
      await anyDialog.getByRole("heading", { name: "Mossbound theme", exact: true }).waitFor()
      assert.ok((await anyDialog.locator("[data-job-summary-status]").innerText()).includes("Waiting to start"))
      // Past the twins: back onto squares, the next row's event first.
      await jobCounter.getByRole("button", { name: "Next activity" }).click()
      await jobCounter.getByText("9 / 11", { exact: true }).waitFor()
      assert.notEqual(await anyDialog.getAttribute("data-slot"), "job-summary", "stepping off a twin returns to squares")
      assert.ok(await anyDialog.evaluate(node => node.__navMark === true), "still the same dialog")
      await page.keyboard.press("ArrowRight")
      await page.keyboard.press("ArrowRight")
      await counter.getByText("11 / 11", { exact: true }).waitFor()
      await dialog.getByRole("heading", { name: "Bash", exact: true }).waitFor()
      // Back from the next row onto the twins.
      for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft")
      await jobCounter.getByText("8 / 11", { exact: true }).waitFor()
      await jobCounter.getByRole("button", { name: "Previous activity" }).click()
      await jobCounter.getByText("7 / 11", { exact: true }).waitFor()
      await page.keyboard.press("ArrowLeft")
      await counter.getByText("6 / 11", { exact: true }).waitFor()
      await dialog.getByRole("heading", { name: "Bash", exact: true }).waitFor()
      await page.keyboard.press("Escape")
      await anyDialog.waitFor({ state: "detached" })
      // A twin opens its summary at its own place in the sequence.
      await page.locator('[data-slot="job-twin"][data-job-id="theme"]').click()
      await jobCounter.getByText("8 / 11", { exact: true }).waitFor()
      await shot("07-twin-theme-direct")
      await page.keyboard.press("Escape")
      await anyDialog.waitFor({ state: "detached" })
      // The inline label and the squares beside twins keep their own click targets.
      await page.locator('[data-slot="event-inline-label"]').click()
      await counter.getByText("9 / 11", { exact: true }).waitFor()
      await page.keyboard.press("Escape")
      await anyDialog.waitFor({ state: "detached" })
      // Right-click on a twin: no square's details, no error (no Leaf menu here; the leaf-menu fixture covers that).
      await page.locator('[data-slot="job-twin"][data-job-id="covers"]').click({ button: "right", force: true })
      await page.waitForTimeout(150)
      assert.equal(await anyDialog.count(), 0, "a right-click on a twin opens nothing")
      await page.keyboard.press("Escape")

      assert.deepEqual(errors, [], `browser exceptions at ${width}px`)
      results.push({ width, passed: true })
      await page.close()
    }
  } finally {
    await browser?.close()
    await server.close()
  }
  fs.writeFileSync(path.join(shots, "results.json"), JSON.stringify(results, null, 2))
  console.log(`${results.length} part navigation viewports passed; screenshots in ${shots}`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
