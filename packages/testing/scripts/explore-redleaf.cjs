const { chromium } = require('playwright')
const path = require('path')
const fs = require('fs')

const PORT = 18904
const BASE = `http://localhost:${PORT}`
const SCREENSHOTS = path.join(__dirname, '..', 'screenshots')
const TIMEOUT = 15000

fs.mkdirSync(SCREENSHOTS, { recursive: true })

const ts = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')
let step = 0

function shot(name) {
  step++
  const num = String(step).padStart(2, '0')
  return path.join(SCREENSHOTS, `${ts}_${num}-${name}.png`)
}

function slug(text) {
  return (text || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  page.setDefaultTimeout(TIMEOUT)

  try {
    // --- Workspace ---
    console.log('workspace...')
    await page.goto(BASE)
    await page.waitForLoadState('networkidle')
    await page.screenshot({ path: shot('workspace'), fullPage: true })

    // --- Each project card (buttons containing an h3 title) ---
    const cards = page.locator('button:has(h3)')
    const cardCount = await cards.count()
    const titles = []
    for (let i = 0; i < cardCount; i++) {
      titles.push(await cards.nth(i).locator('h3').textContent())
    }
    console.log(`  ${titles.length} project cards`)

    for (const title of titles) {
      const card = page.locator('button:has(h3)', { hasText: title })
      await card.waitFor()
      await card.click()
      await page.waitForLoadState('networkidle')
      await page.screenshot({ path: shot(`project-${slug(title)}`), fullPage: true })
      console.log(`  project: ${title}`)

      await page.goto(BASE)
      await page.waitForLoadState('networkidle')
    }

    // --- Entities tab ---
    console.log('entities...')
    await page.locator('nav button', { hasText: 'Entities' }).click()
    await page.waitForLoadState('networkidle')
    await page.screenshot({ path: shot('entities'), fullPage: true })

    // --- Each entity type ---
    const entityRows = page.locator('[data-slot="master-detail-sidebar"] [data-slot="item-list-row"]')
    const entityCount = await entityRows.count()
    console.log(`  ${entityCount} entity types`)

    for (let i = 0; i < entityCount; i++) {
      const title = await entityRows.nth(i).locator('[data-slot="item-list-title"]').textContent()
      await entityRows.nth(i).click()
      await page.waitForLoadState('networkidle')
      await page.screenshot({ path: shot(`instances-${slug(title)}`), fullPage: true })
      console.log(`  instances: ${title}`)

      // Schema sub-tab (exact match to avoid hitting content that mentions "Schema")
      const content = page.locator('[data-slot="master-detail-content"]')
      const schemaBtn = content.getByRole('button', { name: 'Schema', exact: true })
      if (await schemaBtn.count() > 0) {
        await schemaBtn.click()
        await page.waitForLoadState('networkidle')
        await page.screenshot({ path: shot(`schema-${slug(title)}`), fullPage: true })
        console.log(`  schema: ${title}`)

        const instancesBtn = content.getByRole('button', { name: 'Instances', exact: true })
        if (await instancesBtn.count() > 0) {
          await instancesBtn.click()
          await page.waitForLoadState('networkidle')
        }
      }
    }

    // --- Hamburger menu ---
    console.log('menu...')
    await page.locator('button:has(i.fa-bars)').click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: shot('menu'), fullPage: true })

    // --- Settings modal ---
    console.log('settings...')
    const settingsItem = page.locator('[data-slot="dropdown-menu-item"]', { hasText: 'Settings' })
    if (await settingsItem.count() > 0) {
      await settingsItem.click()
      await page.waitForTimeout(500)
      await page.screenshot({ path: shot('settings'), fullPage: true })
    } else {
      await page.keyboard.press('Escape')
    }

    console.log(`\ndone — ${step} screenshots in screenshots/`)
  } finally {
    await browser.close()
  }
}

main().catch(err => {
  console.error('explore failed:', err)
  process.exit(1)
})
