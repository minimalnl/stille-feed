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

test('query reading and the owner link keep theme and drop the piece params', () => {
  const q = PixLink.readQuery('?pix=9bf4ee85&theme=zwart&address=0xeccedbdad7dae297d1ef1134cca43cdfc2857bd1');
  assert.equal(q.pix, '9bf4ee85');
  assert.equal(q.id, null);
  const href = PixLink.ownerHref('https://minimalnl.github.io/stille-feed/?pix=9bf4ee85&theme=zwart&id=abc');
  const u = new URL(href, 'https://minimalnl.github.io');
  assert.equal(u.pathname, '/stille-feed/');
  assert.equal(u.searchParams.get('address'), PixLink.OWNER);
  assert.equal(u.searchParams.get('theme'), 'zwart');
  assert.equal(u.searchParams.get('pix'), null);
  assert.equal(u.searchParams.get('id'), null);
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

test('a piece link keeps the profile and the theme, and an owner link can name that owner', () => {
  const owner = '0xeccedbdad7dae297d1ef1134cca43cdfc2857bd1';
  const piece = PixLink.pieceHref('https://minimalnl.github.io/stille-feed/?theme=zwart&id=abc', EXAMPLE, owner);
  const pu = new URL(piece, 'https://minimalnl.github.io');
  assert.equal(pu.pathname, '/stille-feed/');
  assert.equal(pu.searchParams.get('pix'), '9bf4ee85');
  assert.equal(pu.searchParams.get('id'), null);
  assert.equal(pu.searchParams.get('address'), owner);
  assert.equal(pu.searchParams.get('theme'), 'zwart');
  const href = PixLink.ownerHref('https://minimalnl.github.io/stille-feed/?pix=9bf4ee85&theme=wit', owner);
  const u = new URL(href, 'https://minimalnl.github.io');
  assert.equal(u.searchParams.get('address'), owner);
  assert.equal(u.searchParams.get('theme'), 'wit');
  assert.equal(u.searchParams.get('pix'), null);
  assert.equal(u.searchParams.get('id'), null);
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
  const next = focus.slice(focus.indexOf('id="pixNext"'));
  assert.match(next, /stroke-width="1\.6"/);
  assert.doesNotMatch(next, /<circle/);
  assert.match(appjs, /presentPix\(nxt, state\.address, 'stay'\)/);
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

test('the default view reads Moments and Hup from the bot profile', () => {
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
  assert.equal(sandbox.socialFor(mark, null, '', null), bot);
  assert.equal(sandbox.socialFor(mark, null, '', mark), bot);
  assert.equal(sandbox.socialFor(mark, other, '', null), mark);
  assert.equal(sandbox.socialFor(mark, null, mark, null), mark);
  assert.equal(sandbox.socialFor(mark, null, other, null), mark);
  assert.equal(sandbox.socialFor(mark, null, '', other), mark);
  assert.equal(sandbox.socialFor(other, null, '', null), other);
  assert.match(appjs, /DEFAULT_SOCIAL_ADDRESS = '0x040045d5e3e6abe7ac243af2618f5483525a1491'/);
  assert.match(appjs, /loadMoments\(posts/);
  assert.match(appjs, /loadHup\(posts/);
  assert.match(appjs, /hup\.social\/\$\{esc\(state\.social \|\| state\.address\)\}/);
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /class="chrome-note"/);
  assert.match(html, /Add stille feed to your/);
  assert.match(html, /href="https:\/\/universaleverything\.io\/"/);
});

test('iteration text matches the feed', () => {
  assert.equal(PixLink.iterationsLabel(1500000), '1,500,000 iterations');
  assert.equal(PixLink.iterationsLabel('1500000'), '1,500,000 iterations');
  assert.equal(PixLink.iterationsLabel(0), '0 iterations');
  assert.equal(PixLink.iterationsLabel(null), 'Burnt Pix');
  assert.equal(PixLink.iterationsLabel(''), 'Burnt Pix');
});
