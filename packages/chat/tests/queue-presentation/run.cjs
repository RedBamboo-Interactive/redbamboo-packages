const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const os = require("node:os")
const { pathToFileURL } = require("node:url")
const { chromium } = require(require.resolve("playwright", { paths: [path.resolve(__dirname, "../../../testing")] }))

async function main() {
  const packageRoot = path.resolve(__dirname, "../..")
  const scratch = process.env.REDLEAF_SCRATCH_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "chat-queue-test-"))
  const { createServer } = await import(pathToFileURL(require.resolve("vite")))
  const server = await createServer({ configFile: false, root: __dirname,
    cacheDir: path.join(scratch, "queue-ui-vite-cache"),
    resolve: { alias: {
      react: path.join(packageRoot, "node_modules/react"), "react-dom": path.join(packageRoot, "node_modules/react-dom"),
    } },
    server: { host: "127.0.0.1", port: 0, fs: { allow: [path.resolve(packageRoot, "../.."), scratch] } },
  })
  let browser
  const results = []
  try {
    await server.listen()
    const origin = server.resolvedUrls.local[0]
    browser = await chromium.launch({ headless: true })
    for (const width of [1100, 390]) {
      const events = await browser.newPage({ viewport: { width, height: 850 } })
      const eventErrors = []
      events.on("pageerror", error => eventErrors.push(error.message))
      await events.goto(origin + "?events")
      await events.getByRole("button", { name: /coordination: Queued/ }).first().waitFor()
      assert.equal(await events.locator("[data-queue-item-id]").count(), 0)
      assert.equal(await events.locator("[data-input-message-uid]").count(), 2)
      await events.locator('[data-input-message-uid="second"]').click()
      await events.getByRole("button", { name: "Send queued event now", exact: true }).waitFor()
      await events.evaluate(() => eventQueueTest.change("failed"))
      // This lightweight harness omits the theme CSS. Exercise the accessible
      // keyboard action; pointer interaction is covered in the Leaf-shell replay.
      await events.getByRole("button", { name: "Retry queued event", exact: true }).focus()
      await events.getByRole("button", { name: "Retry queued event", exact: true }).press("Enter")
      await events.getByRole("button", { name: "Send queued event now", exact: true }).waitFor()
      assert.deepEqual(await events.evaluate(() => eventQueueTest.actions), ["retry:second"])
      await events.evaluate(() => eventQueueTest.change("delivering"))
      await events.getByText("Delivering update", { exact: true }).waitFor()
      await events.evaluate(() => eventQueueTest.change("delivered"))
      await events.locator('[data-slot="nova-event-queue-status"]').waitFor({ state: "hidden" })
      assert.equal(await events.locator("[data-input-message-uid]").count(), 2)
      await events.keyboard.press("Escape")
      await events.evaluate(() => eventQueueTest.remount())
      await events.locator('[data-input-message-uid="first"]').click()
      assert.equal(await events.locator('[data-slot="nova-event-queue-status"]').count(), 0)
      assert.deepEqual(eventErrors, [])
      results.push({ scenario: "projected-event-queue-lifecycle", width, passed: true })
      await events.close()
      const links = await browser.newPage({ viewport: { width, height: 850 } })
      await links.goto(origin + "?links")
      await links.getByRole("button", { name: /Open L:/ }).click()
      await links.getByRole("button", { name: /Open T:/ }).click()
      assert.deepEqual(await links.evaluate(() => queueTest.opened), [
        { filePath: "L:/Workspaces/Nova/memory/projects/Double Message Audit 2026-09-13.md", line: undefined, column: undefined },
        { filePath: "T:/Projects/file.cs", line: 12, column: 4 },
      ])
      assert.equal(await links.locator('[data-slot="internal-leaf-link"]').getAttribute("href"), "/apps/nova/journal/memory/note.md")
      assert.equal(links.url(), origin + "?links")
      results.push({ scenario: "local-file-links", width, passed: true })
      await links.close()
      for (const scenario of ["single", "batch", "opaque-batch", "stale-list", "late-admission", "same-text", "rich-input"]) {
        const page = await browser.newPage({ viewport: { width, height: 850 } })
        const errors = []
        page.on("pageerror", error => errors.push(error.message))
        await page.goto(origin + (scenario === "rich-input" ? "?rich" : ""))
        await page.waitForFunction(() => window.queueTest?.requests.length === 1)
        const count = scenario === "single" ? 1 : scenario === "same-text" ? 3 : 2
        for (let i = 0; i < count; i++) {
          await page.locator("textarea").first().fill(scenario === "same-text" ? "same text" : `input-${i}`)
          await page.locator("textarea").first().press("Enter")
        }
        await page.waitForFunction(count => queueTest.submissions.length === count, count)
        assert.equal(await page.evaluate(() => queueTest.submissions.every(s => typeof s.options.messageUid === "string")), true, "the real send contract must forward identity")
        if (scenario === "stale-list") {
          await page.evaluate(() => queueTest.submissions.forEach((s, i) => s.resolve({
            disposition: "delivered", item: queueTest.snapshot("delivered").items[i],
          })))
          await page.waitForFunction(() => queueTest.read().every(m => m.remoteState === "delivered"))
          await page.evaluate(() => queueTest.requests.shift()(queueTest.snapshot("pending")))
          await page.waitForFunction(() => queueTest.requests.length === 1)
          assert.deepEqual(await page.evaluate(() => queueTest.read().map(m => m.remoteState)), ["delivered", "delivered"])
        }
        if (scenario === "late-admission") {
          await page.evaluate(() => queueTest.requests.shift()(queueTest.snapshot("delivered")))
          await page.waitForFunction(() => queueTest.read().every(m => m.remoteState === "delivered"))
          await page.evaluate(() => queueTest.submissions[1].resolve({ disposition: "queued", item: queueTest.snapshot("pending").items[1] }))
          await page.waitForFunction(() => queueTest.requests.length === 1)
          assert.deepEqual(await page.evaluate(() => queueTest.read().map(m => m.remoteState)), ["delivered", "delivered"])
        }
        if (scenario === "opaque-batch") await page.evaluate(() => queueTest.listeners.forEach(listener => listener()))
        await page.evaluate(count => queueTest.canonical(count), scenario === "same-text" ? 2 : count)
        await page.waitForFunction(() => document.querySelectorAll("[data-chat-user-bubble]").length > 0)
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        const outgoing = await page.locator('[data-slot="outgoing-message"], [data-slot="queued-message"]').count()
        assert.equal(outgoing, scenario === "same-text" ? 1 : 0, `${scenario} at ${width}px: duplicate outgoing bubble`)
        assert.equal(await page.locator("[data-chat-user-bubble]").count(), 1 + outgoing, `${scenario}: canonical user record`)
        await page.evaluate(() => queueTest.remount())
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        assert.equal(await page.locator('[data-slot="outgoing-message"], [data-slot="queued-message"]').count(), outgoing, "reopen must preserve presentation")
        assert.deepEqual(errors, [], `${scenario}: browser exceptions`)
        results.push({ scenario, width, passed: true })
        await page.close()
      }
    }
  } finally {
    await browser?.close()
    await server.close()
  }
  fs.writeFileSync(path.join(scratch, "queue-ui-results.json"), JSON.stringify(results, null, 2))
  console.log(`${results.length} mounted queue presentation cases passed`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
