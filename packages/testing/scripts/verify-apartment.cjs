const { chromium } = require('playwright')

const OUT = 'C:/Users/laure/AppData/Local/RedLeaf/agents/nova/screenshots'
const LABEL = process.argv[2] || 'apartment'

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1200, height: 1400 } })
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

  await page.goto('http://127.0.0.1:18804/apps/coaching/today', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4500)

  // The map only mounts when the Apartment nav item is active.
  const nav = page.locator('button, a').filter({ hasText: /^Apartment$/ }).first()
  if (await nav.count()) {
    await nav.click()
    await page.waitForTimeout(2500)
  } else {
    console.log('WARN: Apartment nav item not found')
  }

  // The map is the section headed by an h2 reading exactly "Apartment".
  const section = page.locator('section').filter({
    has: page.locator('h2', { hasText: /^Apartment$/ }),
  }).first()

  const found = await section.count()
  console.log('apartment map section found:', found > 0)

  if (found) {
    await section.scrollIntoViewIfNeeded()
    await page.waitForTimeout(600)
    const text = (await section.innerText()).replace(/\n+/g, ' | ')
    console.log('section text:', text.slice(0, 600))
    await section.screenshot({ path: `${OUT}/${LABEL}.png` })
  }

  if (errors.length) {
    console.log('--- console errors ---')
    errors.slice(0, 5).forEach((e) => console.log('  ' + e))
  } else {
    console.log('no console errors')
  }

  await browser.close()
})().catch((e) => {
  console.error('ERR', e.message)
  process.exit(1)
})
