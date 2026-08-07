const { chromium } = require('playwright');
const { BrowserSessionStore } = require('./browser-session.cjs');

const STORE_DIR = 'C:/Users/laure/AppData/Local/RedLeaf/agents/nova/temp/browser-state';

(async () => {
  const store = new BrowserSessionStore(STORE_DIR);
  const browser = await chromium.launch({ headless: true });
  const context = await store.createContext(browser, 'tomtasty.ch', {
    viewport: { width: 1400, height: 1000 },
  });
  const page = await context.newPage();

  try {
    await page.goto('https://www.tomtasty.ch/pages/cockpit', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);

    // Expand full order list
    const link = page.locator('text=/Alle \\d+ Bestellungen anzeigen/').first();
    if (await link.count()) {
      await link.click();
      await page.waitForTimeout(4000);
    }

    const txt = await page.evaluate(() => document.body.innerText);
    const i = txt.indexOf('Vergangene Lieferungen');
    console.log(txt.slice(i, i + 4000));
  } finally {
    await browser.close();
  }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
