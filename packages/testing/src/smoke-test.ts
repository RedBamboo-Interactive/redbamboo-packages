import { RedSuiteNavigator, PORT_MAP, type AppName } from './navigator.js'

const APP_PRIORITY: AppName[] = ['redleaf', 'nova', 'codered', 'redmatter']

async function isPortOpen(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}`, {
      signal: AbortSignal.timeout(2000),
    })
    return response.ok || response.status < 500
  } catch {
    return false
  }
}

async function main() {
  console.log('Red Suite smoke test\n')

  let target: AppName | null = null
  for (const app of APP_PRIORITY) {
    const port = PORT_MAP[app]
    process.stdout.write(`  checking ${app} on :${port}... `)
    if (await isPortOpen(port)) {
      console.log('up!')
      target = app
      break
    }
    console.log('not running')
  }

  if (!target) {
    console.log('\nNo Red Suite app is running. Start one and try again.')
    process.exit(0)
  }

  console.log(`\nRunning smoke test against ${target}...\n`)
  const nav = new RedSuiteNavigator(target, { headless: true, timeout: 10_000 })

  try {
    await nav.launch()
    const title = await nav.getPageTitle()
    console.log(`  page title: ${title}`)

    const path = await nav.explore(`smoke-${target}.png`)
    console.log(`  screenshot: ${path}`)

    console.log('\nSmoke test passed.')
  } catch (err) {
    console.error('\nSmoke test failed:', err)
    process.exit(1)
  } finally {
    await nav.close()
  }
}

main()
