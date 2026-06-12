// Click-through check: list row -> entity detail for migrated data.
import { chromium } from 'playwright'

const BASE = 'http://127.0.0.1:18804'
const errors = []

async function run() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  page.on('pageerror', err => errors.push(`[pageerror] ${err.message}`))
  page.on('console', msg => { if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`) })

  await page.goto(`${BASE}/entities/ai-session`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)

  // Rows are click-handled, not anchors — click the first instance row text.
  const row = page.getByText('nova (opencode)').first()
  await row.click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: 'screenshots-verify/migration-06-session-detail.png' })
  console.log('after click url:', page.url())
  const body = await page.locator('body').innerText()
  console.log('detail shows provider field:', /provider/i.test(body) ? 'YES' : 'NO')
  console.log('detail shows token fields:', /token/i.test(body) ? 'YES' : 'NO')

  // Discussion detail via direct entity route
  await page.goto(`${BASE}/entities/discussion`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: 'screenshots-verify/migration-07-discussions.png' })

  await browser.close()
  console.log('errors:', errors.length)
  for (const e of errors.slice(0, 5)) console.log(' ', e.slice(0, 180))
}

run().catch(e => { console.error(e); process.exit(1) })
