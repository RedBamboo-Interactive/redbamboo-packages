const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const os = require("node:os")
const { pathToFileURL } = require("node:url")
const { chromium } = require(require.resolve("playwright", { paths: [path.resolve(__dirname, "../../../testing")] }))

// Mounted shared-Chat fixture for job cards (f6e6c083): transcript purity and
// no remount, stick-to-bottom and the reader's anchor while cards appear and
// grow, duplicate delivery, older pages, the activity row after delegations,
// collapse to a chip, Stop, frieze filtering, the setting off (no requests),
// accessibility, reduced motion, and screenshots in dark, light and cozy.
// PHOSPHOR_ROOT optionally points at an @phosphor-icons/web package for icons.
async function main() {
  const packageRoot = path.resolve(__dirname, "../..")
  const scratch = process.env.JOB_CARDS_OUT || process.env.REDLEAF_SCRATCH_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "chat-job-cards-"))
  const shots = path.join(scratch, "job-cards")
  fs.mkdirSync(shots, { recursive: true })
  const phosphorRoot = process.env.PHOSPHOR_ROOT && fs.realpathSync(process.env.PHOSPHOR_ROOT)
  const { createServer } = await import(pathToFileURL(require.resolve("vite")))
  const tailwind = (await import(pathToFileURL(require.resolve("@tailwindcss/vite", { paths: [path.resolve(packageRoot, "../ui")] })))).default
  const server = await createServer({ configFile: false, root: __dirname, plugins: [tailwind()],
    cacheDir: path.join(scratch, "job-cards-vite-cache"),
    resolve: { alias: {
      react: path.join(packageRoot, "node_modules/react"), "react-dom": path.join(packageRoot, "node_modules/react-dom"),
    } },
    server: { host: "127.0.0.1", port: 0, fs: { allow: [path.resolve(packageRoot, "../.."), scratch, ...(phosphorRoot ? [phosphorRoot] : [])] } },
  })
  let browser
  let checks = 0
  const check = (value, message) => { assert.ok(value, message); checks++ }
  const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++ }
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
      const scroller = '[data-slot="chat-panel"] .overflow-y-auto'
      const gap = () => page.$eval(scroller, el => el.scrollHeight - el.scrollTop - el.clientHeight)
      const rowsSnapshot = () => page.$$eval("[data-message-uid]", nodes => nodes.map(node => node.getAttribute("data-message-uid")))
      const contentHtml = () => page.$eval(`${scroller} > div`, el => el.innerHTML)
      const calls = () => page.evaluate(() => window.__jobs.calls.slice())
      const job = (fields) => page.evaluate(fields => {
        const { ts, launch } = window.__jobs
        return { capability: "image-gen", providerName: "ComfyUI", status: "Running", stage: "executing", progress: 0,
          queuedAt: ts(launch + 2.5), startedAt: ts(launch + 2.5), ...fields }
      }, fields)
      const setJobs = async records => { await page.evaluate(records => window.__jobs.set(records), records) }
      const frame = async (type, data) => { await page.evaluate(([type, data]) => window.__jobs.frame(type, data), [type, data]) }

      // ── Setting off: no cards, no row entries, no job requests ─────────
      await page.goto(`${origin}?off`)
      await page.locator("[data-message-uid]").first().waitFor()
      await icons()
      await page.evaluate(() => window.__jobs.set([]))
      await frame("job.created", { id: "covers", capabilitySlug: "image-gen", discussion: "fixture-discussion" })
      await frame("websocket.connected", {})
      await page.waitForTimeout(1200)
      equal(await calls(), [], "setting off: no job request at all")
      const offHtml = await contentHtml()
      const offRows = await rowsSnapshot()
      equal(await page.locator('[data-slot="job-card"], [data-slot="job-chip"]').count(), 0, "setting off: no card")

      // ── On: one bounded list, cards in the launching message ────────────
      const covers = await job({ id: "covers", name: "Launch covers", progress: 0.62 })
      const theme = await job({ id: "theme", name: "Mossbound theme", capability: "music-gen", providerName: "Suno", status: "Queued", stage: "admitted", queuedAt: covers.queuedAt.replace(/\d\d(\.\d+)?Z$/, m => m), startedAt: null })
      theme.queuedAt = await page.evaluate(() => window.__jobs.ts(window.__jobs.launch + 4.5))
      const tts = await job({ id: "voice", capability: "tts", status: "Completed", durationMs: 4000 })
      const quick = await job({ id: "quick", status: "Completed", durationMs: 900 })
      const turn = await job({ id: "ai", capability: "ai-session" })
      const early = await job({ id: "early", name: "Early sketch", capability: "workflow", providerName: "RedLeaf Workflow Engine", stage: "waiting", queuedAt: await page.evaluate(() => window.__jobs.ts(3 * 60 + 2.5)) })
      await setJobs([early, covers, theme, tts, quick, turn])
      // Mark every row node, to prove none is remounted when cards come and go.
      await page.$$eval("[data-message-uid]", nodes => nodes.forEach(node => { node.__jobFixtureMark = true }))
      await page.evaluate(() => window.__jobs.setEnabled(true))
      await page.locator('[data-slot="job-card"]').first().waitFor()
      const listCalls = (await calls()).filter(call => call.startsWith("list"))
      equal(listCalls.length, 1, "one list on open")
      const oldest = await page.evaluate(() => window.__jobs.ts(0))
      equal(listCalls[0], `list ${oldest}`, "bounded by the oldest loaded message")
      equal(await page.$$eval('[data-slot="job-card"]', nodes => nodes.map(node => node.getAttribute("data-job-id"))), ["early", "covers", "theme"],
        "exclusions: ai-session, tts and a sub-2 s success get no card")
      equal(await rowsSnapshot(), offRows, "transcript purity: the same rows in the same order")
      check(await page.$$eval("[data-message-uid]", nodes => nodes.every(node => node.__jobFixtureMark === true)), "no row was remounted")
      // The cards sit in the launching message, after its frieze, before its reply text.
      const placement = await page.evaluate(() => {
        const cards = document.querySelector('[data-job-id="covers"]').closest('[data-slot="job-cards"]')
        const prev = cards.previousElementSibling
        const next = cards.nextElementSibling
        return { prevFrieze: !!prev?.querySelector('[data-tool-use-id="t-covers"], button[title], [data-message-uid^="activity:"]') || prev?.getAttribute("data-message-uid")?.startsWith("activity:"),
          nextText: next?.textContent?.includes("Both are on your GPU") }
      })
      check(placement.prevFrieze, "cards follow the launching frieze")
      check(placement.nextText, "and come before the reply text")
      check(await gap() < 2, "stuck to the bottom when cards appear")

      // Accessibility: a progressbar only when determinate.
      const bar = page.locator('[data-job-id="covers"] [role="progressbar"]')
      equal(await bar.getAttribute("aria-valuenow"), "62", "determinate progress is announced on demand")
      equal(await page.locator('[data-job-id="theme"] [role="progressbar"]').count(), 0, "queued has no progressbar")
      equal(await page.locator('[data-slot="job-cards"] [aria-live]').count(), 0, "no live-region chatter")
      equal(await page.locator('[data-job-id="covers"] a[data-job-link]').getAttribute("href"), "/apps/compute/jobs?select=covers")
      await shot("in-thread")

      // ── Activity row: jobs after delegations, through the same summary ───
      const statusRow = page.locator('[data-slot="activity-status-row"]')
      check((await statusRow.innerText()).includes("3 jobs · Early sketch · Launch covers 62%"), `row words: ${await statusRow.innerText()}`)
      await page.evaluate(() => window.__jobs.setDelegations(true))
      await page.waitForFunction(() => document.querySelector('[data-slot="activity-status-row"]')?.textContent?.includes("delegation"))
      const rowText = await statusRow.innerText()
      check(rowText.includes("1 delegation ongoing… · 3 jobs · Early sketch · Launch covers 62%"), `delegations first, jobs after: ${rowText}`)
      const shapeLabels = await statusRow.locator("[aria-label]").evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-label")))
      const delegationAt = shapeLabels.findIndex(label => label?.includes("Pin bump"))
      const jobAt = shapeLabels.findIndex(label => label?.includes("(job)"))
      check(delegationAt >= 0 && jobAt > delegationAt, `delegation shape keeps its place, jobs follow: ${JSON.stringify(shapeLabels)}`)
      await shot("activity-row")
      await page.evaluate(() => window.__jobs.setDelegations(false))

      // ── Frames: coalesced single reads, never a re-list, payload ignored ─
      const before = (await calls()).length
      await page.evaluate(() => window.__jobs.store.set("covers", { ...window.__jobs.store.get("covers"), progress: 0.8 }))
      for (let i = 0; i < 6; i++) await frame("job.updated", { id: "covers", status: "Running", progress: 0.99, name: "Injected" })
      await page.waitForFunction(() => document.querySelector('[data-job-id="covers"] [role="progressbar"]')?.getAttribute("aria-valuenow") === "80")
      const after = (await calls()).slice(before)
      equal(after, ["get covers"], "six frames, one single-job read")
      check(!(await page.locator('[data-job-id="covers"]').innerText()).includes("Injected"), "never rendered from the payload")

      // ── Duplicate delivery: a new job via discovery, then via reconnect ──
      const extra = await job({ id: "extra", name: "Wallpaper", progress: 0.1, queuedAt: await page.evaluate(() => window.__jobs.ts(window.__jobs.launch + 5)) })
      await page.evaluate(extra => window.__jobs.store.set(extra.id, extra), extra)
      await frame("job.created", { id: "extra", capabilitySlug: "image-gen", discussion: "fixture-discussion" })
      await frame("job.created", { id: "other", capabilitySlug: "image-gen", discussion: "someone-else" })
      await page.locator('[data-job-id="extra"]').waitFor()
      await frame("websocket.connected", {})
      await page.waitForTimeout(1300)
      equal(await page.locator('[data-job-id="extra"]').count(), 1, "list and reconnect deliver the same job once")

      // ── Scroll: pinned stays pinned while a card grows (tiles develop) ──
      await page.$eval(scroller, el => { el.scrollTop = el.scrollHeight })
      await page.waitForTimeout(100)
      await page.evaluate(() => {
        const { store, art } = window.__jobs
        store.set("covers", { ...store.get("covers"), status: "Completed", stage: "completed", progress: 1, durationMs: 72000,
          completedAt: window.__jobs.ts(window.__jobs.launch + 80), outputs: art.map((url, i) => ({ url, contentType: "image/svg+xml", sizeBytes: i })) })
        store.set("extra", { ...store.get("extra"), status: "Failed", stage: "failed", errorMessage: "CUDA out of memory while decoding frame 34", durationMs: 30000 })
      })
      await frame("job.updated", { id: "covers" })
      await frame("job.updated", { id: "extra" })
      await page.locator('[data-job-id="covers"][data-job-state="done"] [data-developed]').first().waitFor()
      await page.waitForFunction(() => document.querySelectorAll('[data-job-id="covers"] [data-developed]').length === 4)
      await settle()
      check(await gap() < 2, `still at the bottom after the card grew: ${await gap()}`)
      check((await page.locator('[data-job-id="extra"]').innerText()).includes("CUDA out of memory"), "a failed job shows why")
      equal(await page.locator('[data-job-id="extra"]').getAttribute("data-job-state"), "failed")
      await shot("states-in-thread")

      // ── Scroll: a reader scrolled up keeps their place while a card above grows ──
      // Read a message several turns below the early card, mid-viewport.
      await page.evaluate(() => {
        const target = [...document.querySelectorAll("[data-message-uid]")].find(node => node.textContent?.includes("Answer 10."))
        const scrollerEl = document.querySelector('[data-slot="chat-panel"] .overflow-y-auto')
        scrollerEl.scrollTop += target.getBoundingClientRect().top - scrollerEl.getBoundingClientRect().top - 200
      })
      await page.waitForTimeout(150)
      const anchorTop = () => page.evaluate(() => [...document.querySelectorAll("[data-message-uid]")]
        .find(node => node.textContent?.includes("Answer 10."))?.getBoundingClientRect().top)
      const earlyBelowView = await page.evaluate(() => document.querySelector('[data-job-id="early"]').getBoundingClientRect().bottom
        < document.querySelector('[data-slot="chat-panel"] .overflow-y-auto').getBoundingClientRect().top)
      const topBefore = await anchorTop()
      await page.evaluate(() => {
        const { store, art } = window.__jobs
        store.set("early", { ...store.get("early"), status: "Failed", stage: "failed", durationMs: 40000, errorMessage: "Step 2 (Group) timed out after 30 s while waiting for the mail provider to answer." })
      })
      await frame("job.updated", { id: "early" })
      await page.waitForFunction(() => document.querySelector('[data-job-id="early"]')?.getAttribute("data-job-state") === "failed")
      await settle()
      const topAfter = await anchorTop()
      check(await page.locator('[data-job-id="early"]').evaluate(el => Math.round(el.getBoundingClientRect().height)) === 80, "the card above changed state and kept its 80 px")
      check(earlyBelowView, `the growing card is above the reader's viewport: ${JSON.stringify(await page.evaluate(() => ({
        card: document.querySelector('[data-job-id="early"]')?.getBoundingClientRect().bottom,
        scroller: document.querySelector('[data-slot="chat-panel"] .overflow-y-auto').getBoundingClientRect().top,
        scrollTop: document.querySelector('[data-slot="chat-panel"] .overflow-y-auto').scrollTop,
        anchor: [...document.querySelectorAll("[data-message-uid]")].find(node => node.textContent?.includes("Answer 10."))?.getBoundingClientRect().top,
      })))}`)
      check(Math.abs(topAfter - topBefore) <= 1, `reader's anchor did not move: ${topBefore} -> ${topAfter}`)

      // ── Collapse (heuristic) when the reply shows an image; Stop ────────
      await page.$eval(scroller, el => { el.scrollTop = el.scrollHeight })
      await page.waitForFunction(sel => { const el = document.querySelector(sel); return el.scrollHeight - el.scrollTop - el.clientHeight < 2 }, scroller)
      await page.waitForTimeout(100)
      await page.evaluate(() => window.__jobs.setLanded(true))
      await page.locator('[data-slot="job-chip"][data-job-id="covers"]').waitFor()
      equal(await page.locator('[data-slot="job-card"][data-job-id="theme"]').count(), 1, "the music job keeps its card")
      await page.waitForFunction(() => [...document.querySelectorAll('[data-chat-assistant-text] img')].every(img => img.complete))
      await settle()
      check(await gap() < 2, `pinned through the collapse: ${await gap()}`)
      await page.evaluate(() => {
        const { store } = window.__jobs
        store.set("theme", { ...store.get("theme"), status: "Running", stage: "executing", progress: 0.45, startedAt: store.get("theme").queuedAt })
      })
      await frame("job.updated", { id: "theme" })
      await page.waitForFunction(() => document.querySelector('[data-job-id="theme"]')?.getAttribute("data-job-state") === "running")
      const stop = page.locator('[data-job-id="theme"] [data-job-stop]')
      await page.locator('[data-job-id="theme"]').hover()
      await stop.click()
      await frame("job.updated", { id: "theme" })
      await page.locator('[data-slot="job-chip"][data-job-id="theme"][data-job-state="stopped"]').waitFor()
      await shot("landed")
      await page.evaluate(() => window.__jobs.setLanded(false))

      // ── Frieze filtering: hiding the launching squares keeps the cards ──
      const chipsBefore = await page.locator('[data-slot="job-cards"] > *').count()
      await page.evaluate(() => window.__jobs.setHideShell(true))
      await page.waitForTimeout(100)
      equal(await page.locator('[data-slot="job-cards"] > *').count(), chipsBefore, "cards stay when their frieze squares are hidden")
      await page.evaluate(() => window.__jobs.setHideShell(false))

      // ── Older page: a job anchored before everything loaded waits ──────
      const ancient = await job({ id: "ancient", name: "From an older page", queuedAt: "2026-11-15T08:00:00.000Z" })
      await page.evaluate(ancient => window.__jobs.store.set(ancient.id, ancient), ancient)
      await frame("job.created", { id: "ancient", capabilitySlug: "image-gen", discussion: "fixture-discussion" })
      await page.waitForTimeout(1300)
      equal(await page.locator('[data-job-id="ancient"]').count(), 0, "anchored to an unloaded (or earlier-epoch) message: hidden")

      // ── Reduced motion: nothing loops ───────────────────────────────────
      await page.emulateMedia({ reducedMotion: "reduce" })
      const looping = await page.evaluate(() => [...document.querySelectorAll('[data-slot="job-cards"] *')]
        .filter(node => getComputedStyle(node).animationName !== "none" && getComputedStyle(node).animationIterationCount === "infinite").length)
      equal(looping, 0, "reduced motion: no looping animation in cards")
      await page.emulateMedia({ reducedMotion: null })

      // ── Off again: the transcript is byte for byte what it was ──────────
      await page.evaluate(() => window.__jobs.setEnabled(false))
      await page.waitForFunction(() => !document.querySelector('[data-slot="job-cards"]'))
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

      // ── Gallery: every state and kind, in dark, light and cozy ──────────
      await page.goto(`${origin}?gallery`)
      await page.locator('[data-gallery]').first().waitFor()
      await icons()
      equal(await page.locator('[data-gallery="g-w"] [role="progressbar"]').count(), 0, "no real progress: no progressbar")
      equal(await page.locator('[data-gallery="g-p"] [role="progressbar"]').getAttribute("aria-valuenow"), "62")
      check((await page.locator('[data-gallery="g-w"]').innerText()).includes("starting up"), "stage in words while waiting")
      for (const theme of ["dark", "light", "cozy"]) {
        await page.evaluate(theme => {
          document.documentElement.classList.toggle("dark", theme !== "light")
          if (theme === "cozy") document.documentElement.setAttribute("data-cozy", "")
          else document.documentElement.removeAttribute("data-cozy")
        }, theme)
        await page.waitForFunction(() => document.querySelectorAll('[data-gallery] [data-developed]').length >= 4)
        await shot(`gallery-${theme}`)
      }
      check(errors.length === 0, `no page errors: ${errors.join("\n")}`)
      await page.close()
      console.log(`job cards ${width}x${height}: ok`)
    }
    console.log(`job cards: ${checks} checks passed; screenshots in ${shots}`)
  } finally {
    await browser?.close()
    await server.close()
  }
}

main().catch(error => { console.error(error); process.exit(1) })
