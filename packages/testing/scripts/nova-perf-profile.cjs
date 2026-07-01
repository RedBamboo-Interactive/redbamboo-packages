const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCREENSHOTS = 'T:/Projects/redbamboo-packages/packages/testing/screenshots';
const TRACE_FILE = path.join(SCREENSHOTS, 'nova-perf-trace.json');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const results = { steps: [], domMetrics: {}, longTasks: [], warnings: [] };

  // Enable CDP for performance metrics
  const client = await page.context().newCDPSession(page);
  await client.send('Performance.enable');

  // Start tracing via CDP
  await client.send('Tracing.start', {
    categories: 'devtools.timeline,blink.user_timing,loading,devtools.timeline.frame',
    options: 'sampling-frequency=1000'
  });

  // --- STEP 1: Initial page load ---
  const loadStart = Date.now();
  await page.goto('http://localhost:18803', { waitUntil: 'networkidle' });
  const loadTime = Date.now() - loadStart;
  results.steps.push({ name: 'Page Load', time: loadTime });
  console.log('Page load: ' + loadTime + 'ms');

  // Wait for app to settle
  await page.waitForTimeout(1500);

  // Screenshot 1: Initial state
  await page.screenshot({ path: path.join(SCREENSHOTS, '01_initial_load.png'), fullPage: true });
  console.log('Screenshot: 01_initial_load.png');

  // --- DOM Metrics ---
  const domMetrics = await page.evaluate(() => {
    const allNodes = document.querySelectorAll('*');
    const bodyNodes = document.body.querySelectorAll('*');

    // Find deepest nesting
    let maxDepth = 0;
    function getDepth(el, depth) {
      if (depth > maxDepth) maxDepth = depth;
      for (const child of el.children) getDepth(child, depth + 1);
    }
    getDepth(document.body, 0);

    // Find largest subtrees
    const subtrees = [];
    for (const el of document.body.children) {
      subtrees.push({
        tag: el.tagName,
        id: el.id || '',
        class: (el.className || '').toString().substring(0, 60),
        nodes: el.querySelectorAll('*').length
      });
    }
    subtrees.sort((a, b) => b.nodes - a.nodes);

    // Layout-heavy elements
    const layoutHeavy = [];
    for (const el of allNodes) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 2000 || rect.height > 5000) {
        layoutHeavy.push({
          tag: el.tagName,
          id: el.id || '',
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        });
      }
    }

    return {
      totalNodes: allNodes.length,
      bodyNodes: bodyNodes.length,
      maxDepth,
      topSubtrees: subtrees.slice(0, 5),
      layoutHeavy: layoutHeavy.slice(0, 10),
      scripts: document.querySelectorAll('script').length,
      styles: document.querySelectorAll('style, link[rel=stylesheet]').length,
      images: document.querySelectorAll('img').length,
    };
  });
  results.domMetrics = domMetrics;
  console.log('DOM nodes: ' + domMetrics.totalNodes);
  console.log('Max depth: ' + domMetrics.maxDepth);
  console.log('Scripts: ' + domMetrics.scripts + ', Styles: ' + domMetrics.styles);

  if (domMetrics.totalNodes > 1500) {
    results.warnings.push('HIGH DOM node count: ' + domMetrics.totalNodes + ' (recommended < 1500)');
  }
  if (domMetrics.maxDepth > 32) {
    results.warnings.push('DEEP DOM nesting: ' + domMetrics.maxDepth + ' levels (recommended < 32)');
  }

  // --- CDP Performance Metrics ---
  const perfMetrics = await client.send('Performance.getMetrics');
  const metricsMap = {};
  for (const m of perfMetrics.metrics) metricsMap[m.name] = m.value;
  results.cdpMetrics = {
    JSHeapUsedSize: Math.round((metricsMap.JSHeapUsedSize || 0) / 1024 / 1024) + ' MB',
    JSHeapTotalSize: Math.round((metricsMap.JSHeapTotalSize || 0) / 1024 / 1024) + ' MB',
    Nodes: metricsMap.Nodes,
    LayoutCount: metricsMap.LayoutCount,
    RecalcStyleCount: metricsMap.RecalcStyleCount,
    LayoutDuration: Math.round((metricsMap.LayoutDuration || 0) * 1000) + ' ms',
    RecalcStyleDuration: Math.round((metricsMap.RecalcStyleDuration || 0) * 1000) + ' ms',
    ScriptDuration: Math.round((metricsMap.ScriptDuration || 0) * 1000) + ' ms',
    TaskDuration: Math.round((metricsMap.TaskDuration || 0) * 1000) + ' ms',
    Documents: metricsMap.Documents,
    Frames: metricsMap.Frames,
  };
  console.log('CDP Nodes: ' + metricsMap.Nodes);
  console.log('JS Heap: ' + results.cdpMetrics.JSHeapUsedSize + ' / ' + results.cdpMetrics.JSHeapTotalSize);

  // --- STEP 2: Find and click navigation tabs ---
  const tabs = await page.$$eval(
    'nav button, [role=tab], [data-slot="tabs-trigger"]',
    els => els.map(e => ({ text: e.textContent.trim(), tag: e.tagName }))
  );
  console.log('Found tabs: ' + JSON.stringify(tabs.map(t => t.text)));

  // Also look for sidebar items and hamburger menu
  const navButtons = await page.$$eval('button', els =>
    els.map(e => ({
      text: e.textContent.trim().substring(0, 40),
      ariaLabel: e.getAttribute('aria-label') || ''
    })).filter(b => b.text || b.ariaLabel)
  );
  console.log('All buttons (' + navButtons.length + '): ' + JSON.stringify(navButtons.slice(0, 20)));

  // Try clicking on each unique tab/nav element
  const tabSelectors = ['nav button', '[data-slot="tabs-trigger"]'];
  let tabIndex = 2;
  const clickedTexts = new Set();

  for (const selector of tabSelectors) {
    const tabEls = await page.$$(selector);
    for (let i = 0; i < tabEls.length && i < 8; i++) {
      const tabText = await tabEls[i].textContent();
      const trimmed = (tabText || '').trim();
      if (!trimmed || trimmed.length > 30 || clickedTexts.has(trimmed)) continue;
      clickedTexts.add(trimmed);

      console.log('Clicking tab: ' + trimmed);
      const navStart = Date.now();
      try {
        await tabEls[i].click();
        await page.waitForTimeout(1000);
        const navTime = Date.now() - navStart;
        results.steps.push({ name: 'Navigate to: ' + trimmed, time: navTime });
        console.log('  Navigation time: ' + navTime + 'ms');

        // DOM count after navigation
        const postNavNodes = await page.evaluate(() => document.querySelectorAll('*').length);
        console.log('  DOM nodes after: ' + postNavNodes);
        results.steps[results.steps.length - 1].domNodesAfter = postNavNodes;

        // Screenshot
        const ssName = String(tabIndex).padStart(2, '0') + '_tab_' +
          trimmed.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20) + '.png';
        await page.screenshot({ path: path.join(SCREENSHOTS, ssName), fullPage: true });
        console.log('  Screenshot: ' + ssName);
        tabIndex++;
      } catch (e) {
        console.log('  Click failed: ' + e.message.substring(0, 100));
      }
    }
  }

  // --- STEP 3: Try hamburger menu ---
  try {
    const hamburger = await page.$('button:has(i.fa-bars)');
    if (hamburger) {
      console.log('Found hamburger menu, clicking...');
      const menuStart = Date.now();
      await hamburger.click();
      await page.waitForTimeout(800);
      const menuTime = Date.now() - menuStart;
      results.steps.push({ name: 'Open hamburger menu', time: menuTime });

      await page.screenshot({
        path: path.join(SCREENSHOTS, String(tabIndex).padStart(2, '0') + '_hamburger_menu.png'),
        fullPage: true
      });
      tabIndex++;

      // Try clicking Settings if visible
      const settingsItem = await page.$('[data-slot="dropdown-menu-item"]:has-text("Settings")');
      if (settingsItem) {
        const settingsStart = Date.now();
        await settingsItem.click();
        await page.waitForTimeout(1000);
        const settingsTime = Date.now() - settingsStart;
        results.steps.push({ name: 'Navigate to Settings', time: settingsTime });

        const settingsNodes = await page.evaluate(() => document.querySelectorAll('*').length);
        results.steps[results.steps.length - 1].domNodesAfter = settingsNodes;

        await page.screenshot({
          path: path.join(SCREENSHOTS, String(tabIndex).padStart(2, '0') + '_settings.png'),
          fullPage: true
        });
        tabIndex++;
      }

      // Press Escape to close any menu/modal
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    } else {
      console.log('No hamburger button found');
    }
  } catch (e) {
    console.log('Hamburger exploration failed: ' + e.message.substring(0, 100));
  }

  // --- STEP 4: Try sidebar items if present ---
  try {
    const sidebarItems = await page.$$('[data-slot="master-detail-sidebar"] [data-slot="item-list-row"]');
    if (sidebarItems.length > 0) {
      console.log('Found ' + sidebarItems.length + ' sidebar items');
      for (let i = 0; i < Math.min(sidebarItems.length, 3); i++) {
        const itemText = await sidebarItems[i].textContent();
        const trimmed = (itemText || '').trim().substring(0, 30);
        console.log('Clicking sidebar item: ' + trimmed);
        const sideStart = Date.now();
        await sidebarItems[i].click();
        await page.waitForTimeout(1000);
        const sideTime = Date.now() - sideStart;
        results.steps.push({ name: 'Sidebar: ' + trimmed, time: sideTime });

        const sideNodes = await page.evaluate(() => document.querySelectorAll('*').length);
        results.steps[results.steps.length - 1].domNodesAfter = sideNodes;

        await page.screenshot({
          path: path.join(SCREENSHOTS, String(tabIndex).padStart(2, '0') + '_sidebar_' + i + '.png'),
          fullPage: true
        });
        tabIndex++;
      }
    }
  } catch (e) {
    console.log('Sidebar exploration failed: ' + e.message.substring(0, 100));
  }

  // --- STEP 5: Check for long tasks via Performance API ---
  const perfData = await page.evaluate(() => {
    return new Promise((resolve) => {
      const tasks = [];
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            tasks.push({
              name: entry.name,
              duration: Math.round(entry.duration),
              startTime: Math.round(entry.startTime)
            });
          }
        });
        observer.observe({ type: 'longtask', buffered: true });
        setTimeout(() => {
          observer.disconnect();
          finalize();
        }, 200);
      } catch(e) {
        finalize();
      }

      function finalize() {
        const navTiming = performance.getEntriesByType('navigation');
        const paintTiming = performance.getEntriesByType('paint');
        const resourceTiming = performance.getEntriesByType('resource');

        const timings = {
          navigation: navTiming.length ? {
            domContentLoaded: Math.round(navTiming[0].domContentLoadedEventEnd),
            loadComplete: Math.round(navTiming[0].loadEventEnd),
            domInteractive: Math.round(navTiming[0].domInteractive),
            responseEnd: Math.round(navTiming[0].responseEnd),
            ttfb: Math.round(navTiming[0].responseStart - navTiming[0].requestStart),
          } : null,
          paint: paintTiming.map(p => ({ name: p.name, time: Math.round(p.startTime) })),
          resourceCount: resourceTiming.length,
          slowResources: resourceTiming
            .filter(r => r.duration > 100)
            .map(r => ({
              name: r.name.split('/').pop().substring(0, 60),
              duration: Math.round(r.duration),
              size: r.transferSize || 0,
              type: r.initiatorType
            }))
            .sort((a, b) => b.duration - a.duration)
            .slice(0, 15),
        };

        resolve({ longTasks: tasks, timings });
      }
    });
  });
  results.longTasks = perfData.longTasks;
  results.timings = perfData.timings;
  console.log('Long tasks found: ' + perfData.longTasks.length);
  if (perfData.longTasks.length > 0) {
    console.log('Long tasks: ' + JSON.stringify(perfData.longTasks));
  }
  console.log('Navigation timing: ' + JSON.stringify(perfData.timings.navigation));
  console.log('Paint timing: ' + JSON.stringify(perfData.timings.paint));
  console.log('Slow resources (' + perfData.timings.slowResources.length + '): ' +
    JSON.stringify(perfData.timings.slowResources));

  // --- Final CDP metrics (after all navigation) ---
  const finalMetrics = await client.send('Performance.getMetrics');
  const finalMap = {};
  for (const m of finalMetrics.metrics) finalMap[m.name] = m.value;
  results.finalCdpMetrics = {
    JSHeapUsedSize: Math.round((finalMap.JSHeapUsedSize || 0) / 1024 / 1024) + ' MB',
    LayoutCount: finalMap.LayoutCount,
    RecalcStyleCount: finalMap.RecalcStyleCount,
    LayoutDuration: Math.round((finalMap.LayoutDuration || 0) * 1000) + ' ms',
    RecalcStyleDuration: Math.round((finalMap.RecalcStyleDuration || 0) * 1000) + ' ms',
    ScriptDuration: Math.round((finalMap.ScriptDuration || 0) * 1000) + ' ms',
    TaskDuration: Math.round((finalMap.TaskDuration || 0) * 1000) + ' ms',
    Nodes: finalMap.Nodes,
  };
  console.log('\nFinal CDP metrics: ' + JSON.stringify(results.finalCdpMetrics));

  // Delta analysis
  const layoutDelta = results.finalCdpMetrics.LayoutCount - results.cdpMetrics.LayoutCount;
  const styleDelta = results.finalCdpMetrics.RecalcStyleCount - results.cdpMetrics.RecalcStyleCount;
  console.log('Layouts triggered during navigation: ' + layoutDelta);
  console.log('Style recalcs during navigation: ' + styleDelta);

  if (layoutDelta > 50) {
    results.warnings.push('EXCESSIVE LAYOUTS during navigation: ' + layoutDelta + ' recalculations');
  }
  if (styleDelta > 100) {
    results.warnings.push('EXCESSIVE STYLE RECALCS during navigation: ' + styleDelta);
  }

  // Stop tracing via CDP
  const traceChunks = [];
  client.on('Tracing.dataCollected', (data) => { traceChunks.push(...data.value); });
  await new Promise((resolve) => {
    client.on('Tracing.tracingComplete', resolve);
    client.send('Tracing.end');
  });
  fs.writeFileSync(TRACE_FILE, JSON.stringify(traceChunks, null, 2));
  console.log('Trace saved to: ' + TRACE_FILE + ' (' + traceChunks.length + ' events)');

  // Final screenshot
  await page.screenshot({
    path: path.join(SCREENSHOTS, String(tabIndex).padStart(2, '0') + '_final_state.png'),
    fullPage: true
  });

  // Write full results JSON
  const summary = JSON.stringify(results, null, 2);
  fs.writeFileSync(path.join(SCREENSHOTS, 'perf-results.json'), summary);
  console.log('\n=== PERFORMANCE SUMMARY ===');
  console.log(summary);

  await context.close();
  await browser.close();
  console.log('\nDone.');
})().catch(e => {
  console.error('FATAL: ' + e.message);
  console.error(e.stack);
  process.exit(1);
});
