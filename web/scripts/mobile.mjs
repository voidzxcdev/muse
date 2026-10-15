// Mobile audit: touch emulation, screenshots at 375/320 + landscape, overflow + layer checks at 320–768.
// Usage: PW_CHANNEL=chrome node scripts/mobile.mjs [baseUrl]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:8090';
const OUT = path.resolve('screens', 'v3');
fs.mkdirSync(OUT, { recursive: true });
const user = `uitest_${Date.now().toString(36).slice(-5)}`;
const pass = 'uitest-pass-1';
const report = [];
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome', headless: true });
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

async function ctxFor(viewport) {
  const ctx = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: UA, colorScheme: 'dark' });
  await ctx.addInitScript(() => { try { localStorage.setItem('muse:theme', 'dark'); localStorage.setItem('muse:cookies', 'needed'); localStorage.setItem('muse:apkPrompt', '1'); localStorage.setItem('muse:deskPrompt', '1'); localStorage.setItem('muse:onboarded', '1'); } catch {} });
  return ctx;
}
async function checks(page, tag, name) {
  const r = await page.evaluate(() => {
    const de = document.documentElement, m = document.getElementById('main');
    const over = Math.max(de.scrollWidth - innerWidth, m ? m.scrollWidth - m.clientWidth : 0);
    const rect = (s) => { const e = document.querySelector(s); if (!e || e.hidden || getComputedStyle(e).display === 'none') return null; const b = e.getBoundingClientRect(); return b.height ? b : null; };
    const tab = rect('#tabbar'), pl = rect('#player'), ck = rect('#cookieBar');
    const ov = (a, b) => a && b && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    const small = [...document.querySelectorAll('button, a[href], [role=tab], input, textarea')].filter((e) => {
      const b = e.getBoundingClientRect(); if (!b.width || !b.height || b.bottom < 0 || b.top > innerHeight) return false;
      if (getComputedStyle(e).visibility === 'hidden') return false;
      const after = getComputedStyle(e, '::after'); const aw = parseFloat(after.width) || 0, ah = parseFloat(after.height) || 0;
      return Math.max(b.width, aw) < 43.5 || Math.max(b.height, ah) < 43.5;
    }).map((e) => (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 24));
    const fonts = [...document.querySelectorAll('input, textarea')].filter((e) => e.offsetParent).map((e) => parseFloat(getComputedStyle(e).fontSize)).filter((f) => f < 16);
    const clipped = [...document.querySelectorAll('#topbar *, #tabbar *, #player *')].filter((e) => { const b = e.getBoundingClientRect(); return b.width && (b.right > innerWidth + 1 || b.left < -1); }).length;
    return { over: over + clipped, overlap: !!(ov(tab, pl) || ov(pl, ck) || ov(tab, ck)), small: [...new Set(small)].slice(0, 8), smallInputs: fonts.length };
  });
  report.push(`${tag} ${name}: hOverflow=${r.over}px overlap=${r.overlap} smallInputs=${r.smallInputs} smallTargets=${r.small.length ? r.small.join(' | ') : 'none'}`);
}
async function shot(page, tag, name) { await page.waitForTimeout(800); await checks(page, tag, name); await page.screenshot({ path: path.join(OUT, `${tag}-${name}.png`) }); console.log('shot', tag, name); }

// account via API
{ const c = await browser.newContext(); const p = await c.newPage(); await p.goto(BASE + '/web');
  console.log('signup', await p.evaluate(async ([u, pw]) => (await fetch('/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: pw, accepted_tos: true }) })).status, [user, pass]));
  await c.close(); }

async function signIn(page) {
  await page.evaluate(async ([u, pw]) => fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: pw }) }), [user, pass]);
}

async function full(viewport, tag) {
  const ctx = await ctxFor(viewport); const page = await ctx.newPage();
  page.on('response', (r) => { if (r.status() === 404) report.push(`${tag} 404 ${r.url().replace(BASE, '')}`); });
  await page.goto(BASE + '/mobile/android', { waitUntil: 'networkidle' });
  await signIn(page); await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(2000);
  await shot(page, tag, '01-home');
  await page.fill('#q', 'daft punk'); await page.waitForTimeout(4500);
  await shot(page, tag, '02-search');
  const card = page.locator('main button[title="Play"]').first();
  if (await card.count()) {
    await card.tap(); await page.waitForTimeout(3500); await shot(page, tag, '03-playing');
    const more = page.locator('main button[aria-label="More"]').first();
    if (await more.count()) { await more.tap(); await page.waitForTimeout(700); await shot(page, tag, '04-track-sheet'); await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    await page.locator('#player button[aria-label="Open now playing"]').tap(); await page.waitForTimeout(3000); await shot(page, tag, '05-nowplaying');
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  }
  for (const [u, n] of [['/liked', '06-liked'], ['/market', '07-market'], ['/friends', '08-friends'], [`/@${user}`, '09-profile']]) {
    await page.evaluate((u) => { history.pushState({}, '', u); dispatchEvent(new PopStateEvent('popstate')); }, u);
    await page.waitForTimeout(1800); await shot(page, tag, n);
  }
  await page.locator('#tabLib').tap().catch(() => {}); await page.waitForTimeout(700); await shot(page, tag, '10-library-sheet');
  await ctx.close();
}
await full({ width: 375, height: 812 }, 'm375');
await full({ width: 320, height: 640 }, 'm320');
await full({ width: 844, height: 390 }, 'land844');
// overflow sweep at other widths
try { for (const vp of [{ width: 390, height: 844 }, { width: 414, height: 896 }, { width: 768, height: 1024 }, { width: 667, height: 375 }, { width: 1024, height: 768 }]) {
  const ctx = await ctxFor(vp); const page = await ctx.newPage(); await page.goto(BASE + '/mobile/android', { waitUntil: 'networkidle' }); await signIn(page);
  for (const u of ['/home', '/liked', '/market', '/friends', `/@${user}`]) { await page.goto(BASE + u, { waitUntil: 'networkidle' }); await page.waitForTimeout(1200); await checks(page, `w${vp.width}x${vp.height}`, u); }
  await ctx.close();
} } catch (e) { report.push('sweep error: ' + e.message.split('\n')[0]); }
{ const c = await browser.newContext(); const p = await c.newPage(); await p.goto(BASE + '/web'); await signIn(p);
  console.log('delete', await p.evaluate(async (pw) => (await fetch('/api/me/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) })).status, pass)); }
await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);
fs.writeFileSync(path.join(OUT, 'report.txt'), report.join('\n'));
console.log(report.join('\n'));
process.exit(0);
