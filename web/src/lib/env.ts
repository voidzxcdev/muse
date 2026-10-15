declare global {
  interface Window {
    __museLane?: string; __museDesktop?: number; __museAndroid?: number; __museBuild?: number;
    __musePushMpris?: (s: any) => void; MusePlayer?: any; MuseAndroid?: any;
    chrome?: any; webkitAudioContext?: any;
  }
}
export const ua = navigator.userAgent || '';
export const isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform || ua));
export const isAndroidApp = /MuseAndroid/i.test(ua) || !!window.__museAndroid;
export const isAndroidWeb = /Android/i.test(ua) && !isAndroidApp;
export const isDeskApp = () => !!(window.chrome && window.chrome.webview) || !!window.__museDesktop || window.__museLane === 'pc';
export const lane = () => window.__museLane || '';
export const isStandalone = () => {
  try { return matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true; } catch { return false; }
};

export function cookiesChoice(): string { try { return localStorage.getItem('muse:cookies') || ''; } catch { return ''; } }
export function setCookies(v: 'all' | 'needed') { try { localStorage.setItem('muse:cookies', v); } catch {} }
export const cookiesAll = () => cookiesChoice() === 'all';

export function tellAndroid(playing: boolean, title: string) {
  if (!isAndroidApp) return;
  try { window.MuseAndroid?.playback?.(!!playing, String(title || 'Muse')); } catch {}
}
