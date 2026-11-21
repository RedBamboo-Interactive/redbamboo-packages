const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const os = require("node:os")
const { pathToFileURL } = require("node:url")
const { chromium } = require(require.resolve("playwright", { paths: [path.resolve(__dirname, "../../../testing")] }))

// Mounted shared-Chat fixture for job twins (89efca37; the job cards before
// them were f6e6c083): a job is a magenta twin at the end of its launching
// message's frieze row. Transcript purity and no remount, frieze integrity,
// stick-to-bottom and the reader's anchor while twins appear and progress, the
// fill's glide, duplicate delivery, older pages, a message without a frieze,
// the activity row after delegations, Stop, frieze filtering, the setting off
// (no requests), accessibility, reduced motion, high contrast, and screenshots
// in dark, light and cozy. PHOSPHOR_ROOT optionally points at an
// @phosphor-icons/web package for icons.
async function main() {
  const packageRoot = path.resolve(__dirname, "../..")
  const scratch = process.env.JOB_CARDS_OUT || process.env.REDLEAF_SCRATCH_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "chat-job-twins-"))
  const shots = path.join(scratch, "job-twins")
  fs.mkdirSync(shots, { recursive: true })
  const phosphorRoot = process.env.PHOSPHOR_ROOT && fs.realpathSync(process.env.PHOSPHOR_ROOT)
  const { createServer } = await import(pathToFileURL(require.resolve("vite")))
  const tailwind = (await import(pathToFileURL(require.resolve("@tailwindcss/vite", { paths: [path.resolve(packageRoot, "../ui")] })))).default
  const server = await createServer({ configFile: false, root: __dirname, plugins: [tailwind()],
    cacheDir: path.join(scratch, "job-twins-vite-cache"),
    resolve: { alias: {
      react: path.join(packageRoot, "node_modules/react"), "react-dom": path.join(packageRoot, "node_modules/react-dom"),
    } },
    server: { host: "127.0.0.1", port: 0, fs: { allow: [path.resolve(packageRoot, "../.."), scratch, ...(phosphorRoot ? [phosphorRoot] : [])] } },
  })
  let browser
  let checks = 0
  const check = (value, message) => { assert.ok(value, message); checks++ }
  const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++ }
  const MAGENTA = "rgb(236 72 153)"
  try {
    await server.listen()
    const origin = server.resolvedUrls.local[0]
    browser = await chromium.launch({ headless: true })
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 })
      const errors = []
      page.on("pageerror", error => errors.push(error.message))
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()) })
      const icons = async () => {
        if (!phosphorRoot) return
        for (const weight of ["regular", "bold", "fill"]) {
          await page.addStyleTag({ url: `${origin}@fs/${path.join(phosphorRoot, "src", weight, "style.css").replace(/\\/g, "/")}` })
        }
        await page.evaluate(() => document.fonts.ready)
      }
      const settle = async () => {
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        await page.evaluate(() => Promise.all(document.getAnimations()
          .filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime))
          .map(a => a.finished.catch(() => {}))))
      }
      const shot = async name => { await settle(); await page.screenshot({ path: path.join(shots, `${name}-${width}.png`) }) }
      const theme = async name => page.evaluate(name => {
        document.documentElement.classList.toggle("dark", name !== "light")
        if (name === "cozy") document.documentElement.setAttribute("data-cozy", "")
        else document.documentElement.removeAttribute("data-cozy")
      }, name)
      const scroller = '[data-slot="chat-panel"] .overflow-y-auto'
      const gap = () => page.$eval(scroller, el => el.scrollHeight - el.scrollTop - el.clientHeight)
      const rowsSnapshot = () => page.$$eval("[data-message-uid]", nodes => nodes.map(node => node.getAttribute("data-message-uid")))
      const rowHeights = () => page.$$eval("[data-message-uid]", nodes => nodes.map(node => node.offsetHeight))
      const contentHtml = () => page.$eval(`${scroller} > div`, el => el.innerHTML)
      // Every frieze's markup without its twins: squares, order, indices, colours, rings, dots, labels.
      const friezes = () => page.$$eval(`${scroller} [data-message-uid] .flex.flex-wrap.items-center`, nodes => nodes.map(node =>
        [...node.children].filter(child => child.getAttribute("data-slot") !== "job-twin").map(child => child.outerHTML).join("")))
      const calls = () => page.evaluate(() => window.__jobs.calls.slice())
      const twin = id => page.locator(`[data-slot="job-twin"][data-job-id="${id}"]`)
      const fillOf = id => page.$eval(`[data-slot="job-twin"][data-job-id="${id}"]`, el => parseFloat(getComputedStyle(el).getPropertyValue("--job-twin-p")))
      const colourOf = id => page.$eval(`[data-slot="job-twin"][data-job-id="${id}"]`, el => getComputedStyle(el).getPropertyValue("--job-twin-c").trim())
      const animationsOf = id => page.$eval(`[data-slot="job-twin"][data-job-id="${id}"]`, el => getComputedStyle(el).animationName)
      const token = name => page.evaluate(name => getComputedStyle(document.documentElement).getPropertyValue(name).trim(), name)
      const sizeOf = id => page.$eval(`[data-slot="job-twin"][data-job-id="${id}"]`, el => [el.offsetWidth, el.offsetHeight])
      const job = (fields) => page.evaluate(fields => {
        const { ts, launch } = window.__jobs
        return { capability: "image-gen", providerName: "ComfyUI", status: "Running", stage: "executing", progress: 0,
          queuedAt: ts(launch + 2.5), startedAt: ts(launch + 2.5), ...fields }
      }, fields)
      const setJobs = async records => { await page.evaluate(records => window.__jobs.set(records), records) }
      const frame = async (type, data) => { await page.evaluate(([type, data]) => window.__jobs.frame(type, data), [type, data]) }

      // ── Setting off: no twins, no row entries, no job requests ─────────
      await page.goto(`${origin}?off`)
      await page.locator("[data-message-uid]").first().waitFor()
      await icons()
      await page.evaluate(() => window.__jobs.set([]))
      await frame("job.created", { id: "covers", capabilitySlug: "image-gen", discussion: "fixture-discussion" })
      await frame("websocket.connected", {})
      await page.waitForTimeout(1200)
      equal(await calls(), [], "setting off: no job request at all")
      await settle()
      const offHtml = await contentHtml()
      const offRows = await rowsSnapshot()
      const offHeights = await rowHeights()
      const offFriezes = await friezes()
      equal(await page.locator('[data-slot="job-twin"]').count(), 0, "setting off: no twin")

      // ── On: one bounded list, twins in the launching message's frieze ───
      const covers = await job({ id: "covers", name: "Launch covers", progress: 0.62 })
      const theme_ = await job({ id: "theme", name: "Mossbound theme", capability: "music-gen", providerName: "Suno", status: "Queued", stage: "admitted", startedAt: null })
      theme_.queuedAt = await page.evaluate(() => window.__jobs.ts(window.__jobs.launch + 4.5))
      const tts = await job({ id: "voice", capability: "tts", status: "Completed", durationMs: 4000 })
      const quick = await job({ id: "quick", status: "Completed", durationMs: 900 })
      const turn = await job({ id: "ai", capability: "ai-session" })
      const early = await job({ id: "early", name: "Early sketch", capability: "workflow", providerName: "RedLeaf Workflow Engine", stage: "waiting", queuedAt: await page.evaluate(() => window.__jobs.ts(3 * 60 + 2.5)) })
      await setJobs([early, covers, theme_, tts, quick, turn])
      // Mark every row node, to prove none is remounted when twins come and go.
      await page.$$eval("[data-message-uid]", nodes => nodes.forEach(node => { node.__jobFixtureMark = true }))
      await page.evaluate(() => window.__jobs.setEnabled(true))
      await page.locator('[data-slot="job-twin"]').first().waitFor()
      const listCalls = (await calls()).filter(call => call.startsWith("list"))
      equal(listCalls.length, 1, "one list on open")
      const oldest = await page.evaluate(() => window.__jobs.ts(0))
      equal(listCalls[0], `list ${oldest}`, "bounded by the oldest loaded message")
      equal(await page.$$eval('[data-slot="job-twin"]', nodes => nodes.map(node => node.getAttribute("data-job-id"))), ["early", "covers", "theme"],
        "exclusions: ai-session, tts and a sub-2 s success get no twin")
      equal(await rowsSnapshot(), offRows, "transcript purity: the same rows in the same order")
      check(await page.$$eval("[data-message-uid]", nodes => nodes.every(node => node.__jobFixtureMark === true)), "no row was remounted")
      await settle()
      equal(await friezes(), offFriezes, "frieze integrity: every row's squares, indices, colours and labels unchanged beside twins")
      equal(await rowHeights(), offHeights, "no layout shift: twins in existing rows change no row's height")
      // Each twin sits right after the square of the call that launched it: the row reads in launch order.
      const placement = await page.evaluate(() => {
        const node = document.querySelector('[data-slot="job-twin"][data-job-id="covers"]')
        const kids = [...node.parentElement.children]
        return { row: node.closest("[data-message-uid]").getAttribute("data-message-uid"),
          order: kids.map(kid => kid.getAttribute("data-job-id") ? `job:${kid.getAttribute("data-job-id")}` : kid.getAttribute("aria-label") ?? kid.getAttribute("title") ?? "?"),
          next: node.closest("[data-message-uid]").nextElementSibling?.textContent?.includes("Both are on your GPU") }
      })
      check(placement.row.startsWith("activity:"), `twins are in the launching frieze row: ${placement.row}`)
      equal(placement.order.length, 5, `three squares and two twins: ${JSON.stringify(placement.order)}`)
      equal(placement.order.filter(item => item.startsWith("job:")), ["job:covers", "job:theme"], "in launch order")
      equal(placement.order.indexOf("job:covers"), 2, `covers right after the Bash call that launched it: ${JSON.stringify(placement.order)}`)
      equal(placement.order.indexOf("job:theme"), 4, `theme right after its own Bash call: ${JSON.stringify(placement.order)}`)
      check(placement.next, "and the reply text follows the row")
      check(await gap() < 2, "stuck to the bottom when twins appear")

      // One twin per job, two squares and their gap; the state is in its name, a percentage only when real.
      equal(await page.$$eval('[data-slot="job-twin"]', nodes => nodes.map(node => [node.offsetWidth, node.offsetHeight])),
        [[23, 10], [23, 10], [23, 10]], "every twin is 23 x 10")
      equal(await twin("covers").getAttribute("data-job-progress"), "62", "real progress drives the fill")
      equal(await fillOf("covers"), 62, "filled to 62%")
      check((await twin("covers").getAttribute("aria-label")).includes("Launch covers: 62% done"), "and is in its name")
      equal(await twin("covers").getAttribute("title"), await twin("covers").getAttribute("aria-label"), "tooltip says the same")
      equal(await colourOf("covers"), MAGENTA, "magenta, the delegation colour, for every kind")
      equal(await colourOf("theme"), MAGENTA)
      equal(await twin("theme").getAttribute("data-job-progress"), null, "queued: no percentage")
      check((await page.$eval('[data-job-id="theme"]', el => getComputedStyle(el).boxShadow)).includes("inset"), "queued: an outline")
      equal(await animationsOf("theme"), "square-spawn", "queued: still (spawned like a square, no loop)")
      equal(await animationsOf("covers"), "square-spawn, square-wobble, job-twin-glow", "running: the frieze's wobble at its own size and a glow")
      equal(await twin("early").locator(".job-twin-sweep").count(), 1, "no real progress: a segment sweeps through the tint")
      equal(await twin("covers").locator(".job-twin-sweep").count(), 0, "real progress: no sweep")
      equal(await page.locator('[data-slot="job-twin"] [aria-live], [data-slot="job-twin"][aria-live]').count(), 0, "no live-region chatter")
      equal(await page.locator('[data-slot="job-twin"] a, [data-slot="job-twin"] [data-job-menu]').count(), 0, "a twin is only a twin: no link, no menu")
      equal(await page.locator('[data-slot="job-card"], [data-slot="job-cards"], [data-slot="job-square"]').count(), 0, "no 80 px square anywhere")
      await shot("in-thread")
      // The click opens the summary, live, in the squares' dialog with their stepping.
      const summary = page.locator('[data-slot="job-summary"]')
      await twin("covers").click({ force: true })
      await summary.waitFor()
      check((await summary.locator("[data-job-summary-status]").innerText()).includes("62% done"), "summary: progress in words")
      check((await summary.innerText()).includes("ComfyUI"), "summary: where it runs")
      check(await summary.locator("[data-job-stop]").isVisible(), "summary: Stop while it runs")
      const expected = await page.evaluate(sel => {
        const stops = [...document.querySelectorAll(`${sel} [data-part-index], ${sel} [data-slot="job-twin"]`)]
        return `${stops.findIndex(node => node.getAttribute("data-job-id") === "covers") + 1} / ${stops.length}`
      }, scroller)
      equal(await summary.getByRole("group", { name: "Activity navigation" }).innerText().then(text => text.replace(/\s+/g, " ").trim()), expected,
        "the counter counts twins at their place among the squares")
      await shot("summary-running")
      await summary.locator("[data-job-menu]").click()
      equal(await page.locator('[role="menuitem"][data-job-link]').getAttribute("data-job-link"), "/apps/compute/jobs?select=covers", "Compute page: in the menu")
      // Arrow keys in the open menu move in the menu, never step the dialog.
      await page.waitForFunction(() => !!document.activeElement?.closest('[role="menu"]'))
      await page.keyboard.press("ArrowRight")
      await page.keyboard.press("ArrowLeft")
      equal(await summary.getByRole("group", { name: "Activity navigation" }).innerText().then(text => text.replace(/\s+/g, " ").trim()), expected, "the menu keeps its arrows")
      await page.keyboard.press("Escape")
      await page.locator('[role="menu"]').waitFor({ state: "detached" })
      // Previous from a twin is the square before it.
      await page.keyboard.press("ArrowLeft")
      await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.getAttribute("data-slot") !== "job-summary")
      await page.keyboard.press("ArrowRight")
      await summary.waitFor()
      await page.keyboard.press("Escape")
      await summary.waitFor({ state: "detached" })

      // ── Activity row: twins after delegations, through the same summary ───
      const statusRow = page.locator('[data-slot="activity-status-row"]')
      check((await statusRow.innerText()).includes("3 jobs · Early sketch · Launch covers 62%"), `row words: ${await statusRow.innerText()}`)
      await page.evaluate(() => window.__jobs.setDelegations(true))
      await page.waitForFunction(() => document.querySelector('[data-slot="activity-status-row"]')?.textContent?.includes("delegation"))
      const rowText = await statusRow.innerText()
      check(rowText.includes("1 delegation ongoing… · 3 jobs · Early sketch · Launch covers 62%"), `delegations first, jobs after: ${rowText}`)
      const shapes = await statusRow.locator('[data-activity-key]').evaluateAll(nodes => nodes.map(node => ({
        key: node.getAttribute("data-activity-key"), label: node.getAttribute("aria-label"), size: [node.offsetWidth, node.offsetHeight],
        round: getComputedStyle(node).borderRadius, colour: node.style.backgroundColor, running: node.hasAttribute("data-running") })))
      equal(shapes.map(shape => shape.key), ["host:d1", "host:job:early", "host:job:covers", "host:job:theme"], "the delegation keeps its place, jobs follow in launch order")
      equal(shapes[0].size, [10, 10], "the delegation is still a circle")
      check(shapes[0].round !== "2px", "and round")
      equal(shapes.slice(1).map(shape => shape.size), [[23, 10], [23, 10], [23, 10]], "running jobs are twins in the row")
      check(shapes.slice(1).every(shape => shape.colour === "rgb(236, 72, 153)" && shape.label.endsWith("(job)")), `magenta, labelled as jobs: ${JSON.stringify(shapes)}`)
      equal(shapes.map(shape => shape.running), [true, true, true, false], "running ones dance, the queued one is still")
      await shot("activity-row")
      // A row twin opens the job's own summary.
      await statusRow.locator('[data-activity-key="host:job:covers"]').click({ force: true })
      await summary.waitFor()
      check((await summary.locator("[data-job-summary-status]").innerText()).includes("62% done"), "the row's twin opens the same summary")
      equal(await summary.getByRole("group", { name: "Activity navigation" }).count(), 0, "standalone: no stepping from the row")
      await page.keyboard.press("Escape")
      await summary.waitFor({ state: "detached" })
      await page.evaluate(() => window.__jobs.setDelegations(false))

      // ── Frames: coalesced single reads, never a re-list, payload ignored ─
      const before = (await calls()).length
      await page.evaluate(() => window.__jobs.store.set("covers", { ...window.__jobs.store.get("covers"), progress: 0.8 }))
      for (let i = 0; i < 6; i++) await frame("job.updated", { id: "covers", status: "Running", progress: 0.99, name: "Injected" })
      await page.waitForFunction(() => document.querySelector('[data-job-id="covers"]')?.getAttribute("data-job-progress") === "80")
      // The fill glides to the new value instead of jumping, and lands on it.
      const midway = await fillOf("covers")
      check(midway > 61.5 && midway < 79.5, `the fill eases toward 80%: ${midway}`)
      await page.waitForFunction(() => parseFloat(getComputedStyle(document.querySelector('[data-slot="job-twin"][data-job-id="covers"]')).getPropertyValue("--job-twin-p")) > 79.9, null, { timeout: 3000 })
      equal(await sizeOf("covers"), [23, 10], "progressing never resizes it")
      const after = (await calls()).slice(before)
      equal(after, ["get covers"], "six frames, one single-job read")
      check(!(await twin("covers").getAttribute("aria-label")).includes("Injected"), "never rendered from the payload")

      // ── Duplicate delivery: a new job via discovery, then via reconnect ──
      const extra = await job({ id: "extra", name: "Wallpaper", progress: 0.1, queuedAt: new Date().toISOString() })
      await page.evaluate(extra => window.__jobs.store.set(extra.id, extra), extra)
      await frame("job.created", { id: "extra", capabilitySlug: "image-gen", discussion: "fixture-discussion" })
      await frame("job.created", { id: "other", capabilitySlug: "image-gen", discussion: "someone-else" })
      await twin("extra").waitFor()
      await frame("websocket.connected", {})
      await page.waitForTimeout(1300)
      equal(await twin("extra").count(), 1, "list and reconnect deliver the same job once")

      // ── Scroll: pinned stays pinned while twins finish and fail ─────────
      await page.$eval(scroller, el => { el.scrollTop = el.scrollHeight })
      await page.waitForTimeout(100)
      const heightsBeforeFinish = await rowHeights()
      await page.evaluate(() => {
        const { store, art } = window.__jobs
        store.set("covers", { ...store.get("covers"), status: "Completed", stage: "completed", progress: 1, durationMs: 72000,
          completedAt: window.__jobs.ts(window.__jobs.launch + 80), outputs: art.map((url, i) => ({ url, contentType: "image/svg+xml", sizeBytes: i })) })
        store.set("extra", { ...store.get("extra"), status: "Failed", stage: "failed", errorMessage: "CUDA out of memory while decoding frame 34", durationMs: 30000 })
      })
      await frame("job.updated", { id: "covers" })
      await frame("job.updated", { id: "extra" })
      await page.locator('[data-slot="job-twin"][data-job-id="covers"][data-job-state="done"]').waitFor()
      await page.locator('[data-slot="job-twin"][data-job-id="extra"][data-job-state="failed"]').waitFor()
      await page.waitForFunction(() => parseFloat(getComputedStyle(document.querySelector('[data-slot="job-twin"][data-job-id="covers"]')).getPropertyValue("--job-twin-p")) > 99.9, null, { timeout: 3000 })
      await settle()
      check(await gap() < 2, `still at the bottom after twins finished: ${await gap()}`)
      equal(await rowHeights(), heightsBeforeFinish, "finishing moved no row")
      equal(await animationsOf("covers"), "square-spawn", "done: solid and still")
      equal(await colourOf("extra"), await token("--color-accent-red"), "failed: red")
      equal(await fillOf("extra"), 100, "failed: solid")
      await shot("states-in-thread")
      // A batch's summary has every result; a result opens in the lightbox, which takes the summary's place.
      await twin("covers").click()
      await summary.waitFor()
      await page.waitForFunction(() => [...document.querySelectorAll('[data-slot="job-summary-images"] img')].length === 4
        && [...document.querySelectorAll('[data-slot="job-summary-images"] img')].every(img => img.complete))
      check((await summary.locator("[data-job-summary-status]").innerText()).includes("Done in 1:12"), "summary: done, and how long")
      equal(await summary.locator("[data-job-stop]").count(), 0, "no Stop once it's done")
      await shot("summary-batch")
      await summary.locator('[data-slot="job-summary-images"] button').first().click()
      await page.locator('[aria-label="Image preview"] img').waitFor()
      await page.waitForFunction(() => !document.querySelector('[data-slot="job-summary"]'))
      await page.keyboard.press("Escape")
      await page.locator('[aria-label="Image preview"]').waitFor({ state: "detached" })
      // A failure's summary says why.
      await twin("extra").click()
      await summary.waitFor()
      check((await summary.locator('[role="alert"]').innerText()).includes("CUDA out of memory"), "a failure's summary says why")
      await page.keyboard.press("Escape")
      await summary.waitFor({ state: "detached" })

      // ── Scroll: a reader scrolled up keeps their place while a twin above changes ──
      await page.evaluate(() => {
        const target = [...document.querySelectorAll("[data-message-uid]")].find(node => node.textContent?.includes("Answer 7."))
        const scrollerEl = document.querySelector('[data-slot="chat-panel"] .overflow-y-auto')
        scrollerEl.scrollTop += target.getBoundingClientRect().top - scrollerEl.getBoundingClientRect().top - 200
      })
      await page.waitForTimeout(150)
      const anchorTop = () => page.evaluate(() => [...document.querySelectorAll("[data-message-uid]")]
        .find(node => node.textContent?.includes("Answer 7."))?.getBoundingClientRect().top)
      const earlyAboveView = await page.evaluate(() => document.querySelector('[data-job-id="early"]').getBoundingClientRect().bottom
        < document.querySelector('[data-slot="chat-panel"] .overflow-y-auto').getBoundingClientRect().top)
      check(await gap() > 120, `the reader is well above the tail: ${await gap()}`)
      const topBefore = await anchorTop()
      await page.evaluate(() => {
        const { store } = window.__jobs
        store.set("early", { ...store.get("early"), status: "Failed", stage: "failed", durationMs: 40000, errorMessage: "Step 2 (Group) timed out after 30 s while waiting for the mail provider to answer." })
      })
      await frame("job.updated", { id: "early" })
      await page.waitForFunction(() => document.querySelector('[data-job-id="early"]')?.getAttribute("data-job-state") === "failed")
      await settle()
      const topAfter = await anchorTop()
      equal(await sizeOf("early"), [23, 10], "the twin above changed state and kept its size")
      check(earlyAboveView, "the changing twin is above the reader's viewport")
      check(Math.abs(topAfter - topBefore) <= 1, `reader's anchor did not move: ${topBefore} -> ${topAfter}`)

      // ── The twin stays when the reply shows the image; Stop from the summary ──
      await page.$eval(scroller, el => { el.scrollTop = el.scrollHeight })
      await page.waitForFunction(sel => { const el = document.querySelector(sel); return el.scrollHeight - el.scrollTop - el.clientHeight < 2 }, scroller)
      await page.waitForTimeout(100)
      await page.evaluate(() => window.__jobs.setLanded(true))
      await page.locator('[data-chat-assistant-text] img').first().waitFor()
      equal(await twin("covers").count(), 1, "the reply shows it: the twin stays")
      await page.waitForFunction(() => [...document.querySelectorAll('[data-chat-assistant-text] img')].every(img => img.complete))
      await settle()
      check(await gap() < 2, `pinned when the reply's image lands: ${await gap()}`)
      await page.evaluate(() => {
        const { store } = window.__jobs
        store.set("theme", { ...store.get("theme"), status: "Running", stage: "executing", progress: 0.45, startedAt: store.get("theme").queuedAt })
      })
      await frame("job.updated", { id: "theme" })
      await page.waitForFunction(() => document.querySelector('[data-job-id="theme"]')?.getAttribute("data-job-state") === "running")
      await twin("theme").click({ force: true })
      await summary.waitFor()
      await summary.locator("[data-job-stop]").click()
      await frame("job.updated", { id: "theme" })
      await page.locator('[data-slot="job-twin"][data-job-id="theme"][data-job-state="stopped"]').waitFor()
      await summary.locator("[data-job-stop]").waitFor({ state: "detached" })
      check((await summary.locator("[data-job-summary-status]").innerText()).includes("Stopped"), "the open summary follows the job")
      await page.keyboard.press("Escape")
      await summary.waitFor({ state: "detached" })
      check((await twin("theme").getAttribute("aria-label")).includes("Stopped"), "a stopped job keeps its twin and says so")
      await settle()
      equal(await colourOf("theme"), await token("--color-text-disabled"), "stopped: grey")
      check(Math.abs(await fillOf("theme") - 45) < 0.5, `stopped: the fill it reached: ${await fillOf("theme")}`)
      equal(await animationsOf("theme"), "square-spawn", "stopped: still")

      // ── A message with no frieze: its job makes exactly one row of its own ──
      await page.$eval(scroller, el => { el.scrollTop = el.scrollHeight })
      await page.waitForTimeout(100)
      const landedRow = () => page.evaluate(() => [...document.querySelectorAll("[data-message-uid]")].find(node => node.textContent?.includes("The boss cover is the one")))
      const rowsBefore = await rowsSnapshot()
      const topsBefore = await page.$$eval("[data-message-uid]", nodes => nodes.map(node => node.offsetTop))
      const landedFriezesBefore = await page.evaluate(() => [...document.querySelectorAll("[data-message-uid]")]
        .find(node => node.textContent?.includes("The boss cover is the one")).querySelectorAll(".flex.flex-wrap.items-center").length)
      const poster = await job({ id: "poster", name: "Poster", progress: 0.3, queuedAt: await page.evaluate(() => window.__jobs.ts(window.__jobs.launch + 201)) })
      await page.evaluate(poster => window.__jobs.store.set(poster.id, poster), poster)
      await frame("job.created", { id: "poster", capabilitySlug: "image-gen", discussion: "fixture-discussion" })
      await twin("poster").waitFor()
      await settle()
      const own = await page.evaluate(() => {
        const node = document.querySelector('[data-slot="job-twin"][data-job-id="poster"]')
        const row = node.closest("[data-message-uid]")
        const friezes = row.querySelectorAll(".flex.flex-wrap.items-center")
        return { text: row.textContent.includes("The boss cover is the one"), friezes: friezes.length,
          kids: [...node.parentElement.children].map(kid => kid.getAttribute("data-slot")) }
      })
      check(own.text, "the twin joins the message that was active when it was queued")
      equal([landedFriezesBefore, own.friezes], [0, 1], "that message had no frieze; now exactly one")
      equal(own.kids, ["job-twin"], "holding only the twin")
      equal(await rowsSnapshot(), rowsBefore, "no row added or removed")
      const topsAfter = await page.$$eval("[data-message-uid]", nodes => nodes.map(node => node.offsetTop))
      const landedIndex = rowsBefore.length - 1
      equal(topsAfter.slice(0, landedIndex), topsBefore.slice(0, landedIndex), "every row before it stays where it was")
      check(await gap() < 2, `pinned while the new row appears: ${await gap()}`)
      await shot("own-row")
      await page.evaluate(() => { window.__jobs.store.delete("poster"); window.__jobs.set([...window.__jobs.store.values()]) })
      await page.locator('[data-slot="job-twin"][data-job-id="poster"]').waitFor({ state: "detached" })
      await page.evaluate(() => window.__jobs.setLanded(false))

      // ── Frieze filtering: hiding the launching squares hides only them ──
      const squaresBefore = await page.locator(`${scroller} [data-part-index]`).count()
      const twinsBefore = await page.$$eval('[data-slot="job-twin"]', nodes => nodes.map(node => node.getAttribute("data-job-id")))
      await page.evaluate(() => window.__jobs.setHideShell(true))
      await page.waitForFunction(n => document.querySelectorAll('[data-slot="chat-panel"] .overflow-y-auto [data-part-index]').length < n, squaresBefore)
      equal(squaresBefore - await page.locator(`${scroller} [data-part-index]`).count(), 2, "only the two shell squares hide")
      equal(await page.$$eval('[data-slot="job-twin"]', nodes => nodes.map(node => node.getAttribute("data-job-id"))), twinsBefore,
        "twins are not markers: every one stays")
      check(await twin("covers").evaluate(node => node.closest("[data-message-uid]").getAttribute("data-message-uid").startsWith("activity:")), "still in the launching frieze row")
      await page.evaluate(() => window.__jobs.setHideShell(false))

      // ── Older page: a job anchored before everything loaded waits ──────
      const ancient = await job({ id: "ancient", name: "From an older page", queuedAt: "2026-11-15T08:00:00.000Z" })
      await page.evaluate(ancient => window.__jobs.store.set(ancient.id, ancient), ancient)
      await frame("job.created", { id: "ancient", capabilitySlug: "image-gen", discussion: "fixture-discussion" })
      await page.waitForTimeout(1300)
      equal(await page.locator('[data-job-id="ancient"]').count(), 0, "anchored to an unloaded (or earlier-epoch) message: hidden")

      // ── Reduced motion: nothing moves, the fill still shows the value ───
      await page.evaluate(() => {
        const { store } = window.__jobs
        // New jobs are queued now: discovery lists from the last list on (less 2 min), as for real jobs.
        const now = new Date().toISOString()
        store.set("motion", { ...store.get("extra"), id: "motion", name: "Motion check", status: "Running", stage: "executing", progress: 0.4, errorMessage: null, queuedAt: now, startedAt: now })
        store.set("sweep", { ...store.get("extra"), id: "sweep", name: "Sweep check", status: "Running", stage: "waiting", progress: 0, errorMessage: null, queuedAt: now, startedAt: now })
      })
      await frame("job.created", { id: "motion", capabilitySlug: "image-gen", discussion: "fixture-discussion" })
      await frame("job.created", { id: "sweep", capabilitySlug: "image-gen", discussion: "fixture-discussion" })
      await twin("sweep").waitFor()
      await page.emulateMedia({ reducedMotion: "reduce" })
      const moving = await page.evaluate(() => [...document.querySelectorAll('[data-slot="job-twin"], [data-slot="job-twin"] *')]
        .filter(node => getComputedStyle(node).animationName !== "none" || getComputedStyle(node).transitionDuration !== "0s").length)
      equal(moving, 0, "reduced motion: no wobble, glow, sweep or glide")
      equal(await fillOf("motion"), 40, "and the fill still shows the value")
      await page.emulateMedia({ reducedMotion: null })

      // ── High contrast: a full-colour edge on every twin ────────────────
      await page.evaluate(() => document.documentElement.setAttribute("data-contrast", "high"))
      check((await page.$eval('[data-job-id="motion"]', el => getComputedStyle(el).getPropertyValue("--job-twin-edge"))).includes("inset"), "high contrast: an edge")
      await shot("high-contrast")
      await page.evaluate(() => document.documentElement.removeAttribute("data-contrast"))
      for (const name of ["light", "cozy"]) {
        await theme(name)
        await shot(`in-thread-${name}`)
      }
      await theme("dark")

      // ── Off again: the transcript is byte for byte what it was ──────────
      await page.evaluate(() => window.__jobs.setEnabled(false))
      await page.waitForFunction(() => !document.querySelector('[data-slot="job-twin"]'))
      const callsAtOff = (await calls()).length
      await frame("job.updated", { id: "theme" })
      await frame("websocket.connected", {})
      await page.waitForTimeout(1300)
      equal((await calls()).length, callsAtOff, "turned off: frames cause no request")
      // The activity row and scroll position may differ; the transcript content must not.
      const strip = html => html.replace(/ style="[^"]*"/g, "")
      equal(strip(await contentHtml()).replace(/<div data-slot="activity-status-row".*$/s, ""),
        strip(offHtml).replace(/<div data-slot="activity-status-row".*$/s, ""), "absent jobs: the same transcript markup as before")
      check(await page.$$eval("[data-message-uid]", nodes => nodes.filter(node => node.__jobFixtureMark).length) > 0, "rows survived the whole run")

      // ── Gallery: every state, 1:1 and 4x, in dark, light, cozy and high contrast ──
      await page.goto(`${origin}?gallery`)
      await page.locator('[data-gallery]').first().waitFor()
      await icons()
      const gallery = id => page.locator(`[data-gallery="${id}"] [data-slot="job-twin"]`)
      equal(await gallery("g-w").getAttribute("data-job-progress"), null, "no real progress: no percentage")
      equal(await gallery("g-w").locator(".job-twin-sweep").count(), 1, "and the sweep")
      equal(await gallery("g-p").getAttribute("data-job-progress"), "62")
      // Mounted already stopped (a reload): the cancelled record's kept progress, not an empty twin.
      check(Math.abs(await gallery("g-s").evaluate(el => parseFloat(getComputedStyle(el).getPropertyValue("--job-twin-p"))) - 30) < 0.5, "a stopped job loaded fresh shows how far it got")
      check((await gallery("g-w").getAttribute("aria-label")).includes("Starting up"), "stage in words while waiting")
      equal(await gallery("g-n").evaluate(el => getComputedStyle(el).animationName), "square-spawn, job-twin-pulse", "needs you: a soft pulse")
      equal(await gallery("g-n").evaluate(el => getComputedStyle(el).getPropertyValue("--job-twin-c").trim()), await token("--color-accent-gold"), "needs you: gold")
      equal(await page.$$eval('[data-gallery] [data-slot="job-twin"]', nodes => nodes.map(node => [node.offsetWidth, node.offsetHeight]).filter(([w, h]) => w !== 23 || h !== 10)), [],
        "every state is 23 x 10")
      // One finished image: the summary shows it large, and opens it in the lightbox.
      await gallery("g-c").click()
      const gallerySummary = page.locator('[data-slot="job-summary"]')
      await gallerySummary.waitFor()
      check((await gallerySummary.locator('[data-slot="job-summary-prompt"]').innerText()).includes("mossy ruin"), "the summary shows what was asked")
      await page.waitForFunction(() => document.querySelector('[data-slot="job-summary-images"] img')?.complete)
      await shot("summary-single")
      await gallerySummary.locator('[data-slot="job-summary-images"] button').click()
      await page.locator('[aria-label="Image preview"] img').waitFor()
      await page.keyboard.press("Escape")
      await page.locator('[aria-label="Image preview"]').waitFor({ state: "detached" })
      // A workflow's summary lists its steps.
      await gallery("k-w").click({ force: true })
      await gallerySummary.waitFor()
      equal(await gallerySummary.locator('[data-slot="job-summary-steps"] li').count(), 4, "a workflow's summary lists its steps")
      await shot("summary-workflow")
      await page.keyboard.press("Escape")
      await gallerySummary.waitFor({ state: "detached" })
      for (const name of ["dark", "light", "cozy"]) {
        await theme(name)
        await shot(`gallery-${name}`)
      }
      await theme("dark")
      await page.evaluate(() => document.documentElement.setAttribute("data-contrast", "high"))
      await shot("gallery-high-contrast")
      await page.evaluate(() => document.documentElement.removeAttribute("data-contrast"))
      check(errors.length === 0, `no page errors: ${errors.join("\n")}`)
      await page.close()
      console.log(`job twins ${width}x${height}: ok`)
    }
    console.log(`job twins: ${checks} checks passed; screenshots in ${shots}`)
  } finally {
    await browser?.close()
    await server.close()
  }
}

main().catch(error => { console.error(error); process.exit(1) })
