// Theme keys and the collapsed switcher. Run: node --test scripts/theme.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadTheme({ search = '', stored = null } = {}) {
  const store = new Map();
  if (stored != null) store.set('qf.theme', stored);
  const attrs = {};
  const listeners = {};
  let href = 'https://minimalnl.github.io/stille-feed/' + (search ? (search.startsWith('?') ? search : '?' + search) : '');
  const sandbox = {
    console,
    URL,
    URLSearchParams,
    document: {
      documentElement: {
        setAttribute(k, v) { attrs[k] = v; },
        getAttribute(k) { return attrs[k] || null; },
      },
      readyState: 'complete',
      addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
      querySelectorAll() { return []; },
      querySelector() { return null; },
      getElementById() { return null; },
    },
    location: {
      get search() { return new URL(href).search; },
      get href() { return href; },
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
    },
    history: {
      replaceState(_s, _t, url) { href = String(url); },
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(new URL('../theme.js', import.meta.url), 'utf8'), sandbox, { filename: 'theme.js' });
  return { sandbox, attrs, store, href: () => href };
}

test('english aliases apply and are stored as the dutch keys', () => {
  const theme = loadTheme({ search: '?theme=White&pix=9bf4ee85' });
  assert.equal(theme.attrs['data-theme'], 'wit');
  const rewritten = new URL(theme.href());
  assert.equal(rewritten.searchParams.get('theme'), 'wit');
  assert.equal(rewritten.searchParams.get('pix'), '9bf4ee85');
  assert.equal(theme.sandbox.qfTheme.current(), 'wit');
  assert.equal(theme.sandbox.qfTheme.get(), 'wit');
  theme.sandbox.qfTheme.set('art');
  assert.equal(theme.store.get('qf.theme'), 'kunstobject');
  assert.equal(theme.sandbox.qfTheme.current(), 'kunstobject');
  assert.equal(new URL(theme.href()).searchParams.get('theme'), null);
  theme.sandbox.qfTheme.set('black');
  assert.equal(theme.store.get('qf.theme'), 'zwart');
  assert.equal(new URL(theme.href()).searchParams.get('theme'), 'zwart');
  theme.sandbox.qfTheme.set('WHITE');
  assert.equal(theme.store.get('qf.theme'), 'wit');
  assert.equal(theme.attrs['data-theme'], 'wit');
});

test('a saved qf.theme still applies when the url has no theme', () => {
  const theme = loadTheme({ stored: 'zwart' });
  assert.equal(theme.attrs['data-theme'], 'zwart');
  assert.equal(theme.sandbox.qfTheme.get(), 'zwart');
});

test('an explicit url theme wins over a different saved theme', () => {
  const theme = loadTheme({ search: '?theme=art', stored: 'zwart' });
  assert.equal(theme.attrs['data-theme'], 'kunstobject');
  assert.equal(new URL(theme.href()).searchParams.get('theme'), null);
});

test('the switcher is a collapsed square and the click handler is not deferred', () => {
  const src = fs.readFileSync(new URL('../theme.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(src, /THEME_KEY = 'qf\.theme'/);
  assert.match(src, /document\.addEventListener\('click'/);
  assert.doesNotMatch(src, /DOMContentLoaded',\s*\(e\)\s*=>\s*\{[\s\S]*theme-switch button\[data-theme\]/);
  assert.match(html, /class="theme-toggle"/);
  assert.match(html, /id="themeMenu"[^>]*hidden/);
  assert.match(html, /data-theme="zwart"/);
  assert.match(html, /data-theme="wit"/);
  assert.match(html, /data-theme="kunstobject"/);
});
