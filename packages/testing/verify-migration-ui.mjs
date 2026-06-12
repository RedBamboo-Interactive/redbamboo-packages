// Validates the RedLeaf UI after the suite data migration:
// the new entity types render, migrated entities list and open, and the
// console stays clean. Screenshots land in screenshots-verify/.
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const BASE = 'http://127.0.0.1:18804'
const OUT = 'screenshots-verify'
mkdirSync(OUT, { recursive: true })

const errors = []

async function run() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  page.on('pageerror', err => errors.push(`[pageerror] ${err.message}`))
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`)
  })

  // 1. Entity type browser for ai-session (migrated from RedCompute plugins)
  await page.goto(`${BASE}/entities/ai-session`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/migration-01-ai-sessions.png` })
  const sessionBody = await page.locator('body').innerText()
  console.log('ai-session list mentions sessions:', /session|claude|opencode/i.test(sessionBody) ? 'YES' : 'NO')

  // 2. Open the first entity in the list (click first row/card link if present)
  const firstEntity = page.locator('a[href*="/entities/ai-session/"]').first()
  if (await firstEntity.count() > 0) {
    await firstEntity.click()
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${OUT}/migration-02-session-detail.png` })
    console.log('opened session detail:', page.url())
  } else {
    console.log('no entity links found on ai-session list page')
  }

  // 3. Discussions (migrated from Nova)
  await page.goto(`${BASE}/entities/discussion`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/migration-03-discussions.png` })

  // 4. Agent files (versioned identity entities)
  await page.goto(`${BASE}/entities/agent-file`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/migration-04-agent-files.png` })

  // 5. Streams registry
  await page.goto(`${BASE}/entities/stream`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/migration-05-streams.png` })

  await browser.close()

  console.log('\nconsole/page errors:', errors.length)
  for (const e of errors.slice(0, 8)) console.log(' ', e.slice(0, 200))
}

run().catch(e => { console.error(e); process.exit(1) })
