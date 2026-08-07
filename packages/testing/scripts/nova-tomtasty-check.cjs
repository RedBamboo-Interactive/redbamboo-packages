const { chromium } = require('playwright');
const { BrowserSessionStore } = require('./browser-session.cjs');

const STORE_DIR = 'C:/Users/laure/AppData/Local/RedLeaf/agents/nova/temp/browser-state';
const SHOTS = 'C:/Users/laure/AppData/Local/RedLeaf/agents/nova/screenshots';

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

    const cockpitText = await page.evaluate(() => document.body.innerText);
    console.log('===== COCKPIT =====');
    console.log(cockpitText.slice(0, 3000));

    await page.screenshot({ path: SHOTS + '/tomtasty_cockpit.png', fullPage: true });

    await page.goto('https://www.tomtasty.ch/pages/selector?sub=5655546', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(7000);

    const sel = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.tt-sel__card')].map(c => ({
        vid: c.getAttribute('data-vid'),
        name: (c.querySelector('.tt-sel__card-name') || {}).innerText || '',
        selected: c.classList.contains('tt-sel__card--selected'),
      }));
      const cart = [...document.querySelectorAll('.tt-sel-cartbar__row-name')].map(e => e.innerText);
      const total = (document.querySelector('.tt-sel-cartbar__total') || {}).innerText || '';
      return { cards, cart, total, headline: document.body.innerText.slice(0, 800) };
    });

    console.log('===== SELECTOR HEADLINE =====');
    console.log(sel.headline);
    console.log('===== CART =====');
    console.log(JSON.stringify(sel.cart, null, 2), sel.total);
    console.log('===== SELECTED CARDS =====');
    console.log(JSON.stringify(sel.cards.filter(c => c.selected), null, 2));
    console.log('===== ALL CARDS (' + sel.cards.length + ') =====');
    console.log(sel.cards.map(c => (c.selected ? '[x] ' : '[ ] ') + c.vid + '  ' + c.name.replace(/\n/g, ' | ')).join('\n'));

    await page.screenshot({ path: SHOTS + '/tomtasty_selector.png', fullPage: true });

    await store.save(context, 'tomtasty.ch');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
