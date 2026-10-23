const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const os = require("node:os")
const { pathToFileURL } = require("node:url")
const { chromium } = require(require.resolve("playwright", { paths: [path.resolve(__dirname, "../../../testing")] }))

// Mounted shared-Chat fixture for background work: square states, the Agent
// modal's child walk and Stop, the background status line, the turn-origin
// circle, and the Stop affordance's warning. PHOSPHOR_ROOT optionally points at
// an @phosphor-icons/web package so screenshots show the shell's icons.
async function main() {
  const packageRoot = path.resolve(__dirname, "../..")
  const scratch = process.env.REDLEAF_SCRATCH_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "chat-background-"))
  const shots = path.join(scratch, "background-work")
  fs.mkdirSync(shots, { recursive: true })
  const phosphorRoot = process.env.PHOSPHOR_ROOT && fs.realpathSync(process.env.PHOSPHOR_ROOT)
  const { createServer } = await import(pathToFileURL(require.resolve("vite")))
  const tailwind = (await import(pathToFileURL(require.resolve("@tailwindcss/vite", { paths: [path.resolve(packageRoot, "../ui")] })))).default
  const server = await createServer({ configFile: false, root: __dirname, plugins: [tailwind()],
    cacheDir: path.join(scratch, "background-vite-cache"),
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
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()) })
      await page.goto(origin)
      if (phosphorRoot) {
        for (const weight of ["regular", "bold"]) {
          await page.addStyleTag({ url: `${origin}@fs/${path.join(phosphorRoot, "src", weight, "style.css").replace(/\\/g, "/")}` })
        }
        await page.evaluate(() => document.fonts.ready)
      }
      const dialog = page.locator('[data-slot="dialog-content"]')
      const settle = async () => {
        await page.evaluate(() => Promise.all(document.getAnimations()
          .filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime))
          .map(a => a.finished.catch(() => {}))))
      }
      const shot = async name => {
        await settle()
        await page.screenshot({ path: path.join(shots, `${name}-${width}.png`) })
      }
      const squareFor = id => page.locator(`[data-slot="chat-panel"] button[data-tool-use-id="${id}"]`).first()
      const heading = title => dialog.getByRole("heading", { name: title, exact: true })

      // Square states: running agents and shells move for the task's lifetime even though
      // the panel is not streaming; stopped is red, lost is grey, completed is still.
      await squareFor("toolu_research").waitFor()
      const state = async id => squareFor(id).evaluate(node => ({
        status: node.getAttribute("data-task-status"),
        jiggle: node.classList.contains("square-jiggle"),
        color: getComputedStyle(node).backgroundColor,
      }))
      const research = await state("toolu_research")
      const map = await state("toolu_map")
      const stopped = await state("toolu_stopped")
      const lost = await state("toolu_lost")
      const shell = await state("toolu_shell")
      assert.deepEqual([research.status, research.jiggle], ["running", true], "running agent jiggles")
      assert.deepEqual([shell.status, shell.jiggle], ["running", true], "running background shell jiggles")
      assert.deepEqual([map.status, map.jiggle], ["completed", false], "completed agent is still")
      assert.deepEqual([stopped.status, stopped.jiggle, lost.status, lost.jiggle], ["stopped", false, "lost", false])
      assert.equal(research.color, map.color, "running and completed keep the agent colour")
      // Running squares move but keep the one square size.
      const scaleOf = id => squareFor(id).evaluate(node => {
        const m = new DOMMatrix(getComputedStyle(node).transform)
        return Math.hypot(m.a, m.b)
      })
      await page.waitForTimeout(700)
      assert.ok(Math.abs(await scaleOf("toolu_research") - 1) < 0.02, "a running square is not enlarged")
      assert.notEqual(stopped.color, map.color, "stopped is not the agent colour")
      assert.notEqual(lost.color, stopped.color, "lost differs from stopped")
      // A subagent's own calls are not squares of the turn.
      assert.equal(await squareFor("toolu_r1").count(), 0, "children never render in the turn frieze")
      await shot("01-squares")

      // The Agent modal: state, child frieze, child walk with breadcrumb, back, Stop.
      await squareFor("toolu_research").click({ force: true })
      await heading("Agent").waitFor()
      const panel = dialog.locator('[data-slot="background-task-panel"]')
      await panel.getByText("Running", { exact: true }).waitFor()
      await panel.getByText("Running Echo alpha").waitFor()
      const activity = dialog.getByRole("group", { name: "Background activity" })
      assert.equal(await activity.getByRole("button").count(), 3)
      await shot("02-agent-modal")
      await activity.getByRole("button", { name: "WebSearch" }).click()
      await heading("WebSearch").waitFor()
      const crumbs = dialog.getByRole("navigation", { name: "Background activity path" })
      await crumbs.getByRole("button", { name: "Agent" }).waitFor()
      const counter = dialog.getByRole("group", { name: "Activity navigation" })
      await counter.getByText("1 / 3", { exact: true }).waitFor()
      await shot("03-child-breadcrumb")
      await page.keyboard.press("ArrowRight")
      await heading("Bash").waitFor()
      await counter.getByText("2 / 3", { exact: true }).waitFor()
      await dialog.getByText("alpha", { exact: true }).waitFor()
      await page.keyboard.press("ArrowRight")
      await heading("Read").waitFor()
      await page.keyboard.press("ArrowRight")
      await heading("Read").waitFor()
      assert.equal(await dialog.getByRole("button", { name: "Next activity" }).getAttribute("aria-disabled"), "true", "no wrap past the last child")
      await crumbs.getByRole("button", { name: "Agent" }).click()
      await heading("Agent").waitFor()
      await panel.getByRole("button", { name: "Stop Research Gmail API access options" }).click()
      await page.waitForFunction(() => window.__stops.length === 1)
      assert.deepEqual(await page.evaluate(() => window.__stops), ["task-research"])
      await page.keyboard.press("Escape")
      await dialog.waitFor({ state: "detached" })

      // A finished agent: summary, no Stop.
      await squareFor("toolu_map").click({ force: true })
      await heading("Agent").waitFor()
      await panel.getByText("Completed", { exact: true }).waitFor()
      await panel.getByText("Extensions are RedLeaf plugins with a manifest.").waitFor()
      assert.equal(await panel.getByRole("button", { name: /^Stop/ }).count(), 0, "no Stop once the task ended")
      await page.keyboard.press("Escape")
      await dialog.waitFor({ state: "detached" })

      // One activity row: a shape per running task, agents first; the text names
      // the leading group only. A shape opens its launching square's own dialog.
      const row = page.locator('[data-slot="activity-status-row"]')
      const shapes = row.getByRole("group", { name: "Background work" }).getByRole("button")
      await row.getByText("1 agent working", { exact: true }).waitFor()
      await row.getByText("Running Echo alpha").waitFor()
      assert.equal(await row.locator('[data-slot="streaming-status-line"]').count(), 1, "one line, not two")
      assert.deepEqual(await shapes.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-activity-key"))),
        ["task:task-research", "task:task-shell"], "agents before other tasks")
      for (const node of await shapes.all()) {
        const scale = await node.evaluate(el => { const m = new DOMMatrix(getComputedStyle(el).transform); return Math.hypot(m.a, m.b) })
        assert.ok(Math.abs(scale - 1) < 0.02, "activity shapes keep the one square size")
      }
      await shot("04-activity-row")
      await shapes.nth(1).click({ force: true })
      await heading("Bash").waitFor()
      await panel.getByText("Running", { exact: true }).waitFor()
      await page.keyboard.press("Escape")
      await dialog.waitFor({ state: "detached" })
      await shapes.nth(0).click({ force: true })
      await heading("Agent").waitFor()
      await panel.getByText("Running Echo alpha").waitFor()
      await page.keyboard.press("Escape")
      await dialog.waitFor({ state: "detached" })

      // The wake turn opens with a violet circle naming the task that woke it.
      const originCircle = page.getByRole("button", { name: "Map Leaf extension architecture finished" })
      await originCircle.waitFor()
      await originCircle.click()
      await heading("Agent").waitFor()
      await panel.getByText("Completed", { exact: true }).waitFor()
      await page.keyboard.press("Escape")
      await dialog.waitFor({ state: "detached" })

      assert.deepEqual(errors, [], `browser errors at ${width}px`)
      results.push({ width, passed: true })
      await page.close()
    }

    // Busy composer: Stop warns that interrupting also stops the running background tasks.
    // The session owns the row's text; tasks and delegations keep their shapes in the same line.
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
    await page.goto(`${origin}?streaming&host`)
    const stop = page.locator('[data-slot="composer"] button[aria-haspopup="menu"]')
    await stop.waitFor()
    assert.equal(await stop.getAttribute("title"), "Interrupt (Escape) — also stops 2 background tasks")
    const row = page.locator('[data-slot="activity-status-row"]')
    const shapeKeys = () => row.getByRole("group", { name: "Background work" }).getByRole("button")
      .evaluateAll(nodes => nodes.map(node => [node.getAttribute("data-activity-key"), node.getAttribute("data-running") === "true"]))
    await row.getByRole("group", { name: "Background work" }).waitFor()
    assert.equal(await row.locator('[data-slot="streaming-status-line"]').count(), 1, "session and background share one line")
    assert.equal(await row.getByText("agent working").count(), 0, "the session owns the text while it works")
    assert.deepEqual(await shapeKeys(), [["task:task-research", true], ["task:task-shell", true], ["host:d1", true], ["host:d2", false]])
    await page.screenshot({ path: path.join(shots, "05-streaming-row-1440.png") })
    await page.close()
    results.push({ stopWarning: true, streamingRow: true })

    // Delegations only: they own the text, and a circle opens the standard dialog with the host's details.
    const hostPage = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
    await hostPage.goto(`${origin}?hostOnly`)
    const hostRow = hostPage.locator('[data-slot="activity-status-row"]')
    await hostRow.getByText("2 delegations ongoing…").waitFor()
    await hostPage.screenshot({ path: path.join(shots, "06-delegations-row-1440.png") })
    await hostRow.getByRole("button", { name: "Sentinel shield for Discord and Commons: running" }).click({ force: true })
    const hostDialog = hostPage.locator('[data-slot="dialog-content"]')
    await hostDialog.getByRole("heading", { name: "Delegation", exact: true }).waitFor()
    await hostDialog.locator('[data-slot="fixture-delegation"]').getByText("Sentinel shield for Discord and Commons").waitFor()
    await hostPage.waitForTimeout(300)
    await hostPage.screenshot({ path: path.join(shots, "07-delegation-dialog-1440.png") })
    await hostDialog.getByRole("button", { name: "Open in Code" }).click()
    await hostDialog.waitFor({ state: "detached" })
    await hostPage.close()
    results.push({ delegations: true })

    // A task whose launching square is not loaded still opens the same dialog from its live state.
    const detachedPage = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await detachedPage.goto(`${origin}?detached`)
    const detachedRow = detachedPage.locator('[data-slot="activity-status-row"]')
    await detachedRow.getByRole("group", { name: "Background work" }).waitFor()
    await detachedPage.evaluate(() => Promise.all(document.getAnimations()
      .filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime))
      .map(a => a.finished.catch(() => {}))))
    await detachedRow.getByRole("button", { name: "Research Gmail API access options (background agent)" }).click({ force: true })
    const detachedDialog = detachedPage.locator('[data-slot="dialog-content"]')
    await detachedDialog.getByRole("heading", { name: "Agent", exact: true }).waitFor()
    await detachedDialog.locator('[data-slot="background-task-panel"]').getByText("Running Echo alpha").waitFor()
    await detachedPage.close()
    results.push({ detached: true })
  } finally {
    await browser?.close()
    await server.close()
  }
  fs.writeFileSync(path.join(shots, "results.json"), JSON.stringify(results, null, 2))
  console.log(`${results.length} background work checks passed; screenshots in ${shots}`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
