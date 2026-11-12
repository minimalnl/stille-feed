// Theme switcher for stille feed: Zwart (dark), Wit (light), Kunstobject (cream/sage, default).
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
  const THEMES = ['zwart', 'wit', 'kunstobject'];
  const DEFAULT_THEME = 'kunstobject';
  const IN_FRAME = window.parent !== window;

  // Read theme from URL parameter (explicit), localStorage (saved), or default (in that order)
  function getSavedTheme() {
    // Check URL parameter first — an explicit ?theme= should override saved preference
    try {
      const urlTheme = new URLSearchParams(location.search).get('theme');
      if (urlTheme && THEMES.includes(urlTheme)) return urlTheme;
    } catch (e) {}
    
    // Fall back to localStorage (saved preference)
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved && THEMES.includes(saved)) return saved;
    } catch (e) {
      // localStorage blocked or unavailable (e.g. Safari ITP in third-party iframe)
    }
    
    return DEFAULT_THEME;
  }

  // Save theme to localStorage and optionally update URL
  function saveTheme(theme, updateUrl = true) {
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

  // Apply theme to document
  function applyTheme(theme) {
    if (!THEMES.includes(theme)) theme = DEFAULT_THEME;
    document.documentElement.setAttribute('data-theme', theme);
    
    // Update active button in the UI
    document.querySelectorAll('.theme-switch button').forEach(btn => {
      const isActive = btn.dataset.theme === theme;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    });
  }

  // Initialize: apply saved theme immediately (before body renders)
  const currentTheme = getSavedTheme();
  applyTheme(currentTheme);

  // Click handler is delegated on document and registered immediately.
  // theme.js runs from <head>, before the switcher exists. Waiting for
  // DOMContentLoaded left the buttons visible but inert while deferred
  // scripts (app.js, grid-ad.js) were still loading.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.theme-switch button[data-theme]');
    if (!btn) return;

    const theme = btn.dataset.theme;
    if (!THEMES.includes(theme)) return;

    applyTheme(theme);
    saveTheme(theme);
  });

  // Sync button states once the switcher exists.
  // theme.js runs before the buttons, so the first applyTheme cannot mark them.
  function syncButtonStates() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || DEFAULT_THEME;
    document.querySelectorAll('.theme-switch button').forEach(btn => {
      const isActive = btn.dataset.theme === currentTheme;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    });
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
