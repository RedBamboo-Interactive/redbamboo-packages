const { chromium } = require('playwright')

const OUT = 'C:/Users/laure/AppData/Local/RedLeaf/agents/nova/screenshots'

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 900, height: 1800 } })
  await page.goto('http://127.0.0.1:18804/entities', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)

  await page.locator('button').filter({ hasText: /System/i }).last().click()
  await page.waitForTimeout(1500)

  const txt = await page.evaluate(() => document.body.innerText)
  const i = txt.indexOf('SYSTEM')
  console.log('--- SYSTEM section ---')
  console.log(txt.slice(i, i + 700))

  // Locked sections must not expose draggable rows.
  const draggable = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[draggable="true"]')).length
  )
  console.log('draggable rows on page:', draggable)

  await page.screenshot({ path: OUT + '/system_expanded.png', fullPage: false })
  await browser.close()
})().catch((e) => {
  console.error('ERR', e.message)
  process.exit(1)
})
