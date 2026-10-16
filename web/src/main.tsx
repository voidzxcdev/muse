import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import '@/hooks/theme';
import '@/lib/router';
import '@/lib/services';
import '@/player/store';
import App from './App';

// iOS only applies :active styles when a touchstart listener exists.
document.addEventListener('touchstart', () => {}, { passive: true });
// Warm the lazy route chunks after first paint so the first tab tap doesn't wait on the network.
const idle = (cb: () => void) => ((window as any).requestIdleCallback ? (window as any).requestIdleCallback(cb, { timeout: 3000 }) : setTimeout(cb, 1500));
window.addEventListener('load', () => idle(() => { import('@/views/friends'); import('@/views/library'); import('@/views/social'); import('@/views/search'); }));

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
