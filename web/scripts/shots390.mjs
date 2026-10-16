import { chromium } from 'playwright-core';
import fs from 'node:fs';
const BASE = process.argv[2] || 'http://127.0.0.1:8091', OUT = process.argv[3] || 'screens/v5';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, colorScheme: 'dark',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
await ctx.addInitScript(() => { try { localStorage.setItem('muse:theme', 'dark'); localStorage.setItem('muse:cookies', 'needed'); localStorage.setItem('muse:apkPrompt', '1'); localStorage.setItem('muse:onboarded', '1'); } catch {} });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
let insets = 'css-fallback';
try { await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 47, bottom: 34, left: 0, right: 0 } }); insets = 'cdp'; } catch (e) { insets = 'none: ' + e.message.split('\n')[0]; }
await page.goto(BASE + '/mobile/android', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
const geo = async () => page.evaluate(() => { const t = document.getElementById('tabbar').getBoundingClientRect(); const b = document.querySelector('#tabHome').getBoundingClientRect(); const sab = getComputedStyle(document.getElementById('tabbar')).paddingBottom;
  return { tabTop: t.top, tabBottom: t.bottom, vh: innerHeight, tabH: t.height, btnH: b.height, btnW: b.width, padBottom: sab }; });
console.log('insets', insets, JSON.stringify(await geo()));
const shot = async (n) => { await page.waitForTimeout(700); await page.screenshot({ path: `${OUT}/390-${n}.png` }); console.log('shot', n); };
await shot('01-home');
await page.tap('#tabSearch'); await page.keyboard.type('daft punk'); await page.waitForTimeout(4000); await page.evaluate(() => document.activeElement.blur()); await shot('02-search');
const card = page.locator('main button[title="Play"]').first();
if (await card.count()) { await card.tap(); await page.waitForTimeout(3000); await shot('03-miniplayer');
  await page.locator('#player button[aria-label="Open now playing"]').tap(); await page.waitForTimeout(1500); await shot('04-nowplaying'); await page.locator('#bpClose').tap(); await page.waitForTimeout(600); }
await page.tap('#tabLib'); await shot('05-library-sheet'); await page.keyboard.press('Escape'); await page.waitForTimeout(400);
await page.tap('#tabMe'); await shot('06-me-sheet'); await page.keyboard.press('Escape'); await page.waitForTimeout(400);
await page.tap('#tabFriends'); await shot('07-friends');
await browser.close();
