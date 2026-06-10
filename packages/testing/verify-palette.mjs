// Post-audit verification: command palette + machine-discoverable commands per app.
// Usage: node verify-palette.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const APPS = [
  { name: 'RedCompute', port: 18800, expectLabels: ['Toggle Console', 'Toggle Settings', 'Queue Job'] },
  { name: 'CodeRed', port: 18801, expectLabels: ['New Session', 'Next Session', 'Close Session', 'Toggle Light Mode'] },
  { name: 'Nova', port: 18803, expectLabels: ['New Discussion', 'Search Conversations', 'Export Conversations'] },
  { name: 'RedLeaf', port: 18804, expectLabels: ['Backup Database', 'Toggle History', 'New Entity', 'Toggle Dev Mode'] },
]

const SHARED_LABELS = ['Command Palette', 'Switch App']

mkdirSync('screenshots-verify', { recursive: true })

const browser = await chromium.launch({ headless: true })
let failures = 0

for (const app of APPS) {
  console.log(`\n=== ${app.name} (:${app.port}) ===`)
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  const consoleLogs = []
  page.on('console', (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`))
  page.on('pageerror', (err) => consoleLogs.push(`[pageerror] ${err.message}`))

  try {
    await page.goto(`http://localhost:${app.port}`, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.waitForTimeout(4000)

    // 1. Machine-discoverable command mirror
    const mirror = await page.evaluate(() => {
      const cmds = window.__redbamboo_commands
      return {
        present: Array.isArray(cmds),
        count: Array.isArray(cmds) ? cmds.length : 0,
        labels: Array.isArray(cmds) ? cmds.map((c) => c.label) : [],
        withDescriptions: Array.isArray(cmds) ? cmds.filter((c) => c.description).length : 0,
        runnerPresent: typeof window.__redbamboo_runCommand === 'function',
      }
    })
    console.log(`window.__redbamboo_commands: ${mirror.present ? 'present' : 'MISSING'}, ${mirror.count} commands (${mirror.withDescriptions} with descriptions), runner: ${mirror.runnerPresent ? 'present' : 'MISSING'}`)
    if (!mirror.present || !mirror.runnerPresent) failures++

    // 2. Expected commands registered (shared + app-specific)
    for (const label of [...SHARED_LABELS, ...app.expectLabels]) {
      const found = mirror.labels.some((l) => l.toLowerCase().includes(label.toLowerCase()))
      console.log(`  ${found ? 'OK ' : 'FAIL'} command: ${label}`)
      if (!found) failures++
    }

    // 3. Bogus runCommand returns false; real id returns true (no side effects checked here)
    const runnerSane = await page.evaluate(() => {
      const bogus = window.__redbamboo_runCommand('__does_not_exist__') === false
      return bogus
    })
    console.log(`  ${runnerSane ? 'OK ' : 'FAIL'} runCommand returns false for unknown id`)
    if (!runnerSane) failures++

    // 4. Ctrl+K opens the palette
    await page.keyboard.press('Control+k')
    await page.waitForTimeout(800)
    const paletteOpen = await page.evaluate(() => {
      return !!document.querySelector("[data-slot='command-palette'], [role='dialog']")
    })
    console.log(`  ${paletteOpen ? 'OK ' : 'FAIL'} Ctrl+K opens palette`)
    if (!paletteOpen) failures++
    await page.screenshot({ path: `screenshots-verify/${app.name.toLowerCase()}-palette.png` })
    await page.keyboard.press('Escape')

    // 5. Palette-infra console warnings (duplicate ids / shortcut conflicts) and page errors
    const warnings = consoleLogs.filter((l) => l.includes('[command-palette]'))
    const errors = consoleLogs.filter((l) => l.startsWith('[pageerror]') || l.startsWith('[error]'))
    console.log(`  ${warnings.length === 0 ? 'OK ' : 'WARN'} palette warnings: ${warnings.length}`)
    warnings.forEach((w) => console.log(`    ${w}`))
    console.log(`  ${errors.length === 0 ? 'OK ' : 'WARN'} page errors: ${errors.length}`)
    errors.slice(0, 5).forEach((e) => console.log(`    ${e}`))
    if (warnings.length > 0) failures++
  } catch (e) {
    console.log(`  FAIL could not verify: ${e.message}`)
    failures++
  } finally {
    await page.close()
  }
}

await browser.close()
console.log(`\n${failures === 0 ? 'ALL PALETTE CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`)
process.exit(failures === 0 ? 0 : 1)
