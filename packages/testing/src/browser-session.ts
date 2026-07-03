import { type Browser, type BrowserContext, type BrowserContextOptions } from 'playwright'
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

export class BrowserSessionStore {
  constructor(private storeDir: string) {
    mkdirSync(storeDir, { recursive: true })
  }

  statePath(domain: string): string {
    const safe = domain.replace(/[^a-zA-Z0-9.-]/g, '_')
    return join(this.storeDir, `${safe}.json`)
  }

  has(domain: string): boolean {
    return existsSync(this.statePath(domain))
  }

  async createContext(
    browser: Browser,
    domain: string,
    options?: BrowserContextOptions,
  ): Promise<BrowserContext> {
    const path = this.statePath(domain)
    const storageState = existsSync(path) ? path : undefined
    return browser.newContext({ ...options, storageState })
  }

  async save(context: BrowserContext, domain: string): Promise<void> {
    const path = this.statePath(domain)
    await context.storageState({ path })
  }

  clear(domain: string): void {
    const path = this.statePath(domain)
    if (existsSync(path)) unlinkSync(path)
  }

  list(): string[] {
    return readdirSync(this.storeDir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace(/\.json$/, ''))
  }

  inspect(domain: string): { cookies: number; origins: number } | null {
    const path = this.statePath(domain)
    if (!existsSync(path)) return null
    const state = JSON.parse(readFileSync(path, 'utf-8'))
    return {
      cookies: state.cookies?.length ?? 0,
      origins: state.origins?.length ?? 0,
    }
  }
}
