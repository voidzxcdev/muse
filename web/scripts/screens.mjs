// Smoke test + screenshots of the React UI against a running server.py.
// Usage: node scripts/screens.mjs [baseUrl]   (uses installed Edge via playwright-core)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:8091';
const OUT = path.resolve('screens');
fs.mkdirSync(OUT, { recursive: true });
const user = `uitest_${Date.now().toString(36).slice(-5)}`;
const pass = 'uitest-pass-1';
const errors = [];

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
async function run(theme, viewport, tag) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme, deviceScaleFactor: 1 });
  await ctx.addInitScript(([t]) => {
    try { localStorage.setItem('muse:theme', t); localStorage.setItem('muse:cookies', 'needed'); localStorage.setItem('muse:deskPrompt', '1'); localStorage.setItem('muse:apkPrompt', '1'); } catch {}
  }, [theme]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${tag}] console: ${m.text()}`); });
  const shot = async (name) => { await page.waitForTimeout(700); await page.screenshot({ path: path.join(OUT, `${tag}-${name}.png`) }); console.log('shot', tag, name); };

  await page.goto(BASE + '/web', { waitUntil: 'networkidle' });
  await shot('01-onboarding');
  // sign up (or in) from onboarding
  const first = tag.startsWith('dark-desktop');
  if (first) {
    await page.fill('#aUser', user); await page.fill('#aPass', pass);
    await page.check('input[type=checkbox]'); await page.click('button[type=submit]');
  } else {
    await page.getByText('I already have one').click();
    await page.fill('#aUser', user); await page.fill('#aPass', pass); await page.click('button[type=submit]');
  }
  await page.waitForSelector('#onboard', { state: 'detached', timeout: 15000 });
  await page.waitForTimeout(2500);
  await shot('02-home');
  await page.fill('#q', 'daft punk');
  await page.waitForTimeout(4500);
  await shot('03-search');
  const card = page.locator('main button[title="Play"]').first();
  if (await card.count()) {
    await card.click(); await page.waitForTimeout(4000);
    await shot('04-playing');
    // like + new playlist through the track menu
    await page.click('#bLike').catch(() => {});
    await page.click('#player button[aria-label="Open now playing"]');
    await page.waitForTimeout(3500);
    await shot('05-nowplaying');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  }
  await page.goto(BASE + '/liked', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500); await shot('06-liked');
  await page.goto(BASE + '/market', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500); await shot('07-market');
  await page.goto(BASE + '/friends', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500); await shot('08-friends');
  await page.goto(BASE + `/@${user}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500); await shot('09-profile');
  await page.evaluate(() => (document.getElementById('sideUser') || document.querySelector('[aria-label="Account"]'))?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  await page.waitForTimeout(500); await shot('10-account-menu');
  await page.keyboard.press('Escape');
  const np = page.locator('#newPl');
  if (await np.isVisible().catch(() => false)) { await np.click(); await page.fill('input[placeholder="My playlist"]', 'UI test'); await page.keyboard.press('Enter'); await page.waitForTimeout(2000); await shot('11-playlist'); }
  await page.evaluate(() => { window.history.pushState({}, '', '/home'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await page.waitForTimeout(800);
  await ctx.close();
  return page;
}
await run('dark', { width: 1440, height: 900 }, 'dark-desktop');
await run('light', { width: 1440, height: 900 }, 'light-desktop');
await run('dark', { width: 390, height: 844 }, 'dark-mobile');

// cleanup: delete the throwaway account
const ctx = await browser.newContext();
const p = await ctx.newPage();
await p.goto(BASE + '/web');
const del = await p.evaluate(async ([u, pw]) => {
  const l = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: pw }) });
  if (!l.ok) return 'login failed';
  const d = await fetch('/api/me/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
  return d.ok ? 'deleted' : 'delete failed';
}, [user, pass]);
console.log('test account', user, del);
await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);
fs.writeFileSync(path.join(OUT, 'errors.txt'), errors.join('\n'));
console.log('errors:', errors.length); errors.slice(0, 30).forEach((e) => console.log(' ', e));
process.exit(0);
