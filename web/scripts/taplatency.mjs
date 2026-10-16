// Tap latency under touch emulation + 4x CPU throttle. Usage: node scripts/taplatency.mjs [base]
import { chromium } from 'playwright-core';
const BASE = process.argv[2] || 'http://127.0.0.1:8090';
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
await ctx.addInitScript(() => { try { for (const k of ['muse:cookies']) localStorage.setItem(k, 'needed'); localStorage.setItem('muse:apkPrompt', '1'); localStorage.setItem('muse:onboarded', '1'); } catch {} });
const page = await ctx.newPage();
await page.goto(BASE + '/mobile/android', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
const res = {};
for (const [sel, name, first] of [['#tabFriends', 'friends(1st)'], ['#tabHome', 'home'], ['#tabFriends', 'friends(2nd)'], ['#tabSearch', 'search'], ['#tabHome', 'home2'], ['#tabLib', 'library-sheet']]) {
  await page.evaluate((sel) => {
    const w = window; w.__t = { down: 0, fb: 0, scr: 0 };
    const btn = document.querySelector(sel);
    const main = document.getElementById('main');
    btn.addEventListener('pointerdown', (e) => { w.__t.down = performance.now(); }, { once: true, capture: true });
    // feedback = first frame after tap where the tab's class/aria changed or :active style applies
    const mo = new MutationObserver(() => { if (w.__t.down && !w.__t.fb) requestAnimationFrame(() => { w.__t.fb = w.__t.fb || performance.now(); }); });
    mo.observe(btn, { attributes: true, subtree: true, childList: true });
    const mo2 = new MutationObserver(() => { if (w.__t.down && !w.__t.scr) requestAnimationFrame(() => { w.__t.scr = w.__t.scr || performance.now(); }); });
    mo2.observe(main, { childList: true, subtree: true });
    mo2.observe(document.body, { childList: true }); // sheets portal into body
  }, sel);
  await page.tap(sel);
  await page.waitForTimeout(2500);
  const t = await page.evaluate(() => window.__t);
  res[name] = { feedback_ms: t.fb ? Math.round(t.fb - t.down) : null, screen_ms: t.scr ? Math.round(t.scr - t.down) : null };
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
}
console.log(JSON.stringify(res, null, 1));
await browser.close();
