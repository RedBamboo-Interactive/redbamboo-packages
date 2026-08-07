const { chromium } = require('playwright');
const { BrowserSessionStore } = require('./browser-session.cjs');

const STORE_DIR = 'C:/Users/laure/AppData/Local/RedLeaf/agents/nova/temp/browser-state';
const SHOTS = 'C:/Users/laure/AppData/Local/RedLeaf/agents/nova/screenshots';

(async () => {
  const store = new BrowserSessionStore(STORE_DIR);
  const browser = await chromium.launch({ headless: true });
  const context = await store.createContext(browser, 'tomtasty.ch', {
    viewport: { width: 1400, height: 1200 },
  });
  const page = await context.newPage();

  try {
    await page.goto('https://www.tomtasty.ch/pages/cockpit', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);

    // What is clickable around the order rows?
    const probe = await page.evaluate(() => {
      const hits = [];
      document.querySelectorAll('a,button,[role=button],[onclick]').forEach(el => {
        const t = (el.innerText || '').trim().replace(/\s+/g, ' ');
        if (/#\d{4,}|Bestellung|Lieferung|33369/.test(t)) {
          hits.push({ tag: el.tagName, href: el.getAttribute('href') || '', cls: el.className, text: t.slice(0, 90) });
        }
      });
      return hits.slice(0, 40);
    });
    console.log('--- clickable candidates ---');
    console.log(JSON.stringify(probe, null, 2));

    const heads = page.locator('.order-card__head');
    const n = await heads.count();
    console.log('\norder cards:', n);
    for (let i = 0; i < Math.min(n, 3); i++) {
      await heads.nth(i).click();
      await page.waitForTimeout(2500);
    }
    await page.waitForTimeout(2000);

    const orders = await page.evaluate(() =>
      [...document.querySelectorAll('.order-card')].map(c => c.innerText.replace(/\n{2,}/g, '\n'))
    );
    console.log('\n--- ORDER CARDS EXPANDED ---');
    orders.slice(0, 3).forEach(o => console.log('\n=====\n' + o.slice(0, 1500)));
    await page.screenshot({ path: SHOTS + '/tomtasty_orders.png', fullPage: true });
  } finally {
    await browser.close();
  }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
