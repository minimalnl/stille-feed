// Short Burnt Pix links. Run: node --test scripts/pix-link.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadPixLink() {
  const sandbox = { console, URLSearchParams, URL };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(new URL('../pix-link.js', import.meta.url), 'utf8'), sandbox, { filename: 'pix-link.js' });
  return sandbox.PixLink;
}
// Objects built inside the vm have that realm's prototypes; compare their data.
const data = (v) => JSON.parse(JSON.stringify(v));

const PixLink = loadPixLink();
const EXAMPLE = '0x0000000000000000000000009bf4ee85e0205431abcd06091ce98e65a48cd8e5';
const EXAMPLE_ADDR = '9bf4ee85e0205431abcd06091ce98e65a48cd8e5';
const OTHER = PixLink.tokenIdFromAddress('11111111e0205431abcd06091ce98e65a48cd8e5');
const COLLIDE = PixLink.tokenIdFromAddress('9bf4ee85aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

test('the example token id is a padded address, and the short form is its first 8 hex chars', () => {
  assert.equal(PixLink.OWNER, '0x7070b7cb8fae99b6c7ddd0eabe831dcb6c3047fd');
  assert.equal(PixLink.addressOf(EXAMPLE), EXAMPLE_ADDR);
  assert.equal(PixLink.shortOf(EXAMPLE), '9bf4ee85');
  assert.equal(PixLink.tokenIdFromAddress(EXAMPLE_ADDR), EXAMPLE);
  assert.equal(PixLink.normalizePix('9BF4EE85'), '9bf4ee85');
  assert.equal(PixLink.normalizePix('0x9bf4ee85'), '9bf4ee85');
  assert.equal(PixLink.normalizeId(EXAMPLE_ADDR), EXAMPLE_ADDR);
  assert.equal(PixLink.normalizeId(EXAMPLE), EXAMPLE_ADDR);
  assert.equal(PixLink.normalizeId('0x' + EXAMPLE_ADDR.toUpperCase()), EXAMPLE_ADDR);
});

test('?pix= resolves one piece, and the leading zeros of the token id are not part of the prefix', () => {
  const one = PixLink.resolve([OTHER, EXAMPLE], { pix: '9bf4ee85' });
  assert.deepEqual(data(one), { kind: 'one', ids: [EXAMPLE] });
  assert.equal(PixLink.resolve([EXAMPLE], { pix: '00000000' }).kind, 'none');
  assert.equal(PixLink.resolve([EXAMPLE.toUpperCase()], { pix: '9bf4ee85' }).ids[0], EXAMPLE);
});

test('?id= is the whole address and wins over a different ?pix=', () => {
  const byId = PixLink.resolve([OTHER, EXAMPLE], { id: EXAMPLE_ADDR, pix: '11111111' });
  assert.deepEqual(data(byId), { kind: 'one', ids: [EXAMPLE] });
  const full = PixLink.resolve([EXAMPLE], { id: EXAMPLE });
  assert.deepEqual(data(full), { kind: 'one', ids: [EXAMPLE] });
  const missing = PixLink.resolve([EXAMPLE], { id: OTHER.slice(2).slice(-40), pix: '9bf4ee85' });
  assert.equal(missing.kind, 'none');
});

test('a broken ?id= falls through to ?pix=, and a broken ?pix= does not open a piece', () => {
  assert.equal(PixLink.resolve([EXAMPLE], { id: 'nope', pix: '9bf4ee85' }).kind, 'one');
  assert.equal(PixLink.resolve([EXAMPLE], { pix: '9bf4ee8' }).kind, 'bad');
  assert.equal(PixLink.resolve([EXAMPLE], { pix: '9bf4ee85e' }).kind, 'bad');
  assert.equal(PixLink.resolve([EXAMPLE], { pix: '9bf4ee8g' }).kind, 'bad');
  assert.equal(PixLink.resolve([EXAMPLE], { id: '9bf4ee85' }).kind, 'bad');
  assert.equal(PixLink.resolve([EXAMPLE], {}).kind, 'absent');
  assert.equal(PixLink.resolve([EXAMPLE], { pix: '', id: '   ' }).kind, 'absent');
});

test('an ambiguous 8-hex prefix returns every match, in token-id order', () => {
  const many = PixLink.resolve([EXAMPLE, OTHER, COLLIDE], { pix: '9bf4ee85' });
  assert.equal(many.kind, 'many');
  assert.deepEqual(data(many.ids), [COLLIDE, EXAMPLE]);
});

test('query reading keeps the piece param and ignores a full id beside it', () => {
  const q = PixLink.readQuery('?pix=9bf4ee85&theme=zwart&address=0xeccedbdad7dae297d1ef1134cca43cdfc2857bd1');
  assert.equal(q.pix, '9bf4ee85');
  assert.equal(q.id, null);
});

test('biggest is most iterations, then the lowest token id, and next wraps', () => {
  const pieces = [
    { id: EXAMPLE, iterations: 1500000 },
    { id: OTHER, iterations: 7000000 },
    { id: COLLIDE, iterations: 7000000 },
  ];
  const ordered = PixLink.order(pieces);
  assert.deepEqual(data(ordered).map((p) => p.id), [OTHER, COLLIDE, EXAMPLE]);
  assert.equal(PixLink.biggest(pieces).id, OTHER);
  assert.equal(PixLink.nextPiece(pieces, OTHER).id, COLLIDE);
  assert.equal(PixLink.nextPiece(pieces, EXAMPLE).id, OTHER);
  assert.equal(PixLink.previousPiece(pieces, OTHER).id, EXAMPLE);
  assert.equal(PixLink.nextPiece([pieces[0]], pieces[0].id), null);
  const outside = PixLink.tokenIdFromAddress('ab'.repeat(20));
  assert.equal(PixLink.nextPiece(pieces, outside).id, OTHER);
  assert.equal(PixLink.previousPiece(pieces, outside), null);
});

test('unrefined pieces stay out of the grid order, the biggest, and the arrow', () => {
  const raw = [
    { id: EXAMPLE, iterations: 1500000 },
    { id: OTHER, iterations: 0 },
    { id: COLLIDE, iterations: null },
  ];
  const visible = PixLink.refined(raw);
  assert.deepEqual(data(visible).map((p) => p.id), [EXAMPLE]);
  assert.equal(PixLink.refined([{ id: OTHER, iterations: '0' }, { id: COLLIDE, iterations: '' }]).length, 0);
  assert.equal(PixLink.refined([{ id: EXAMPLE, iterations: '1500000' }])[0].id, EXAMPLE);
  assert.equal(PixLink.biggest(PixLink.refined([{ id: EXAMPLE, iterations: 0 }, { id: OTHER, iterations: null }])), null);
  const mixed = PixLink.order(PixLink.refined([
    { id: EXAMPLE, iterations: 1500000 },
    { id: OTHER, iterations: 0 },
    { id: COLLIDE, iterations: 4000000 },
  ]));
  assert.deepEqual(data(mixed).map((p) => p.id), [COLLIDE, EXAMPLE]);
  assert.equal(PixLink.biggest(mixed).id, COLLIDE);
  assert.equal(PixLink.nextPiece(mixed, COLLIDE).id, EXAMPLE);
  assert.equal(PixLink.nextPiece(mixed, EXAMPLE).id, COLLIDE);
});

test('the arrow continues from the opened piece instead of jumping to the biggest', () => {
  const pieces = [
    { id: EXAMPLE, iterations: 1500000 },
    { id: OTHER, iterations: 7000000 },
    { id: COLLIDE, iterations: 4000000 },
  ];
  assert.equal(PixLink.biggest(pieces).id, OTHER);
  assert.equal(PixLink.nextPiece(pieces, EXAMPLE).id, OTHER);
  assert.notEqual(PixLink.nextPiece(pieces, COLLIDE).id, OTHER);
  assert.equal(PixLink.nextPiece(pieces, COLLIDE).id, EXAMPLE);
});

test('a piece link keeps the profile and the theme', () => {
  const owner = '0xeccedbdad7dae297d1ef1134cca43cdfc2857bd1';
  const piece = PixLink.pieceHref('https://minimalnl.github.io/stille-feed/?theme=zwart&id=abc', EXAMPLE, owner);
  const pu = new URL(piece, 'https://minimalnl.github.io');
  assert.equal(pu.pathname, '/stille-feed/');
  assert.equal(pu.searchParams.get('pix'), '9bf4ee85');
  assert.equal(pu.searchParams.get('id'), null);
  assert.equal(pu.searchParams.get('address'), owner);
  assert.equal(pu.searchParams.get('theme'), 'zwart');
  const kept = PixLink.pieceHref('https://minimalnl.github.io/stille-feed/?pix=11111111&from=hup', EXAMPLE, owner);
  assert.equal(new URL(kept, 'https://minimalnl.github.io').searchParams.get('from'), 'hup');
  assert.equal(new URL(kept, 'https://minimalnl.github.io').searchParams.get('pix'), '9bf4ee85');
});

test('the page loads the linker and asks the feed to open a linked piece', () => {
  const root = new URL('..', import.meta.url);
  const html = fs.readFileSync(new URL('index.html', root), 'utf8');
  const pix = html.indexOf('src="pix-link.js"');
  const app = html.indexOf('src="app.js"');
  assert.ok(pix !== -1 && app !== -1 && pix < app);
  assert.match(html, /id="pixFocus"/);
  const appjs = fs.readFileSync(new URL('app.js', root), 'utf8');
  assert.match(appjs, /DEFAULT_ADDRESS = '0x7070b7cb8fae99b6c7ddd0eabe831dcb6c3047fd'/);
  assert.doesNotMatch(appjs, /eccedbdad7dae297d1ef1134cca43cdfc2857bd1/);
  assert.match(appjs, /function showPixFocus\(/);
  assert.match(appjs, /PixLink\.resolve/);
  assert.match(appjs, /showPixFocus\(\)/);
  assert.match(appjs, /PixLink\.biggest/);
  assert.match(appjs, /PixLink\.pieceHref/);
  assert.match(appjs, /fetchpriority="high"/);
  assert.match(appjs, /function holdHero\(/);
  assert.match(appjs, /rpcImmediate/);
  assert.match(appjs, /PixLink\.nextPiece/);
  assert.match(appjs, /PixLink\.refined/);
  assert.doesNotMatch(html, /id="pixCount"/);
  assert.doesNotMatch(appjs, /pixCount/);
  assert.match(appjs, /id="pixMore">Show more</);
  assert.doesNotMatch(appjs, /Show more \(\$\{rest\}\)/);
  assert.match(appjs, /barePieceLink/);
  assert.doesNotMatch(appjs, /arrowTarget|bareEntry/);
  assert.match(appjs, /searchParams\.delete\('pix'\)/);
  assert.match(html, /id="pixNext"/);
  assert.match(html, /id="chrome" class="chrome" hidden/);
  assert.match(html, /id="chromeToggle"[^>]*aria-label="Show header"/);
  assert.match(appjs, /saved === '0'/);
  assert.doesNotMatch(appjs, /let hide = false/);
  assert.match(html, /id="ggHint"/);
  assert.match(html, /id="socialToggle"/);
  assert.match(html, /class="social-mark"/);
  assert.match(html, /fill="#fff"/);
  assert.doesNotMatch(html, /socialSkull|skull/);
  const css = fs.readFileSync(new URL('style.css', root), 'utf8');
  assert.match(css, /#e04b4b/);
  assert.doesNotMatch(css, /\.pix-next\{[^}]*position:fixed/);
  assert.match(css, /\.pix-next\{[^}]*width:44px/);
  assert.match(css, /\.pix-next\{[^}]*border:0/);
  assert.match(css, /\.pix-next\{[^}]*color:var\(--muted\)/);
  assert.match(css, /\.pix-one a\.pix-shot,\.pix-one \.pix-empty\{[^}]*aspect-ratio:1\/1/);
  assert.match(css, /\.chrome-toggle\{[^}]*color:var\(--muted\)/);
  assert.match(css, /\.chrome-toggle\{[^}]*opacity:\.5/);
  assert.match(css, /body\.chrome-off \.chrome-toggle:active\{color:#e04b4b/);
  assert.match(css, /body:not\(\.chrome-off\) \.chrome-toggle\{color:#e04b4b/);
  assert.match(css, /\.social-toggle\{[^}]*color:#e04b4b/);
  assert.doesNotMatch(appjs, /class="tags"/);
  assert.doesNotMatch(css, /\.tags\{/);
  assert.doesNotMatch(css, /\.tag\{/);
  assert.doesNotMatch(css, /--tag:/);
  const focus = html.slice(html.indexOf('id="pixFocus"'), html.indexOf('id="profile"'));
  assert.match(focus, /id="chromeToggle"/);
  assert.match(focus, /circle cx="12" cy="12" r="9\.8" fill="currentColor"/);
  assert.doesNotMatch(focus, /seal-show|seal-hide|\+/);
  const back = focus.slice(focus.indexOf('id="pixBack"'), focus.indexOf('id="pixNext"'));
  assert.match(back, /aria-label="Back to post"/);
  assert.match(back, />exit</);
  assert.doesNotMatch(back, /<svg|<circle|social-mark/);
  const next = focus.slice(focus.indexOf('id="pixNext"'));
  assert.match(next, /stroke-width="1\.6"/);
  assert.doesNotMatch(next, /<circle/);
  assert.match(css, /\.pix-nav\{[^}]*justify-content:space-between/);
  assert.match(css, /\.pix-nav:not\(:has\(button:not\(\[hidden\]\)\)\)\{display:none\}/);
  assert.match(css, /\.pix-back\{[^}]*color:#e04b4b/);
  assert.match(css, /\.pix-back\{[^}]*font-size:13px/);
  assert.match(css, /\.pix-back\{[^}]*border:0/);
  assert.match(css, /\.pix-back\{[^}]*background:transparent/);
  assert.match(css, /\.pix-back\{[^}]*margin:0 0 0 14px/);
  assert.match(appjs, /window\.close\(\)/);
  assert.match(appjs, /PixLink\.exitFrom\(location\.search\)/);
  assert.doesNotMatch(css, /\.pix-back\{[^}]*(width:44px|border-radius|opacity:\.5)/);
  assert.match(css, /\.pix-next\{[^}]*margin:0 0 0 auto/);
  const priceRule = css.slice(css.indexOf('.pix-price{'), css.indexOf('}', css.indexOf('.pix-price{')));
  assert.match(priceRule, /color:var\(--ink\)/);
  assert.match(priceRule, /border:1px solid var\(--sage\)/);
  assert.match(priceRule, /border-radius:0/);
  assert.match(priceRule, /padding:1px 6px/);
  assert.match(priceRule, /text-decoration:none/);
  assert.doesNotMatch(priceRule, /background/);
  assert.match(css, /\.pix-price:hover\{[^}]*border-color:var\(--sage-d\)/);
  assert.match(html, /id="saleToggle"[^>]*>For sale</);
  assert.match(html, /id="saleClear"[^>]*hidden[^>]*>×</);
  assert.doesNotMatch(html.slice(html.indexOf('id="saleToggle"'), html.indexOf('id="saleClear"')), /\d/);
  const saleRule = css.slice(css.indexOf('.sale-toggle{'), css.indexOf('}', css.indexOf('.sale-toggle{')));
  assert.match(saleRule, /border:1px solid var\(--sage\)/);
  assert.match(saleRule, /border-radius:0/);
  assert.doesNotMatch(saleRule, /background:var/);
  assert.match(css, /\.sale-clear\{[^}]*color:#e04b4b/);
  assert.match(css, /\.sale-clear\{[^}]*border:0/);
  assert.match(css, /\.pix-total\{[^}]*color:var\(--muted\)/);
  const moreFn = appjs.slice(appjs.indexOf('function showMorePix'), appjs.indexOf('function noPieces'));
  assert.match(moreFn, /gridPieces\(\)/);
  assert.match(appjs, /pix\.pieces\.filter\(\(p\) => PixLink\.listingFor\(p\.id\)\)/);
  assert.match(appjs, /searchParams\.set\('sale', '1'\)/);
  assert.match(appjs, /history\.replaceState/);
  const moveFn = appjs.slice(appjs.indexOf('function movePix'), appjs.indexOf('async function idsOf'));
  assert.doesNotMatch(moveFn, /listingFor|saleOnly/);
  const totalFn = appjs.slice(appjs.indexOf('function rememberPixTotal'), appjs.indexOf('function pixTotalHtml'));
  assert.match(totalFn, /DEFAULT_ADDRESS/);
  assert.match(totalFn, /PixLink\.profileLine/);
  assert.doesNotMatch(totalFn, /rpc|fetch|getJSON|loadPixIterations/);
  assert.match(css, /\.pix-one-meta\{[^}]*font-size:13px/);
  assert.match(css, /\.pix-one-meta\{[^}]*justify-content:space-between/);
  assert.match(css, /\.pix-one-meta\{[^}]*flex-wrap:nowrap/);
  assert.doesNotMatch(css, /\.pix-links/);
  assert.match(css, /\.pix-cap\{[^}]*font-size:12px/);
  assert.match(css, /\.pix-cap\{[^}]*justify-content:space-between/);
  assert.match(css, /\.pix-cap\{[^}]*flex-wrap:nowrap/);
  assert.match(css, /\.pix-one-lead\{[^}]*white-space:nowrap/);
  assert.doesNotMatch(css, /\.pix-tile|\.pix-cap-sale/);
  assert.match(appjs, /class="pix-price"[^>]*target="_blank" rel="noopener"/);
  assert.match(appjs, /PixLink\.listingFor/);
  const priceFn = appjs.slice(appjs.indexOf('function priceSeal'), appjs.indexOf('function pixCard'));
  assert.doesNotMatch(priceFn, /eth_send|personal_sign|wallet/);
  const cardFn = appjs.slice(appjs.indexOf('function pixCard'), appjs.indexOf('function armPixCard'));
  assert.match(cardFn, /<\/a>\$\{sale\}<\/span>/);
  assert.match(cardFn, /<\/a><span class="pix-cap">/);
  assert.match(cardFn, /PixLink\.iterationsLabel/);
  assert.doesNotMatch(cardFn, /toLocaleString|pix-tile|position:absolute|pix-cap-sale| · /);
  const focusFn = appjs.slice(appjs.indexOf('function renderPixFocus'), appjs.indexOf('function writePixUrl'));
  assert.match(focusFn, /<span class="pix-one-lead"><span>\$\{esc\(PixLink\.iterationsLabel\(p\.iterations\) \+ suffix\)\}<\/span><a href="\$\{esc\(p\.link\)\}" target="_blank" rel="noopener">Universal Everything ↗<\/a><\/span>\$\{sale\}/);
  assert.doesNotMatch(focusFn, / · \$\{sale\}|pix-links/);
  assert.doesNotMatch(focusFn, /pix-owner|owner ↗|ownerHref/);
  assert.doesNotMatch(appjs, /pix-owner|ownerHref/);
  assert.match(css, /\.social-toggle\{[^}]*color:#e04b4b/);
  assert.match(appjs, /qf\.entryPix/);
  assert.match(appjs, /hist === 'replace'/);
  assert.match(appjs, /history\.back\(\)/);
  assert.match(appjs, /location\.href = action\.href/);
  assert.match(appjs, /presentPix\(nxt, 'stay'\)/);
  assert.match(appjs, /hist === 'push' \|\| hist === 'stay'/);
  assert.match(html, /<body class="chrome-off">/);
  assert.doesNotMatch(appjs, /function seatArrow/);
  assert.match(appjs, /\$\('#pixBody'\)/);
  assert.doesNotMatch(css, /margin-top:-40px/);
  assert.match(html, /id="gg"[^>]*hidden/);
  assert.match(appjs, /FEED_FIRST = 2/);
  assert.match(appjs, /feedShown: FEED_FIRST/);
  assert.match(appjs, /qf\.hideSocial/);
  assert.match(html, /id="themeMenu"[^>]*hidden/);
  assert.match(html, />Black</);
  assert.match(html, />White</);
  assert.match(html, />Art</);
  assert.doesNotMatch(html, />Kunstobject</);
  const grid = fs.readFileSync(new URL('grid-ad.js', root), 'utf8');
  assert.match(grid, /function loadKeccak\(/);
  assert.match(grid, /ggHint/);
  assert.doesNotMatch(grid, /IntersectionObserver/);
  const startAt = grid.indexOf('function start()');
  const importAt = grid.indexOf('https://esm.sh/@noble/hashes');
  assert.ok(startAt !== -1 && importAt !== -1 && importAt < startAt);
  assert.match(grid.slice(startAt), /loadKeccak\(\)/);
});

test('the collection reads Moments and Hup from the bot in every context', () => {
  const appjs = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const start = appjs.indexOf('function socialFor');
  const end = appjs.indexOf('function socialAddress');
  assert.ok(start !== -1 && end > start);
  const sandbox = {
    DEFAULT_ADDRESS: '0x7070b7cb8fae99b6c7ddd0eabe831dcb6c3047fd',
    DEFAULT_SOCIAL_ADDRESS: '0x040045d5e3e6abe7ac243af2618f5483525a1491',
    isAddr: (a) => /^0x[0-9a-fA-F]{40}$/.test(a || ''),
  };
  vm.createContext(sandbox);
  vm.runInContext(appjs.slice(start, end) + '\nthis.socialFor = socialFor;', sandbox);
  const bot = sandbox.DEFAULT_SOCIAL_ADDRESS;
  const mark = sandbox.DEFAULT_ADDRESS;
  const other = '0x2c49607ac2f84d168188a8b7ae2e147e746a7788';
  assert.equal(sandbox.socialFor(mark), bot);
  assert.equal(sandbox.socialFor(mark, other, '', null), bot);
  assert.equal(sandbox.socialFor(mark, null, mark, null), bot);
  assert.equal(sandbox.socialFor(mark, null, other, null), bot);
  assert.equal(sandbox.socialFor(mark, null, '', other), bot);
  assert.equal(sandbox.socialFor(other), other);
  assert.equal(sandbox.socialFor(other, mark, mark, mark), other);
  assert.doesNotMatch(appjs.slice(start, end), /if \(grid\) return who/);
  assert.match(appjs, /hupLogs\.get\(who\)/);
  assert.doesNotMatch(appjs, /hupLogs\.get\(address\)/);
  assert.doesNotMatch(appjs, /hupLogs\.get\(state\.address\)/);
  assert.match(appjs, /DEFAULT_SOCIAL_ADDRESS = '0x040045d5e3e6abe7ac243af2618f5483525a1491'/);
  assert.match(appjs, /loadMoments\(posts/);
  assert.match(appjs, /loadHup\(posts/);
  assert.match(appjs, /hup\.social\/\$\{esc\(state\.social \|\| state\.address\)\}/);
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /class="chrome-note"/);
  assert.match(html, /Add stille feed to your/);
  assert.match(html, /href="https:\/\/universaleverything\.io\/"/);
});

test('a ?pix= visit remembers an external referrer and chooses the back step', () => {
  const page = 'https://minimalnl.github.io/stille-feed/?pix=9bf4ee85';
  const hup = 'https://hup.social/0x040045d5e3e6abe7ac243af2618f5483525a1491/posts/1';
  const moment = 'https://www.forevermoments.life/moments/42';
  assert.equal(PixLink.entryPixFromSearch('?pix=9BF4EE85'), '9bf4ee85');
  assert.equal(PixLink.entryPixFromSearch('?pix=9bf4ee85&theme=0x7070b7cb8fae99b6c7ddd0eabe831dcb6c3047fd'), '9bf4ee85');
  assert.equal(PixLink.entryPixFromSearch(''), '');
  assert.equal(PixLink.entryPixFromSearch('?id=' + EXAMPLE_ADDR), '');
  assert.equal(PixLink.entryPixFromSearch('?pix=nope'), '');
  assert.equal(PixLink.entryPixFromSearch('?id=' + EXAMPLE_ADDR + '&pix=9bf4ee85'), '');
  assert.equal(PixLink.entryPixFromSearch('?pix=9bf4ee85&from=hup'), '9bf4ee85');
  assert.equal(PixLink.exitFrom('?pix=9bf4ee85&from=hup'), 'hup');
  assert.equal(PixLink.exitFrom('?pix=9bf4ee85&from=FM'), 'fm');
  assert.equal(PixLink.exitFrom('?pix=9bf4ee85&from=nope'), '');
  assert.equal(PixLink.exitFrom('?pix=9bf4ee85'), '');
  assert.equal(PixLink.exitFallback('hup', ''), 'https://hup.social');
  assert.equal(PixLink.exitFallback('fm', ''), 'https://www.forevermoments.life');
  assert.equal(PixLink.exitFallback('', 'https://hup.social/networks/42/1'), 'https://hup.social');
  assert.equal(PixLink.exitFallback('', 'https://example.com/post/1'), 'https://example.com');
  assert.equal(PixLink.exitFallback('', ''), '');
  assert.deepEqual(data(PixLink.entryRecord('?pix=9bf4ee85', hup, page, false)), { pix: '9bf4ee85', referrer: hup });
  assert.deepEqual(data(PixLink.entryRecord('?pix=9bf4ee85', moment, page, false)), { pix: '9bf4ee85', referrer: moment });
  assert.deepEqual(data(PixLink.entryRecord('?pix=9bf4ee85', page, page, false)), { pix: '9bf4ee85', referrer: '' });
  assert.deepEqual(data(PixLink.entryRecord('?pix=9bf4ee85', '', page, false)), { pix: '9bf4ee85', referrer: '' });
  assert.equal(PixLink.entryRecord('?pix=9bf4ee85', hup, page, true), null);
  assert.equal(PixLink.entryRecord('', hup, page, false), null);
  assert.equal(PixLink.entryRecord('?id=' + EXAMPLE_ADDR, hup, page, false), null);
  assert.equal(PixLink.externalReferrer('https://minimalnl.github.io/other', page), '');
  assert.equal(PixLink.externalReferrer('not a url', page), '');
  assert.equal(PixLink.backSealMode('', hup, '', false, 'pix'), 'hidden');
  assert.equal(PixLink.backSealMode('9bf4ee85', hup, '9bf4ee85', true, 'pix'), 'hidden');
  assert.equal(PixLink.backSealMode('9bf4ee85', hup, '9bf4ee85', false, 'absent'), 'hidden');
  assert.equal(PixLink.backSealMode('9bf4ee85', '', '9bf4ee85', false, 'pix'), 'post');
  assert.equal(PixLink.backSealMode('9bf4ee85', '', '', false, 'pix'), 'post');
  assert.equal(PixLink.backSealMode('9bf4ee85', hup, '9bf4ee85', false, 'pix'), 'post');
  assert.equal(PixLink.backSealMode('9bf4ee85', hup, '', false, 'pix'), 'post');
  assert.equal(PixLink.backSealMode('9bf4ee85', '', '11111111', false, 'pix'), 'piece');
  assert.equal(PixLink.backSealMode('9bf4ee85', hup, '11111111', false, 'id'), 'piece');
  assert.equal(PixLink.backSealMode('9bf4ee85', hup, '*', false, 'pix'), 'piece');
  assert.deepEqual(data(PixLink.backClick('9bf4ee85', hup, '11111111', 4, hup, 2, false, 'pix')), { kind: 'piece', pix: '9bf4ee85' });
  assert.deepEqual(data(PixLink.backClick('9bf4ee85', hup, '9bf4ee85', 2, hup, 2, false, 'pix')), { kind: 'back' });
  assert.deepEqual(data(PixLink.backClick('9bf4ee85', hup, '9bf4ee85', 1, hup, 1, false, 'pix')), { kind: 'href', href: hup });
  assert.deepEqual(data(PixLink.backClick('9bf4ee85', hup, '9bf4ee85', 4, hup, 2, false, 'pix')), { kind: 'href', href: hup });
  assert.deepEqual(data(PixLink.backClick('9bf4ee85', hup, '9bf4ee85', 2, 'https://www.forevermoments.life/moments/9', 2, false, 'pix')), { kind: 'href', href: hup });
  assert.deepEqual(data(PixLink.backClick('9bf4ee85', '', '9bf4ee85', 4, '', 2, false, 'pix')), { kind: 'back' });
  assert.deepEqual(data(PixLink.backClick('9bf4ee85', '', '9bf4ee85', 1, '', 1, false, 'pix', 'hup')), { kind: 'close', href: 'https://hup.social' });
  assert.deepEqual(data(PixLink.backClick('9bf4ee85', '', '9bf4ee85', 1, '', 1, false, 'pix', 'fm')), { kind: 'close', href: 'https://www.forevermoments.life' });
  assert.deepEqual(data(PixLink.backClick('9bf4ee85', '', '9bf4ee85', 1, '', 1, false, 'pix')), { kind: 'close', href: '' });
  assert.deepEqual(data(PixLink.backClick('9bf4ee85', '', '11111111', 1, '', 1, false, 'pix', 'hup')), { kind: 'piece', pix: '9bf4ee85' });
  assert.equal(PixLink.referrerOriginMatches(hup, 'https://hup.social/other'), true);
  assert.equal(PixLink.referrerOriginMatches(hup, moment), false);
  assert.equal(PixLink.referrerOriginMatches(hup, ''), false);
});

test('Hup sale prices match the verified listing ids', () => {
  assert.equal(PixLink.HUP_LISTINGS.length, 3);
  const fb84 = '0x00000000000000000000000026c8899b1ddd94a50b1f792283b03cef9a00fb84';
  const b538 = '0x0000000000000000000000000d80e5735fa76f020d5eae3a8c01dea7674db538';
  const fcdf = '0x0000000000000000000000008cb52d60b5e0d30dd3eb54c109f2033f846ffcdf';
  assert.deepEqual(data(PixLink.listingFor(fb84)), { label: '75 LYX', href: 'https://hup.social/nfts/42/1724' });
  assert.deepEqual(data(PixLink.listingFor(b538)), { label: '55 LYX', href: 'https://hup.social/nfts/42/1723' });
  assert.deepEqual(data(PixLink.listingFor(fcdf)), { label: '125 LYX', href: 'https://hup.social/nfts/42/1722' });
  assert.equal(PixLink.listingFor(fb84.toUpperCase()).label, '75 LYX');
  assert.equal(PixLink.listingFor('26c8899b1ddd94a50b1f792283b03cef9a00fb84').href, 'https://hup.social/nfts/42/1724');
  assert.equal(PixLink.listingFor(EXAMPLE), null);
  assert.equal(PixLink.listingFor(''), null);
  assert.equal(PixLink.listingFor('9a00fb84'), null);
});

test('iteration text is millions with two decimals', () => {
  assert.equal(PixLink.iterationsLabel(7000000), '7.00M iterations');
  assert.equal(PixLink.iterationsLabel(4000000), '4.00M iterations');
  assert.equal(PixLink.iterationsLabel(1234567), '1.23M iterations');
  assert.equal(PixLink.iterationsLabel(1500000), '1.50M iterations');
  assert.equal(PixLink.iterationsLabel('1500000'), '1.50M iterations');
  assert.equal(PixLink.iterationsLabel(850000), '0.85M iterations');
  assert.equal(PixLink.iterationsLabel(0), '0.00M iterations');
  assert.equal(PixLink.iterationsLabel(null), 'Burnt Pix');
  assert.equal(PixLink.iterationsLabel(''), 'Burnt Pix');
  assert.equal(PixLink.iterationsLabel('nope'), 'Burnt Pix');
  assert.equal(PixLink.iterationsTotal([
    { iterations: 7000000 },
    { iterations: 4000000 },
    { iterations: 0 },
    { iterations: null },
    { iterations: '1500000' },
  ]), 12500000);
  assert.equal(PixLink.iterationsLabel(PixLink.iterationsTotal([{ iterations: 12340000 }, { iterations: 0 }])), '12.34M iterations');
  assert.equal(PixLink.profileLine([
    { iterations: 7000000 },
    { iterations: 0 },
    { iterations: null },
    { iterations: '5340000' },
  ]), '2 refined, 12.34M iterations');
  assert.equal(PixLink.profileLine([]), '0 refined, 0.00M iterations');
});
