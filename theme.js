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

  // Read theme from localStorage, URL parameter, or default (in that order)
  function getSavedTheme() {
    // Try localStorage first
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved && THEMES.includes(saved)) return saved;
    } catch (e) {
      // localStorage blocked or unavailable (e.g. Safari ITP in third-party iframe)
    }
    
    // Fall back to URL parameter (useful when localStorage is blocked)
    try {
      const urlTheme = new URLSearchParams(location.search).get('theme');
      if (urlTheme && THEMES.includes(urlTheme)) return urlTheme;
    } catch (e) {}
    
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

  // Set up click handlers once DOM is ready
  function initUI() {
    const switcher = document.querySelector('.theme-switch');
    if (!switcher) return;

    switcher.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-theme]');
      if (!btn) return;
      
      const theme = btn.dataset.theme;
      if (!THEMES.includes(theme)) return;
      
      applyTheme(theme);
      saveTheme(theme);
    });
  }

  // Initialize UI when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
  } else {
    initUI();
  }

  // Expose for debugging
  window.qfTheme = {
    get: getSavedTheme,
    set: (theme) => { applyTheme(theme); saveTheme(theme); },
    current: () => document.documentElement.getAttribute('data-theme'),
    inFrame: IN_FRAME,
  };
})();
