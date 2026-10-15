import * as React from 'react';

/* Keeps inputs above the on-screen keyboard.
   Android Chrome resizes the layout (interactive-widget=resizes-content); iOS Safari and some WebViews
   only shrink the visual viewport. We size the app shell to visualViewport.height and flag
   html.kb-open so the tab bar / mini player step aside while typing. */
export function useKeyboardInset() {
  React.useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let raf = 0;
    const apply = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const gap = window.innerHeight - vv.height;
        const el = document.activeElement as HTMLElement | null;
        const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
        const open = typing && gap > 120;
        root.classList.toggle('kb-open', open);
        if (open) root.style.setProperty('--app-h', `${Math.round(vv.height)}px`); else root.style.removeProperty('--app-h');
        if (window.scrollY) window.scrollTo(0, 0); // iOS pans the layout viewport; keep the shell pinned
        if (open && el) el.scrollIntoView({ block: 'nearest' });
      });
    };
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    window.addEventListener('focusin', apply);
    window.addEventListener('focusout', apply);
    return () => { vv.removeEventListener('resize', apply); vv.removeEventListener('scroll', apply); window.removeEventListener('focusin', apply); window.removeEventListener('focusout', apply); cancelAnimationFrame(raf); };
  }, []);
}
