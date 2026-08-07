const { chromium } = require('playwright');

const SHOTS = 'C:/Users/laure/AppData/Local/RedLeaf/agents/nova/screenshots';
const URL = 'https://www.onedoc.ch/en/medical-center/zurich/em19/arztezentrum-sihlcity';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 1400 },
    locale: 'en-GB',
  });
  const page = await context.newPage();

  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);

    // dismiss cookie banner if present
    for (const label of ['Accept', 'Akzeptieren', 'Alle akzeptieren', 'Tout accepter', 'OK']) {
      const b = page.locator(`button:has-text("${label}")`).first();
      if (await b.count() && await b.isVisible().catch(() => false)) {
        await b.click().catch(() => {});
        await page.waitForTimeout(1500);
        break;
      }
    }
    await page.waitForTimeout(3000);

    // Drive the booking widget: pick General care medicine
    const bookHeading = page.locator('text=Book your appointment').first();
    if (await bookHeading.count()) await bookHeading.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(1500);

    const selects = page.locator('select');
    const nSel = await selects.count();
    console.log('native <select> count:', nSel);
    if (nSel) {
      for (let i = 0; i < nSel; i++) {
        const opts = await selects.nth(i).locator('option').allTextContents();
        console.log(`select[${i}] options:`, JSON.stringify(opts.slice(0, 20)));
      }
      await selects.first().selectOption({ label: 'General care medicine' }).catch(async () => {
        await selects.first().selectOption({ index: 1 }).catch(() => {});
      });
      await page.waitForTimeout(3500);
      const n2 = await selects.count();
      for (let i = 0; i < n2; i++) {
        const opts = await selects.nth(i).locator('option').allTextContents();
        console.log(`after-pick select[${i}]:`, JSON.stringify(opts.slice(0, 20)));
      }
    } else {
      const combo = page.locator('text=Select a specialty').first();
      if (await combo.count()) {
        await combo.click().catch(() => {});
        await page.waitForTimeout(2500);
        console.log('custom dropdown opened, visible options:');
        console.log(JSON.stringify(await page.locator('[role=option], li').allTextContents().catch(() => []), null, 1).slice(0, 2000));
        const gp = page.locator('text=General care medicine').first();
        if (await gp.count()) { await gp.click().catch(() => {}); await page.waitForTimeout(4000); }
      }
    }

    const txt = await page.evaluate(() => document.body.innerText);
    console.log('===== PAGE TEXT =====');
    console.log(txt.slice(0, 4000));

    // Look for anything that smells like a bookable reason or a time slot
    const info = await page.evaluate(() => {
      const times = new Set();
      document.querySelectorAll('a,button,div,span,li').forEach(el => {
        const t = (el.innerText || '').trim();
        if (/^\d{1,2}[:.]\d{2}$/.test(t)) times.add(t);
      });
      const links = [...document.querySelectorAll('a[href]')]
        .map(a => a.getAttribute('href'))
        .filter(h => /book|termin|rendez|appointment|agenda|doctor|arzt/i.test(h || ''));
      return { times: [...times].slice(0, 60), links: [...new Set(links)].slice(0, 30) };
    });
    console.log('\n===== TIME-LIKE TOKENS =====');
    console.log(JSON.stringify(info.times));
    console.log('\n===== BOOKING-ISH LINKS =====');
    console.log(JSON.stringify(info.links, null, 1));

    await page.screenshot({ path: SHOTS + '/onedoc_sihlcity.png', fullPage: true });
    console.log('\nscreenshot: ' + SHOTS + '/onedoc_sihlcity.png');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
