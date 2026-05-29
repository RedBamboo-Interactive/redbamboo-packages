import { chromium, type Browser, type Page, type BrowserContext } from 'playwright'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import nodePath from 'node:path'

const __dirname = nodePath.dirname(fileURLToPath(import.meta.url))
export const SCREENSHOTS_DIR = nodePath.resolve(__dirname, '..', 'screenshots')

export const PORT_MAP = {
  nova: 18903,
  codered: 18901,
  redmatter: 18902,
  redleaf: 18904,
} as const

export type AppName = keyof typeof PORT_MAP

export interface NavigatorOptions {
  headless?: boolean
  timeout?: number
}

export class RedSuiteNavigator {
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private _page: Page | null = null
  readonly baseUrl: string

  constructor(
    appOrPort: AppName | number,
    private options: NavigatorOptions = {},
  ) {
    const port = typeof appOrPort === 'number' ? appOrPort : PORT_MAP[appOrPort]
    this.baseUrl = `http://localhost:${port}`
  }

  get page(): Page {
    if (!this._page) throw new Error('Navigator not launched — call launch() first')
    return this._page
  }

  async launch(path = '/'): Promise<Page> {
    this.browser = await chromium.launch({
      headless: this.options.headless ?? true,
    })
    this.context = await this.browser.newContext()
    this._page = await this.context.newPage()
    if (this.options.timeout) {
      this._page.setDefaultTimeout(this.options.timeout)
    }
    await this._page.goto(`${this.baseUrl}${path}`)
    return this._page
  }

  async screenshot(filePath: string): Promise<string> {
    mkdirSync(nodePath.dirname(nodePath.resolve(filePath)), { recursive: true })
    await this.page.screenshot({ path: filePath, fullPage: true })
    return filePath
  }

  async explore(filePath?: string): Promise<string> {
    const dest = filePath ?? `screenshot-${Date.now()}.png`
    mkdirSync(nodePath.dirname(nodePath.resolve(dest)), { recursive: true })
    await this.page.screenshot({ path: dest, fullPage: true })
    return dest
  }

  async click(selector: string): Promise<void> {
    await this.page.click(selector)
  }

  async waitForSelector(selector: string, options?: { timeout?: number }): Promise<void> {
    await this.page.waitForSelector(selector, options)
  }

  async getText(selector: string): Promise<string> {
    return await this.page.textContent(selector) ?? ''
  }

  async getPageTitle(): Promise<string> {
    return await this.page.title()
  }

  async clickTab(name: string): Promise<void> {
    await this.page.locator('nav button', { hasText: name }).click()
  }

  async clickSidebarItem(name: string): Promise<void> {
    await this.page
      .locator('[data-slot="master-detail-sidebar"] [data-slot="item-list-row"]', { hasText: name })
      .click()
  }

  async clickSubTab(name: string): Promise<void> {
    const standard = this.page.locator('[data-slot="tabs-trigger"]', { hasText: name })
    if (await standard.count() > 0) {
      await standard.click()
      return
    }
    // Fallback: custom tab buttons inside the content area (exact match)
    await this.page
      .locator('[data-slot="master-detail-content"]')
      .getByRole('button', { name, exact: true })
      .click()
  }

  async openMenu(): Promise<void> {
    await this.page.locator('button:has(i.fa-bars)').click()
  }

  async waitForContent(): Promise<void> {
    await this.page.waitForLoadState('networkidle')
  }

  getScreenshotPath(name: string): string {
    const ts = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')
    return nodePath.join(SCREENSHOTS_DIR, `${ts}_${name}.png`)
  }

  async close(): Promise<void> {
    await this.browser?.close()
    this.browser = null
    this.context = null
    this._page = null
  }
}
