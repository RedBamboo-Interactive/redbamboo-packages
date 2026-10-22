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

      // The background status line counts what runs and opens the oldest running agent.
      const line = page.locator('[data-slot="background-status-line"]')
      await line.getByText("1 agent · 1 shell working").waitFor()
      await line.getByText("Running Echo alpha").waitFor()
      await shot("04-status-line")
      await line.getByRole("button").click()
      await heading("Agent").waitFor()
      await panel.getByText("Running", { exact: true }).waitFor()
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
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(`${origin}?streaming`)
    const stop = page.locator('[data-slot="composer"] button[aria-haspopup="menu"]')
    await stop.waitFor()
    assert.equal(await stop.getAttribute("title"), "Interrupt (Escape) — also stops 2 background tasks")
    await page.screenshot({ path: path.join(shots, "05-stop-warning-1440.png") })
    await page.close()
    results.push({ stopWarning: true })
  } finally {
    await browser?.close()
    await server.close()
  }
  fs.writeFileSync(path.join(shots, "results.json"), JSON.stringify(results, null, 2))
  console.log(`${results.length} background work checks passed; screenshots in ${shots}`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
