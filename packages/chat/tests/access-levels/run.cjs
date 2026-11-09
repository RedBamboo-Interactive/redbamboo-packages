const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const os = require("node:os")
const { pathToFileURL } = require("node:url")
const { chromium } = require(require.resolve("playwright", { paths: [path.resolve(__dirname, "../../../testing")] }))

// Mounted shared-Chat fixture for access levels: the Info modal's Permissions row and the Info
// button's Full tint, and the approval card on a tool call through its whole lifecycle. Phone
// width (390 px) first, since that is where Laurent mostly reads the chat.
const DESCRIPTIONS = {
  plan: "Reads and plans, changes nothing.",
  ask: "Edits files in the project, asks before anything else.",
  auto: "A safety check approves routine actions and blocks risky ones.",
  full: "Runs everything without asking.",
}

async function main() {
  const packageRoot = path.resolve(__dirname, "../..")
  const scratch = process.env.REDLEAF_SCRATCH_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "chat-access-levels-"))
  const shots = path.join(scratch, "chat-access-levels")
  fs.mkdirSync(shots, { recursive: true })
  const { createServer } = await import(pathToFileURL(require.resolve("vite")))
  const tailwind = (await import(pathToFileURL(require.resolve("@tailwindcss/vite", { paths: [path.resolve(packageRoot, "../ui")] })))).default
  const server = await createServer({ configFile: false, root: __dirname, plugins: [tailwind()],
    cacheDir: path.join(scratch, "access-levels-vite-cache"),
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

    const open = async (query, { phone = true } = {}) => {
      const context = await browser.newContext({
        viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        isMobile: phone,
        hasTouch: phone,
      })
      const page = await context.newPage()
      const errors = []
      page.on("pageerror", error => errors.push(error.message))
      await page.goto(`${origin}?${query}`)
      return { page, errors, close: () => context.close() }
    }
    const shot = (page, name) => page.screenshot({ path: path.join(shots, `${name}.png`) })
    const trigger = page => page.locator('[data-slot="session-info-trigger"]')
    const row = page => page.locator('[data-slot="access-level-row"]')
    const levelButton = (page, level) => row(page).locator(`button[data-value="${level}"]`)
    const description = page => page.locator('[data-slot="access-level-description"]')
    // Nothing in the row may stick out of the dialog at phone width.
    const fitsDialog = async page => page.evaluate(() => {
      const dialog = document.querySelector('[data-slot="dialog-content"]').getBoundingClientRect()
      const items = [...document.querySelectorAll('[data-slot="access-level-row"] *')]
      return items.every(item => {
        const box = item.getBoundingClientRect()
        return box.width === 0 || (box.left >= dialog.left - 0.5 && box.right <= dialog.right + 0.5)
      }) && document.documentElement.scrollWidth <= window.innerWidth
    })
    const openModal = async page => {
      await trigger(page).click()
      await row(page).waitFor()
    }

    // ── The row: supported levels, Full off with its link, the description follows the choice ──
    {
      const { page, errors, close } = await open("view=modal&level=ask&full=off")
      assert.equal(await trigger(page).getAttribute("aria-label"), "Open session info")
      await openModal(page)
      const values = await row(page).locator("button[data-value]").evaluateAll(buttons => buttons.map(button => button.dataset.value))
      assert.deepEqual(values, ["plan", "ask", "auto", "full"])
      assert.equal(await levelButton(page, "ask").getAttribute("aria-pressed"), "true")
      assert.equal(await levelButton(page, "full").isDisabled(), true, "Full is shown but disabled")
      assert.equal(await levelButton(page, "auto").isDisabled(), false)
      assert.equal(await description(page).innerText(), DESCRIPTIONS.ask)
      const link = page.locator('[data-slot="full-access-settings-link"]')
      assert.equal(await link.innerText(), "Enable Full access in Settings")
      assert.equal(await link.getAttribute("href"), "#/settings/agent-permissions")
      assert(await fitsDialog(page), "the row fits a 390 px dialog")
      await shot(page, "01-phone-modal-full-off")

      await levelButton(page, "plan").click()
      await page.waitForFunction(() => document.querySelector('[data-slot="access-level-row"]')?.getAttribute("data-access-level") === "plan"
        && !document.querySelector('[data-slot="access-level-row"] button[data-value="plan"]')?.disabled)
      assert.equal(await levelButton(page, "plan").getAttribute("aria-pressed"), "true")
      assert.equal(await description(page).innerText(), DESCRIPTIONS.plan)
      assert.deepEqual(await page.evaluate(() => window.__changes), [{ accessLevel: "plan" }])
      for (const level of ["auto"]) {
        await levelButton(page, level).click()
        await page.waitForFunction(value => document.querySelector('[data-slot="access-level-row"]')?.getAttribute("data-access-level") === value
          && !document.querySelector('[data-slot="access-level-row"] button[data-value="plan"]')?.disabled, level)
        assert.equal(await description(page).innerText(), DESCRIPTIONS[level])
      }
      assert.deepEqual(errors, [])
      await close()
      check("phone: Permissions row shows the supported levels, Full disabled with its Settings link, description follows the choice")
    }

    // ── Only the provider's levels; levels above the cap disabled ──
    {
      const { page, errors, close } = await open("view=modal&level=ask&supported=ask,full")
      await openModal(page)
      const values = await row(page).locator("button[data-value]").evaluateAll(buttons => buttons.map(button => button.dataset.value))
      assert.deepEqual(values, ["ask", "full"], "only supported levels")
      assert.equal(await levelButton(page, "full").isDisabled(), false, "Full is enabled when the host says so")
      assert.equal(await page.locator('[data-slot="full-access-settings-link"]').count(), 0)
      await close()

      const capped = await open("view=modal&level=ask&cap=ask")
      await openModal(capped.page)
      assert.equal(await levelButton(capped.page, "plan").isDisabled(), false)
      assert.equal(await levelButton(capped.page, "ask").isDisabled(), false)
      assert.equal(await levelButton(capped.page, "auto").isDisabled(), true, "auto is above the cap")
      assert.equal(await levelButton(capped.page, "full").isDisabled(), true, "full is above the cap")
      assert.match(await levelButton(capped.page, "auto").getAttribute("title"), /limit this session was started with/)
      await shot(capped.page, "02-phone-modal-capped")
      assert.deepEqual([...errors, ...capped.errors], [])
      await capped.close()
      check("only supported levels are offered and levels above the session cap are disabled")
    }

    // ── A refused change keeps the previous level and says why ──
    {
      const { page, errors, close } = await open("view=modal&level=ask&refuse=1")
      await openModal(page)
      await levelButton(page, "auto").click()
      const alert = page.locator('[data-slot="access-level-error"]')
      await alert.waitFor()
      assert.equal(await alert.innerText(), "Raising the access level needs you to be present.")
      assert.equal(await levelButton(page, "ask").getAttribute("aria-pressed"), "true", "the previous selection stays")
      assert.equal(await description(page).innerText(), DESCRIPTIONS.ask)
      assert(await fitsDialog(page))
      await shot(page, "03-phone-modal-refused")
      assert.deepEqual(errors, [])
      await close()
      check("a refused change shows the server's words inline and keeps the previous selection")
    }

    // ── The Info button on Full ──
    {
      const { page, errors, close } = await open("view=modal&level=full")
      assert.equal(await trigger(page).getAttribute("aria-label"), "Open session info. Full access is on")
      assert.equal(await trigger(page).locator("i").getAttribute("class"), "ph-bold ph-shield-warning text-sm")
      const color = await trigger(page).evaluate(element => getComputedStyle(element).color)
      const neutral = await (async () => {
        const other = await open("view=modal&level=ask")
        const value = await trigger(other.page).evaluate(element => getComputedStyle(element).color)
        await other.close()
        return value
      })()
      assert.notEqual(color, neutral, "the Full button is tinted")
      assert.match(color, /oklch|rgb/)
      await shot(page, "04-phone-info-button-full")
      await openModal(page)
      assert.equal(await description(page).innerText(), DESCRIPTIONS.full)
      assert.deepEqual(errors, [])
      await close()
      check("Info button turns amber with a shield and says Full access is on")
    }

    // ── The approval card on its tool call, through resolution and the tool result ──
    {
      const { page, errors, close } = await open("view=chat&scenario=permission")
      const card = page.locator('[data-slot="permission-approval-card"]')
      await card.waitFor()
      assert.equal(await card.getAttribute("data-outcome"), "pending")
      assert.equal(await card.getAttribute("data-tool-use-id"), "toolu_bash")
      assert((await card.innerText()).includes("Waiting for your approval"))
      assert((await card.locator('[data-slot="permission-approval-summary"]').innerText()).startsWith("git clean -fdx"))
      const labels = await card.locator("button").allInnerTexts()
      assert.deepEqual(labels.map(label => label.trim()), ["Allow once", "Allow for this session", "Deny"])
      assert.equal(await page.locator('[data-awaiting-approval][data-tool-use-id="toolu_bash"]').count(), 1, "the tool square is ringed")
      assert.equal(await page.locator('[data-slot="question-card"]').count(), 0, "no question card for an approval")
      assert.equal(await page.locator('[data-slot="pending-question-line"]').getAttribute("data-kind"), "permission")
      assert.notEqual(await page.locator("textarea").getAttribute("placeholder"), "Type your answer here...", "typing is a message, not an answer")
      const fits = await card.evaluate(element => {
        const box = element.getBoundingClientRect()
        return box.left >= 0 && box.right <= window.innerWidth && document.documentElement.scrollWidth <= window.innerWidth
      })
      assert(fits, "the card fits a 390 px screen")
      await shot(page, "05-phone-approval-pending")

      await card.getByRole("button", { name: "Allow for this session" }).click()
      await page.waitForFunction(() => document.querySelector('[data-slot="permission-approval-card"]')?.getAttribute("data-outcome") === "allow_session")
      assert.deepEqual(await page.evaluate(() => window.__decisions), [{ requestId: "req-1", toolUseId: "toolu_bash", decision: "allow_session" }])
      assert((await card.innerText()).includes("Allowed for this session"))
      assert.equal(await page.locator('[data-awaiting-approval]').count(), 0)
      await page.evaluate(() => window.__emit({ type: "tool_result", content: "cleaned", toolResult: "cleaned", messageId: "toolu_bash" }))
      await page.evaluate(() => window.__emit({ type: "text", content: "Done.", messageId: "msg-2" }))
      assert.equal(await card.getAttribute("data-outcome"), "allow_session", "the outcome stays after the tool result")
      await shot(page, "06-phone-approval-resolved")
      await page.evaluate(() => window.__emit({ type: "status", content: "idle" }))
      assert.equal(await card.getAttribute("data-outcome"), "allow_session", "and after the turn ends")
      assert.deepEqual(errors, [])
      await close()
      check("phone: approval card on its tool call, decided, outcome kept through tool result and turn end")
    }

    // ── A refused decision keeps the buttons and says why ──
    {
      const { page, errors, close } = await open("view=chat&scenario=permission&refuseDecision=1")
      const card = page.locator('[data-slot="permission-approval-card"]')
      await card.waitFor()
      await card.getByRole("button", { name: "Allow once" }).click()
      await card.getByRole("alert").waitFor()
      assert.equal(await card.getByRole("alert").innerText(), "Approving needs you to be present.")
      assert.equal(await card.getAttribute("data-outcome"), "pending")
      assert.equal(await card.getByRole("button", { name: "Deny" }).isEnabled(), true)
      await card.getByRole("button", { name: "Deny" }).click()
      await page.waitForFunction(() => document.querySelector('[data-slot="permission-approval-card"]')?.getAttribute("data-outcome") === "deny")
      assert((await card.innerText()).includes("Denied"))
      await shot(page, "07-phone-approval-refused-then-denied")
      assert.deepEqual(errors, [])
      await close()
      check("a refused decision shows the server's words and keeps the buttons")
    }

    // ── No tool call to sit on: the standalone card ──
    {
      const { page, errors, close } = await open("view=chat&scenario=unanchored")
      const card = page.locator('[data-slot="permission-approval-card"]')
      await card.waitFor()
      assert.equal(await card.count(), 1)
      assert.equal(await card.getAttribute("data-outcome"), "pending")
      assert.equal(await card.getByRole("button", { name: "Allow once" }).count(), 1)
      await shot(page, "08-phone-approval-unanchored")
      assert.deepEqual(errors, [])
      await close()
      check("an approval with no matching tool call falls back to a standalone card")
    }

    // ── A question without kind is still an AskUserQuestion card ──
    {
      const { page, errors, close } = await open("view=chat&scenario=ask")
      // Pre-existing, unchanged here: every row of the last assistant message (its text row and
      // its activity row) draws the live question card, so a turn with text before the ask shows two.
      const card = page.locator('[data-slot="question-card"]')
      await card.first().waitFor()
      assert.deepEqual(await card.evaluateAll(cards => cards.map(c => c.dataset.status)).then(s => [...new Set(s)]), ["pending"])
      assert.equal(await page.locator('[data-slot="permission-approval-card"]').count(), 0)
      assert.equal(await page.locator('[data-slot="pending-question-line"]').getAttribute("data-kind"), "question")
      assert.equal(await page.locator("textarea").getAttribute("placeholder"), "Type your answer here...")
      await shot(page, "09-phone-ask-question")
      assert.deepEqual(errors, [])
      await close()
      check("a question without kind still renders the AskUserQuestion card and composer answer")
    }

    // ── Desktop sanity ──
    {
      const { page, errors, close } = await open("view=chat&scenario=permission", { phone: false })
      await page.locator('[data-slot="permission-approval-card"]').waitFor()
      await shot(page, "10-desktop-approval-pending")
      const modal = await open("view=modal&level=ask&full=off", { phone: false })
      await openModal(modal.page)
      await shot(modal.page, "11-desktop-modal")
      assert.deepEqual([...errors, ...modal.errors], [])
      await modal.close()
      await close()
      check("desktop: card and modal render")
    }
  } finally {
    await browser?.close()
    await server.close()
  }
  fs.writeFileSync(path.join(shots, "results.json"), JSON.stringify(checks, null, 2))
  console.log(`${checks.length} access-level checks passed; screenshots in ${shots}`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
