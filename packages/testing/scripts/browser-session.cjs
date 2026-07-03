const fs = require('node:fs');
const path = require('node:path');

class BrowserSessionStore {
  constructor(storeDir) {
    this.storeDir = storeDir;
    fs.mkdirSync(storeDir, { recursive: true });
  }

  statePath(domain) {
    const safe = domain.replace(/[^a-zA-Z0-9.-]/g, '_');
    return path.join(this.storeDir, `${safe}.json`);
  }

  has(domain) {
    return fs.existsSync(this.statePath(domain));
  }

  async createContext(browser, domain, options) {
    const p = this.statePath(domain);
    const storageState = fs.existsSync(p) ? p : undefined;
    return browser.newContext({ ...options, storageState });
  }

  async save(context, domain) {
    await context.storageState({ path: this.statePath(domain) });
  }

  clear(domain) {
    const p = this.statePath(domain);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

module.exports = { BrowserSessionStore };
