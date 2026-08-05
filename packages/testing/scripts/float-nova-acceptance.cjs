const fs = require("node:fs")
const path = require("node:path")
const { chromium, devices } = require("playwright")
const { BrowserSessionStore } = require("./browser-session.cjs")

const storeDir = "C:/Users/laure/AppData/Local/RedLeaf/agents/nova/temp/browser-state"
const outputDir = "C:/Users/laure/AppData/Local/RedLeaf/agents/nova/temp/float-nova-acceptance"
const baseUrl = "http://127.0.0.1:18804"
const headless = process.env.FLOAT_NOVA_HEADLESS !== "0"

fs.mkdirSync(outputDir, { recursive: true })

async function waitForSurface(page, expected, timeout = 5000) {
  await page.waitForFunction(
    ([id, state]) => window.__redbamboo_surfaces?.find((surface) => surface.id === id)?.state === state,
    ["nova:floating-chat", expected],
    { timeout },
  )
}

async function main() {
  const report = { headless, desktop: {}, mobile: {}, consoleErrors: [], pageErrors: [], failedResponses: [] }
  const store = new BrowserSessionStore(storeDir)
  const browser = await chromium.launch({ headless })

  try {
    const context = await store.createContext(browser, "redleaf-18804", {
      viewport: { width: 1440, height: 900 },
      recordVideo: { dir: outputDir, size: { width: 1440, height: 900 } },
    })
    const page = await context.newPage()
    page.on("console", (message) => {
      if (message.type() === "error") report.consoleErrors.push(message.text())
    })
    page.on("pageerror", (error) => report.pageErrors.push(error.message))
    page.on("response", (response) => {
      if (response.status() >= 400) report.failedResponses.push({ status: response.status(), url: response.url() })
    })

    await page.goto(`${baseUrl}/apps/nova/chat`, { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(4000)
    report.desktop.url = page.url()
    report.desktop.title = await page.title()
    report.desktop.body = (await page.locator("body").innerText()).slice(0, 300)
    report.desktop.documentPictureInPicture = await page.evaluate(() => "documentPictureInPicture" in window)
    report.desktop.surface = await page.evaluate(() => window.__redbamboo_surfaces?.find((surface) => surface.id === "nova:floating-chat") ?? null)
    report.desktop.command = await page.evaluate(() => window.__redbamboo_commands?.find((command) => command.id === "nova:float-chat") ?? null)
    report.desktop.userActivationBeforeProgrammaticOpen = await page.evaluate(() => ({
      active: navigator.userActivation?.isActive ?? null,
      hasBeenActive: navigator.userActivation?.hasBeenActive ?? null,
    }))
    report.desktop.programmaticOpen = await page.evaluate(() => window.__redbamboo_runSurfaceAction?.("nova:floating-chat", "open"))
    if (report.desktop.programmaticOpen?.ok) {
      await page.evaluate(() => window.__redbamboo_runSurfaceAction("nova:floating-chat", "close"))
      await waitForSurface(page, "closed")
    }

    await page.goto(`${baseUrl}/apps/nova/chat/3efec7d8`, { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(2500)
    report.desktop.triggerCount = await page.locator('[data-slot="floating-surface-trigger"][data-ui-surface="nova:floating-chat"][data-ui-action="open"]').count()
    report.desktop.headerActions = await page.locator('button[title="Share conversation"], button[title^="Float Nova"]').evaluateAll((buttons) =>
      buttons.map((button) => ({
        title: button.getAttribute("title"),
        text: button.textContent?.trim(),
        width: button.getBoundingClientRect().width,
        height: button.getBoundingClientRect().height,
      })),
    )

    if (report.desktop.documentPictureInPicture && report.desktop.triggerCount === 1) {
      await page.locator('[data-slot="floating-surface-trigger"][data-ui-surface="nova:floating-chat"][data-ui-action="open"]').click()
      await waitForSurface(page, "open")
      const pipPage = context.pages().find((candidate) => candidate !== page)
      if (!pipPage) throw new Error("Document Picture-in-Picture target was not exposed to Playwright")
      await pipPage.setViewportSize({ width: 420, height: 700 })
      await pipPage.waitForSelector('[data-slot="floating-surface-root"]')
      await pipPage.waitForSelector('[data-ui-action="dock"]', { timeout: 15000 })
      report.desktop.transcriptLoaded = await pipPage.waitForFunction(() => {
        const panel = document.querySelector('[data-slot="chat-panel"]')
        return (panel?.textContent?.trim().length ?? 0) > 100
      }, undefined, { timeout: 15000 })
        .then(() => true)
        .catch(() => false)
      report.desktop.ambienceLoaded = await pipPage
        .locator('[data-slot="ambience-layer"][data-ambience-target="nova"]')
        .waitFor({ timeout: 15000 })
        .then(() => true)
        .catch(() => false)
      report.desktop.spinnerCountAfterTranscriptWait = await pipPage.locator('.animate-spin').count()
      report.desktop.open = await page.evaluate(() => {
        const pip = documentPictureInPicture.window
        const root = pip?.document.querySelector('[data-slot="floating-surface-root"]')
        const text = pip?.document.body.innerText ?? ""
        return {
          state: window.__redbamboo_surfaces?.find((surface) => surface.id === "nova:floating-chat")?.state,
          root: root ? {
            surface: root.getAttribute("data-ui-surface"),
            view: root.getAttribute("data-view"),
            discussionId: root.getAttribute("data-discussion-id"),
          } : null,
          compactTabs: [...(pip?.document.querySelectorAll('[data-slot="tabs-trigger"]') ?? [])].map((tab) => tab.textContent?.trim()),
          compactAvatarCount: pip?.document.querySelectorAll('[data-slot="floating-surface-avatar"]').length ?? 0,
          compactAvatarRect: (() => {
            const avatar = pip?.document.querySelector('[data-slot="floating-surface-avatar"]')
            if (!avatar) return null
            const rect = avatar.getBoundingClientRect()
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          })(),
          compactHeaderOrder: [...(pip?.document.querySelector('[data-slot="tabs-list"]')?.children ?? [])].map((child) =>
            child.getAttribute("data-slot") === "tabs-trigger" ? child.textContent?.trim() : child.getAttribute("data-slot"),
          ),
          dockCount: pip?.document.querySelectorAll('[data-ui-action="dock"]').length ?? 0,
          ambience: (() => {
            const layer = pip?.document.querySelector('[data-slot="ambience-layer"]')
            return layer ? {
              target: layer.getAttribute("data-ambience-target"),
              imageCount: layer.querySelectorAll("img").length,
            } : null
          })(),
          dimensions: pip ? { width: pip.innerWidth, height: pip.innerHeight } : null,
        }
      })
      report.desktop.contextPagesAfterOpen = context.pages().map((candidate) => ({ url: candidate.url(), isMain: candidate === page }))
      await pipPage.screenshot({ path: path.join(outputDir, "00a-float-chat.png"), fullPage: true })

      report.desktop.sessionInfo = {}
      const sessionInfoTrigger = pipPage.locator('button[title^="Context:"], button[title="Session info"]').first()
      report.desktop.sessionInfo.triggerFound = await sessionInfoTrigger.count() === 1
      if (report.desktop.sessionInfo.triggerFound) {
        for (const target of [
          { name: "wide", width: 760, height: 1100 },
          { name: "compact", width: 420, height: 700 },
        ]) {
          await pipPage.setViewportSize({ width: target.width, height: target.height })
          await sessionInfoTrigger.click()
          const dialog = pipPage.locator('[data-slot="dialog-content"]')
          const scroll = pipPage.locator('[data-slot="session-stats-scroll"]')
          await dialog.waitFor()
          const metrics = await dialog.evaluate((element) => {
            const dialogRect = element.getBoundingClientRect()
            const scrollElement = element.querySelector('[data-slot="session-stats-scroll"]')
            const entity = element.querySelector('[data-slot="entity-card"]')
            const entityRect = entity?.getBoundingClientRect()
            return {
              dialog: {
                width: dialogRect.width,
                height: dialogRect.height,
                top: dialogRect.top,
                bottom: dialogRect.bottom,
                maxWidth: getComputedStyle(element).maxWidth,
              },
              scroll: scrollElement ? {
                clientHeight: scrollElement.clientHeight,
                scrollHeight: scrollElement.scrollHeight,
                overflowY: getComputedStyle(scrollElement).overflowY,
              } : null,
              entity: entityRect ? { width: entityRect.width, height: entityRect.height } : null,
            }
          })
          await pipPage.screenshot({ path: path.join(outputDir, `00d-session-info-${target.name}-top.png`), fullPage: true })
          metrics.overflowProbe = await scroll.evaluate((element) => {
            const probe = element.ownerDocument.createElement("div")
            probe.style.height = "1000px"
            probe.style.flex = "0 0 1000px"
            element.firstElementChild?.append(probe)
            const entity = element.querySelector('[data-slot="entity-card"]')
            const entityHeight = entity?.getBoundingClientRect().height ?? null
            const clientHeight = element.clientHeight
            const scrollHeight = element.scrollHeight
            element.scrollTop = scrollHeight
            const scrollTop = element.scrollTop
            probe.remove()
            element.scrollTop = 0
            return { clientHeight, scrollHeight, scrollTop, entityHeight }
          })
          report.desktop.sessionInfo[target.name] = metrics
          await pipPage.keyboard.press("Escape")
          await dialog.waitFor({ state: "detached" })
        }
        await pipPage.setViewportSize({ width: 420, height: 700 })
      }

      const floatingRoot = pipPage.locator('[data-slot="floating-surface-root"]')
      report.desktop.shortcuts = {
        declared: await floatingRoot.getAttribute("data-ui-shortcuts"),
        initialDiscussionId: await floatingRoot.getAttribute("data-discussion-id"),
      }
      await pipPage.keyboard.press("Alt+ArrowLeft")
      await pipPage.waitForFunction(() => document.querySelector('[data-slot="floating-surface-root"]')?.getAttribute("data-view") === "discussions")
      report.desktop.shortcuts.afterShowDiscussions = await floatingRoot.getAttribute("data-view")
      await pipPage.keyboard.press("Alt+ArrowRight")
      await pipPage.waitForFunction(() => document.querySelector('[data-slot="floating-surface-root"]')?.getAttribute("data-view") === "chat")
      report.desktop.shortcuts.afterShowChat = await floatingRoot.getAttribute("data-view")

      const initialShortcutDiscussion = report.desktop.shortcuts.initialDiscussionId
      await pipPage.keyboard.press("Alt+ArrowDown")
      await pipPage.waitForFunction(
        (initial) => document.querySelector('[data-slot="floating-surface-root"]')?.getAttribute("data-discussion-id") !== initial,
        initialShortcutDiscussion,
      )
      report.desktop.shortcuts.afterNextDiscussion = await floatingRoot.getAttribute("data-discussion-id")
      await pipPage.keyboard.press("Alt+ArrowUp")
      if (initialShortcutDiscussion) {
        await pipPage.waitForFunction(
          (initial) => document.querySelector('[data-slot="floating-surface-root"]')?.getAttribute("data-discussion-id") === initial,
          initialShortcutDiscussion,
        )
      }
      report.desktop.shortcuts.afterPreviousDiscussion = await floatingRoot.getAttribute("data-discussion-id")

      report.desktop.shortcuts.runtimeShowDiscussions = await page.evaluate(() =>
        window.__redbamboo_runSurfaceAction("nova:floating-chat", "show-discussions"),
      )
      await pipPage.waitForFunction(() => document.querySelector('[data-slot="floating-surface-root"]')?.getAttribute("data-view") === "discussions")
      report.desktop.shortcuts.runtimeShowChat = await page.evaluate(() =>
        window.__redbamboo_runSurfaceAction("nova:floating-chat", "show-chat"),
      )
      await pipPage.waitForFunction(() => document.querySelector('[data-slot="floating-surface-root"]')?.getAttribute("data-view") === "chat")

      await pipPage.keyboard.press("Alt+N")
      await pipPage.getByText("New Discussion", { exact: true }).waitFor()
      report.desktop.shortcuts.altNPickerCount = await pipPage.getByText("New Discussion", { exact: true }).count()
      report.desktop.shortcuts.contextPagesAfterAltN = context.pages().length
      const shortcutCancel = pipPage.getByText("Cancel", { exact: true })
      if (await shortcutCancel.count()) await shortcutCancel.click()

      await pipPage.getByText("Discussions", { exact: true }).click()
      await pipPage.waitForTimeout(500)
      await pipPage.screenshot({ path: path.join(outputDir, "00b-float-discussions.png"), fullPage: true })
      const newButton = pipPage.locator("button").filter({ hasText: /^New$/ }).first()
      report.desktop.dialog = { newButtonFound: await newButton.count() === 1 }
      if (report.desktop.dialog.newButtonFound) {
        await newButton.click()
        await pipPage.getByText("New Discussion", { exact: true }).waitFor()
        report.desktop.dialog.pipPickerCount = await pipPage.getByText("New Discussion", { exact: true }).count()
        report.desktop.dialog.openerPickerCount = await page.getByText("New Discussion", { exact: true }).count()
        const pickerOverlay = pipPage.getByText("New Discussion", { exact: true })
          .locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " fixed ")][1]')
        const dropdownTrigger = pickerOverlay.locator('[data-slot="dropdown-menu-trigger"]').first()
        report.desktop.dialog.dropdownTriggerFound = await dropdownTrigger.waitFor({ timeout: 10000 })
          .then(() => true)
          .catch(() => false)
        if (report.desktop.dialog.dropdownTriggerFound) {
          await dropdownTrigger.click()
          await pipPage.locator('[data-slot="dropdown-menu-content"]').waitFor()
          report.desktop.dialog.pipDropdownCount = await pipPage.locator('[data-slot="dropdown-menu-content"]').count()
          report.desktop.dialog.openerDropdownCount = await page.locator('[data-slot="dropdown-menu-content"]').count()
        }
        await pipPage.screenshot({ path: path.join(outputDir, "00c-float-dialog.png"), fullPage: true })
        await pipPage.keyboard.press("Escape")
        const cancelButton = pipPage.getByText("Cancel", { exact: true })
        if (await cancelButton.count()) await cancelButton.click()
      }
      await pipPage.getByText("Chat", { exact: true }).click()

      const codeRedCommand = await page.evaluate(() => window.__redbamboo_commands?.find((command) =>
        command.source?.id === "codered" && command.group === "Navigate",
      ) ?? null)
      report.desktop.codeRedCommand = codeRedCommand
      if (codeRedCommand) {
        await page.evaluate((id) => window.__redbamboo_runCommand?.(id), codeRedCommand.id)
        await page.waitForTimeout(1500)
        report.desktop.afterCodeRed = await page.evaluate(() => ({
          url: location.href,
          surface: window.__redbamboo_surfaces?.find((surface) => surface.id === "nova:floating-chat"),
          pipRoot: documentPictureInPicture.window?.document.querySelector('[data-slot="floating-surface-root"]')?.getAttribute("data-ui-surface") ?? null,
          mainAmbienceTarget: document.querySelector('[data-slot="ambience-layer"]')?.getAttribute("data-ambience-target") ?? null,
          pipAmbienceTarget: documentPictureInPicture.window?.document.querySelector('[data-slot="ambience-layer"]')?.getAttribute("data-ambience-target") ?? null,
        }))
        await page.screenshot({ path: path.join(outputDir, "01-codered-with-float.png"), fullPage: true })
      }

      await page.evaluate(() => {
        const pip = documentPictureInPicture.window
        const dock = pip?.document.querySelector('[data-ui-action="dock"]')
        dock?.click()
      })
      await waitForSurface(page, "closed")
      await page.waitForTimeout(500)
      report.desktop.afterDock = { url: page.url(), surface: await page.evaluate(() => window.__redbamboo_surfaces?.find((surface) => surface.id === "nova:floating-chat")) }

      await page.keyboard.press("Control+Alt+N")
      await waitForSurface(page, "open")
      await page.keyboard.press("Control+Alt+N")
      await page.waitForTimeout(300)
      report.desktop.afterShortcutTwice = await page.evaluate(() => ({
        state: window.__redbamboo_surfaces?.find((surface) => surface.id === "nova:floating-chat")?.state,
        rootCount: documentPictureInPicture.window?.document.querySelectorAll('[data-slot="floating-surface-root"]').length ?? 0,
      }))
      await page.evaluate(() => window.__redbamboo_runSurfaceAction("nova:floating-chat", "close"))
      await waitForSurface(page, "closed")
    }

    await store.save(context, "redleaf-18804")
    const videoPath = await page.video().path()
    await context.close()
    report.desktop.video = videoPath

    const mobileContext = await browser.newContext({ ...devices["iPhone 13"] })
    const mobilePage = await mobileContext.newPage()
    await mobilePage.goto(`${baseUrl}/apps/nova/chat`, { waitUntil: "domcontentloaded" })
    await mobilePage.waitForTimeout(3500)
    report.mobile.url = mobilePage.url()
    report.mobile.surface = await mobilePage.evaluate(() => window.__redbamboo_surfaces?.find((surface) => surface.id === "nova:floating-chat") ?? null)
    report.mobile.command = await mobilePage.evaluate(() => window.__redbamboo_commands?.find((command) => command.id === "nova:float-chat") ?? null)
    report.mobile.triggerCount = await mobilePage.locator('[data-slot="floating-surface-trigger"]').count()
    report.mobile.bodyHasFloatNova = (await mobilePage.locator("body").innerText()).includes("Float Nova")
    await mobileContext.close()

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error.stack || error.message)
  process.exit(1)
})
