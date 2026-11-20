// Theme switcher for stille feed: Black, White, Art (cream/sage, default).
// The stored values stay the original Dutch keys so old links and saved choices keep working:
//   zwart, wit, kunstobject. English aliases black, white, art are accepted and stored as those keys.
// Persists the visitor's choice so it survives reloads and return visits, both on the standalone
// site and when the page runs as a mini-app inside the LUKSO Grid (iframe, window.parent !== window).
//
// Storage strategy:
// 1. localStorage (primary) — works on the standalone site and in iframes when allowed
// 2. URL parameter ?theme=… (fallback) — works when localStorage is blocked or partitioned
// 3. Default: kunstobject
//
// This script runs immediately (not deferred) to apply the saved theme before the body renders,
// avoiding a flash of the wrong theme on first paint.

(function() {
  const THEME_KEY = 'qf.theme';
  const DEFAULT_THEME = 'kunstobject';
  const CANONICAL = {
    zwart: 'zwart', black: 'zwart',
    wit: 'wit', white: 'wit',
    kunstobject: 'kunstobject', art: 'kunstobject',
  };
  const IN_FRAME = window.parent !== window;

  function canonicalTheme(v) {
    if (v == null) return null;
    return CANONICAL[String(v).trim().toLowerCase()] || null;
  }

  // Read theme from URL parameter (explicit), localStorage (saved), or default (in that order)
  function getSavedTheme() {
    // Check URL parameter first — an explicit ?theme= should override saved preference
    try {
      const urlTheme = canonicalTheme(new URLSearchParams(location.search).get('theme'));
      if (urlTheme) return urlTheme;
    } catch (e) {}

    // Fall back to localStorage (saved preference)
    try {
      const saved = canonicalTheme(localStorage.getItem(THEME_KEY));
      if (saved) return saved;
    } catch (e) {
      // localStorage blocked or unavailable (e.g. Safari ITP in third-party iframe)
    }

    return DEFAULT_THEME;
  }

  // Save theme to localStorage and optionally update URL. Always the canonical Dutch key.
  function saveTheme(theme, updateUrl = true) {
    theme = canonicalTheme(theme) || DEFAULT_THEME;
    // Try localStorage
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (e) {
      // If localStorage fails (blocked or full), we'll rely on the URL parameter
      console.warn('Theme: localStorage not available, using URL parameter');
    }

    // Update URL parameter as fallback (especially important in Grid where localStorage might be blocked)
    if (updateUrl) {
      try {
        const url = new URL(location.href);
        if (theme === DEFAULT_THEME) {
          url.searchParams.delete('theme');
        } else {
          url.searchParams.set('theme', theme);
        }
        history.replaceState(null, '', url);
      } catch (e) {
        console.warn('Theme: could not update URL');
      }
    }
  }

  function setMenu(open) {
    const menu = document.getElementById('themeMenu');
    const toggle = document.querySelector('.theme-toggle');
    if (menu) menu.hidden = !open;
    if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  // Apply theme to document
  function applyTheme(theme) {
    theme = canonicalTheme(theme) || DEFAULT_THEME;
    document.documentElement.setAttribute('data-theme', theme);

    // Update active button in the UI. The square that opens the menu has no data-theme.
    document.querySelectorAll('.theme-switch button[data-theme]').forEach(btn => {
      const isActive = btn.dataset.theme === theme;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    });
  }

  // An alias in the URL is rewritten to the canonical Dutch key. The default drops the param.
  function canonicalizeUrl(theme) {
    try {
      const url = new URL(location.href);
      if (!url.searchParams.has('theme')) return;
      const raw = url.searchParams.get('theme');
      if (!canonicalTheme(raw)) return;
      if (theme === DEFAULT_THEME) url.searchParams.delete('theme');
      else if (raw !== theme) url.searchParams.set('theme', theme);
      else return;
      history.replaceState(null, '', url);
    } catch (e) {}
  }

  // Initialize: apply saved theme immediately (before body renders)
  const currentTheme = getSavedTheme();
  applyTheme(currentTheme);
  canonicalizeUrl(currentTheme);

  // Click handler is delegated on document and registered immediately.
  // theme.js runs from <head>, before the switcher exists. Waiting for
  // DOMContentLoaded left the buttons visible but inert while deferred
  // scripts (app.js, grid-ad.js) were still loading.
  document.addEventListener('click', (e) => {
    const option = e.target.closest('.theme-switch button[data-theme]');
    if (option) {
      const theme = canonicalTheme(option.dataset.theme);
      if (!theme) return;
      applyTheme(theme);
      saveTheme(theme);
      setMenu(false);
      return;
    }
    if (e.target.closest('.theme-toggle')) {
      const menu = document.getElementById('themeMenu');
      setMenu(menu ? menu.hidden : false);
      return;
    }
    if (!e.target.closest('.theme-switch')) setMenu(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setMenu(false);
  });

  // Sync button states once the switcher exists.
  // theme.js runs before the buttons, so the first applyTheme cannot mark them.
  function syncButtonStates() {
    const theme = document.documentElement.getAttribute('data-theme') || DEFAULT_THEME;
    document.querySelectorAll('.theme-switch button[data-theme]').forEach(btn => {
      const isActive = btn.dataset.theme === theme;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    });
    setMenu(false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncButtonStates);
  } else {
    syncButtonStates();
  }

  // Expose for debugging
  window.qfTheme = {
    get: getSavedTheme,
    set: (theme) => { applyTheme(theme); saveTheme(theme); },
    current: () => document.documentElement.getAttribute('data-theme'),
    inFrame: IN_FRAME,
  };
})();
