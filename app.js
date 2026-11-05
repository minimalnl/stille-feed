// stille feed: read-only feed of one Universal Profile (the Generative Grid block in grid-ad.js is the only wallet part).
const DEFAULT_ADDRESS = '0xeccedbdad7dae297d1ef1134cca43cdfc2857bd1'; // @mark op Hup (LUKSO mainnet UP)
const RPC = 'https://rpc.mainnet.lukso.network';
const IPFS = 'https://api.universalprofile.cloud/ipfs/';
const FM = 'https://www.forevermoments.life/api/public/v1';
// Hup's API sends no CORS headers, so it is read through a proxy: serve.py locally (/hup-api), and on
// static hosting the Cloudflare Worker in worker/ (see worker/README.md). Paste its URL here, no trailing slash,
// e.g. 'https://quiet-feed-hup.<your-subdomain>.workers.dev'. Optional: Hup posts are read from the LUKSO chain
// first (incl. "Show more"); the proxy is only the fallback when the RPC can't give the post events.
const HUP_PROXY = '';
const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const HUP_BASE = LOCAL ? '/hup-api' : HUP_PROXY ? HUP_PROXY.replace(/\/+$/, '') + '/api/v1' : null;
const IMG = 'https://api.universalprofile.cloud/image/'; // IPFS image resizer (keeps the original format)
const SAVED_KEY = 'qf:address';
const IN_FRAME = window.parent !== window;
const LSP3_KEY = '0x5ef83ad9559033e6e941db7d7c495acdce616347d28e90c7ce47cbfcfcad3bc5';
const PAGE = 12;
const BURNTPIX = '0x3983151e0442906000dab83c8b1cf3f2d2535f82'; // Burnt Pix (LSP8) op LUKSO mainnet
const LSP4_METADATA = '9afb95cacc9f95858ec44aa8c3b685511002e30ae54415823f406128b85b238e';
const PIX_PAGE = 6;
const FEED_PAGE = 6;

const $ = (s) => document.querySelector(s);
const pix = { pieces: [], shown: 0, gen: 0 };
const state = { address: null, gen: 0, pending: 0, items: [], filter: 'moment', feedShown: FEED_PAGE, fmOffset: 0, fmMore: false, hupPage: 1, hupMore: false, notes: [] };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ipfs = (u) => !u ? '' : u.startsWith('ipfs://') ? IPFS + u.slice(7) : u.startsWith('/api/') ? 'https://hup.social' + u : u;
// IPFS images through the resizer (same format, just not bigger than needed); other URLs unchanged.
const cidOf = (u) => (String(u || '').match(/^ipfs:\/\/([A-Za-z0-9]+)/)
  || String(u || '').match(/\/ipfs\/([A-Za-z0-9]+)/)
  || String(u || '').match(/\/image\/([A-Za-z0-9]+)/) || [])[1];
const sized = (u, w) => { const c = cidOf(u); return c ? `${IMG}${c}?width=${w}` : ipfs(u); };
// When the UP cloud IPFS gateway 404s, try public gateways before giving up.
const IPFS_GATEWAYS = [
  'https://api.universalprofile.cloud/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://dweb.link/ipfs/',
  'https://w3s.link/ipfs/',
];
// Universal Everything's Envio indexer keeps a copy of LSP3 even when the CID is gone from IPFS.
const INDEXER = 'https://envio.lukso-mainnet.universal.tech/v1/graphql';
const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(a || '');
const short = (a) => a.slice(0, 6) + '…' + a.slice(-4);
const fmtDate = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

async function getJSON(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(r.status + ' ' + url);
  return r.json();
}

// ---------- Small cache (localStorage, with expiry; silently does nothing when storage is blocked) ----------
const cache = {
  get(k) {
    try {
      const v = JSON.parse(localStorage.getItem('qf:c:' + k));
      if (v && (!v.e || v.e > Date.now())) return v.v;
    } catch {}
    return undefined;
  },
  set(k, v, ttlMs) {
    const item = JSON.stringify({ v, e: ttlMs ? Date.now() + ttlMs : 0 });
    try { localStorage.setItem('qf:c:' + k, item); } catch {
      try { // full: drop our cached entries (never the saved address) and retry once
        Object.keys(localStorage).filter((x) => x.startsWith('qf:c:')).forEach((x) => localStorage.removeItem(x));
        localStorage.setItem('qf:c:' + k, item);
      } catch {}
    }
  },
};
const MIN = 60 * 1000;
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const v = await fn();
  cache.set(key, v, ttlMs);
  return v;
}

// ---------- LUKSO RPC (calls made in the same moment go out as one JSON-RPC batch) ----------
let rpcQueue = [];
function rpc(method, params) {
  return new Promise((resolve, reject) => {
    rpcQueue.push({ method, params, resolve, reject });
    if (rpcQueue.length === 1) setTimeout(flushRpc, 0);
  });
}
async function flushRpc() {
  const all = rpcQueue; rpcQueue = [];
  for (let i = 0; i < all.length; i += 40) {
    const part = all.slice(i, i + 40);
    try {
      const res = await getJSON(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(part.map((c, id) => ({ jsonrpc: '2.0', id, method: c.method, params: c.params }))) });
      const byId = new Map((Array.isArray(res) ? res : [res]).map((r) => [r.id, r]));
      part.forEach((c, id) => {
        const r = byId.get(id);
        if (!r) c.reject(new Error('No answer'));
        else if (r.error) c.reject(new Error(r.error.message));
        else c.resolve(r.result);
      });
    } catch (e) { part.forEach((c) => c.reject(e)); }
  }
}
const rpcCall = (to, data) => rpc('eth_call', [{ to, data }, 'latest']);
// ---------- LSP3 via LUKSO RPC ----------
function decodeUrlFromValue(hex) {
  // ABI-encoded bytes -> raw value
  const h = hex.slice(2);
  const len = parseInt(h.slice(64, 128), 16);
  const v = h.slice(128, 128 + len * 2);
  if (!v) return null;
  let urlHex;
  if (v.startsWith('0000')) { // VerifiableURI: 0x0000 + method(4) + hashLen(2) + hash + url
    const hashLen = parseInt(v.slice(12, 16), 16);
    urlHex = v.slice(16 + hashLen * 2);
  } else { // legacy JSONURL: method(4) + hash(32) + url
    urlHex = v.slice(8 + 64);
  }
  const bytes = new Uint8Array(urlHex.match(/../g).map((b) => parseInt(b, 16)));
  return new TextDecoder().decode(bytes);
}
async function fetchIpfsJson(url) {
  if (!url) throw new Error('No metadata URL');
  if (url.startsWith('data:')) return (await fetch(url)).json();
  const cid = cidOf(url) || (url.startsWith('ipfs://') ? url.slice(7) : null);
  if (!cid) return getJSON(ipfs(url));
  let last;
  for (const g of IPFS_GATEWAYS) {
    try { return await getJSON(g + cid); } catch (e) { last = e; }
  }
  throw last || new Error('IPFS unreachable');
}
async function loadLSP3FromIndex(address) {
  const query = `query($a:String!){ Profile(where:{id:{_eq:$a}}){ id name description tags profileImages { src width height url } } }`;
  const d = await getJSON(INDEXER, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: { a: address.toLowerCase() } }),
  });
  const p = (d.data && d.data.Profile || [])[0];
  if (!p || (!p.name && !(p.profileImages || []).length)) throw new Error('No indexed profile');
  const imgs = [...(p.profileImages || [])].sort((a, b) => (a.width || 0) - (b.width || 0));
  const img = imgs.find((i) => (i.width || 0) >= 224) || imgs[imgs.length - 1];
  const raw = (img && (img.src || img.url)) || '';
  return { name: p.name, description: p.description || '', tags: p.tags || [], image: raw ? sized(raw, 224) : '' };
}
function profileFromLSP3Json(json) {
  const p = json.LSP3Profile || json;
  const imgs = [...(p.profileImage || [])].sort((a, b) => (a.width || 0) - (b.width || 0));
  const img = imgs.find((i) => (i.width || 0) >= 224) || imgs[imgs.length - 1];
  return { name: p.name, description: p.description, tags: p.tags || [], image: img ? sized(img.url, 224) : '' };
}
// Prefer on-chain VerifiableURI → IPFS. If the CID is missing (common after a flaky pin), fall back to the
// LUKSO indexer that Universal Everything uses — same name and photo, without re-publishing.
const loadLSP3 = (address) => cached('lsp3:' + address, 10 * MIN, async () => {
  try {
    const result = await rpcCall(address, '0x54f6127f' + LSP3_KEY.slice(2));
    if (result && result !== '0x') {
      const url = decodeUrlFromValue(result);
      if (url) return profileFromLSP3Json(await fetchIpfsJson(url));
    }
  } catch (e) { console.warn('LSP3 via IPFS failed, trying indexer', e); }
  try { return await loadLSP3FromIndex(address); }
  catch (e) { console.warn('LSP3 via indexer failed', e); }
  throw new Error('No LSP3 profile');
});

// ---------- Burnt Pix (LSP8 tokenIdsOf + on-chain LSP4Metadata per token) ----------
async function loadPixIds(address) {
  const r = (await rpcCall(BURNTPIX, '0xa3b261f2' + address.slice(2).padStart(64, '0'))).slice(2);
  const n = parseInt(r.slice(64, 128), 16) || 0;
  return [...Array(n)].map((_, i) => '0x' + r.slice(128 + i * 64, 192 + i * 64));
}
const pixLink = (id) => `https://universaleverything.io/asset/${BURNTPIX}/tokenId/${id}`;
// Each tokenId is the address of its fractal contract; iterations() there is a 32-byte answer,
// so we can sort without downloading every piece's ~0.5 MB on-chain SVG.
async function loadPixIterations(id) {
  return Number(BigInt(await rpcCall('0x' + id.slice(-40), '0x4358d2be')));
}
async function loadPixMeta(id) {
  const url = decodeUrlFromValue(await rpcCall(BURNTPIX, '0x16e023b3' + id.slice(2) + LSP4_METADATA));
  const json = url.startsWith('data:') ? JSON.parse(url.slice(url.indexOf(',') + 1)) : await getJSON(ipfs(url));
  const md = json.LSP4Metadata || {};
  const img = (md.images || [])[0]?.[0]?.url || '';
  const it = (md.attributes || []).find((a) => a.key === 'Iterations')?.value;
  return { id, img, iterations: it, link: pixLink(id) };
}
// Cached thumbnails built by scripts/build-thumbs.mjs (GitHub Action) for the default profile.
async function loadPixCache(address) {
  const d = await getJSON('thumbs/index.json');
  if (d.address !== address.toLowerCase()) return null;
  return d.pieces.map((p) => ({ id: p.id, iterations: p.iterations, img: p.thumb ? 'thumbs/' + p.thumb : '', img1x: p.thumb1x ? 'thumbs/' + p.thumb1x : '', link: pixLink(p.id) }));
}
function pixCard(p) {
  const imgTag = p.img ? (p.img1x ? `<img src="${esc(p.img1x)}" srcset="${esc(p.img1x)} 1x, ${esc(p.img)} 2x" alt="Burnt Pix" loading="lazy" decoding="async">` : `<img src="${esc(p.img)}" alt="Burnt Pix" loading="lazy" decoding="async">`) : '<span class="pix-empty"></span>';
  return `<a class="pix" href="${esc(p.link)}" target="_blank" rel="noopener" title="View this Burnt Pix">
    ${imgTag}
    <span class="pix-cap">${p.iterations != null ? Number(p.iterations).toLocaleString('en-US') + ' iterations' : 'Burnt Pix'}</span></a>`;
}
async function showMorePix() {
  const gen = pix.gen;
  const next = pix.pieces.slice(pix.shown, pix.shown + PIX_PAGE);
  pix.shown += next.length;
  const btn = $('#pixMore'); if (btn) btn.textContent = 'One moment…';
  await Promise.all(next.map(async (p) => { if (p.img == null) Object.assign(p, await loadPixMeta(p.id).catch(() => ({ img: '' }))); }));
  if (gen !== pix.gen) return;
  const grid = $('#pixGrid');
  next.forEach((p) => { grid.insertAdjacentHTML('beforeend', pixCard(p)); });
  const rest = pix.pieces.length - pix.shown;
  $('#pixFoot').innerHTML = rest > 0 ? `<button class="more" id="pixMore">Show more (${rest})</button>` : '';
  if (rest > 0) $('#pixMore').onclick = showMorePix;
}
async function showPix(address) {
  pix.gen++; pix.pieces = []; pix.shown = 0;
  const gen = pix.gen;
  const sec = $('#pixSection'); sec.hidden = true;
  let pieces = await loadPixCache(address).catch(() => null);
  if (!pieces) {
    let ids = [];
    try { ids = await cached('pixids:' + address, 10 * MIN, () => loadPixIds(address)); } catch { return; }
    if (!ids.length || address !== state.address) return;
    sec.hidden = false;
    $('#pixCount').textContent = ids.length === 1 ? '1 piece' : `${ids.length} pieces`;
    $('#pixGrid').innerHTML = ''; $('#pixFoot').innerHTML = 'Loading iterations…';
    const its = await cached('pixit:' + address, 10 * MIN, async () =>
      Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await loadPixIterations(id).catch(() => 0)]))));
    pieces = ids.map((id) => ({ id, img: null, link: pixLink(id), iterations: its[id] || 0 }));
  }
  if (gen !== pix.gen || address !== state.address || !pieces.length) return;
  sec.hidden = false;
  $('#pixCount').textContent = pieces.length === 1 ? '1 piece' : `${pieces.length} pieces`;
  pix.pieces = pieces.sort((a, b) => (b.iterations || 0) - (a.iterations || 0));
  $('#pixGrid').innerHTML = ''; $('#pixFoot').innerHTML = '';
  await showMorePix();
}

// ---------- Forever Moments ----------
async function loadMoments(address, offset) {
  const d = await getJSON(`${FM}/moments?owner=${address}&limit=${PAGE}&offset=${offset}`);
  const ms = d.data?.moments || [];
  return {
    more: !!d.meta?.hasMore,
    items: ms.map((m) => ({
      kind: 'moment', t: (m.createdAt || 0) * 1000,
      title: m.title, text: m.description, collection: m.collection?.title,
      images: (m.media?.mediaItems || []).filter((x) => x.type === 'image').map((x) => x.url).slice(0, 4).concat(
        !(m.media?.mediaItems || []).length && m.media?.primaryUrl ? [m.media.primaryUrl] : []),
      link: `https://www.forevermoments.life/moments/${m.id}`,
    })),
  };
}

// ---------- Hup ----------
const HUP_CONTRACT = '0xf6eeC4e32a532b23ACC56b72865e79c79877CEc8';
const HUP_POST_EVENT = '0x2b0f8061dba8658af5020cdf9b9fbe0683e46889ba7255a2a14b30df824ed6d5';
function hupText(md) {
  return esc(md || '')
    .replace(/\[(@[^\]]+)\]\(\/0x[0-9a-fA-F]{40}\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}
function extractIPFSCID(data) {
  const m = data.match(/Qm[1-9A-HJ-NP-Za-km-z]{44}/);
  return m ? m[0] : null;
}
const hupImages = (media) => media.filter((m) => m.type === 'image' && m.cid).map((m) => 'ipfs://' + m.cid.replace(/^ipfs:\/\//, '')).slice(0, 4);
// First choice: the posts straight from the Hup contract's events (content on IPFS). One eth_getLogs returns
// all of them, so "Show more" pages through that list without any extra service.
const hupLogs = new Map(); // address -> Promise<logs, newest first>
async function loadHupFromChain(address, page) {
  if (!hupLogs.has(address)) {
    hupLogs.set(address, rpc('eth_getLogs', [{
      address: HUP_CONTRACT, fromBlock: '0x1', toBlock: 'latest',
      topics: [HUP_POST_EVENT, null, '0x000000000000000000000000' + address.slice(2).toLowerCase()],
    }]).then((l) => (l || []).reverse()).catch((e) => { hupLogs.delete(address); throw e; }));
  }
  const all = await hupLogs.get(address);
  const logs = all.slice((page - 1) * PAGE, page * PAGE);
  const posts = await Promise.all(logs.map(async (log) => {
    try {
      const postId = parseInt(log.topics[1], 16);
      const networkId = parseInt(log.topics[3], 16) || 42;
      const buf = new Uint8Array(log.data.slice(2).match(/../g).map((b) => parseInt(b, 16)));
      const cid = extractIPFSCID(new TextDecoder().decode(buf));
      if (!cid) return null;
      // IPFS content and block times never change: cache them for a week.
      const [content, t] = await Promise.all([
        cached('ipfs:' + cid, 7 * 24 * 60 * MIN, () => getJSON(ipfs('ipfs://' + cid))),
        cached('blk:' + log.blockNumber, 7 * 24 * 60 * MIN, async () =>
          parseInt((await rpc('eth_getBlockByNumber', [log.blockNumber, false])).timestamp, 16) * 1000),
      ]);
      const els = content.elements || [];
      const text = els.find((e) => e.type === 'text')?.data?.text || '';
      const media = els.find((e) => e.type === 'media')?.data?.items || [];
      return { kind: 'hup', t, html: hupText(text), images: hupImages(media), link: `https://hup.social/networks/${networkId}/${postId}` };
    } catch { return null; }
  }));
  return { more: all.length > page * PAGE, items: posts.filter((p) => p) };
}
// Fallback when the RPC can't give the events: the Hup API (no CORS, so only via serve.py locally or the
// Cloudflare Worker in worker/ once HUP_PROXY is set).
async function loadHupFromApi(address, page) {
  const d = await getJSON(`${HUP_BASE}/networks/posts?wallet_address=${address}&network_id=42&post_type=original&limit=${PAGE}&page=${page}`);
  return {
    more: !!d.nextPage,
    items: (d.data || []).filter((p) => !p.is_deleted).map((p) => {
      const els = p.content?.elements || [];
      const text = els.find((e) => e.type === 'text')?.data?.text || '';
      const media = els.find((e) => e.type === 'media')?.data?.items || [];
      return { kind: 'hup', t: Date.parse(p.created_at), html: hupText(text), images: hupImages(media),
        link: `https://hup.social/networks/${p.network_id}/${p.id}` };
    }),
  };
}
let hupSource = 'chain'; // per profile: 'chain' or 'api' (decided on page 1)
async function loadHup(address, page) {
  if (page === 1) hupSource = 'chain';
  if (hupSource === 'chain') {
    try { return await loadHupFromChain(address, page); } catch (e) {
      if (page > 1 || !HUP_BASE) throw e;
      console.warn('Hup events not available, using the API:', e);
      hupSource = 'api';
    }
  }
  return loadHupFromApi(address, page);
}

// ---------- Render ----------
function renderProfile(p, address) {
  $('#profile').innerHTML = `
    ${p.image ? `<img class="avatar" src="${esc(p.image)}" alt="Profile picture of ${esc(p.name)}" width="112" height="112" decoding="async">` : `<img class="avatar" src="sun.svg" alt="">`}
    <h2>${esc(p.name || 'Unnamed profile')}</h2>
    <div class="idrow">
      <button type="button" class="addr" data-addr="${esc(address)}" title="Copy ${esc(address)}" aria-label="Copy address ${esc(address)}">${esc(short(address))}</button>
      <a class="ue" href="https://universaleverything.io/${esc(address)}" target="_blank" rel="noopener" title="Open on Universal Everything">profile ↗</a>
    </div>
    ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ''}
    ${p.tags.length ? `<div class="tags">${p.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}`;
}
// Feed column is max 672 px wide: request 720 / 1440 px (sharp on retina) instead of the original,
// which can be several MB. If the resizer fails, the image falls back to the original once.
function mediaImg(u, w) {
  const c = cidOf(u);
  const orig = esc(ipfs(u));
  const src = c ? `${IMG}${c}?width=${w}` : orig;
  const set = c ? ` srcset="${IMG}${c}?width=${w} 1x, ${IMG}${c}?width=${w * 2} 2x"` : '';
  return `<img class="media" loading="lazy" decoding="async" src="${src}"${set} data-orig="${orig}" alt="">`;
}
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img.tagName === 'IMG' && img.dataset.orig && img.src !== img.dataset.orig) { img.removeAttribute('srcset'); img.src = img.dataset.orig; }
}, true);
function mediaHTML(imgs) {
  if (!imgs.length) return '';
  if (imgs.length === 1) return mediaImg(imgs[0], 720);
  return `<div class="grid">${imgs.map((u) => mediaImg(u, 360)).join('')}</div>`;
}
function renderFeed() {
  const list = state.items.filter((i) => state.filter === 'all' || i.kind === state.filter).sort((a, b) => b.t - a.t);
  const shown = list.slice(0, state.feedShown);
  const remaining = list.length - state.feedShown;
  const waiting = state.pending > 0;
  const hupNote = state.hupBlocked && state.filter !== 'moment' ? `<p class="note">Hup posts can't be loaded right now.
    <a href="https://hup.social/${esc(state.address)}" target="_blank" rel="noopener">View them on Hup ↗</a></p>` : '';
  $('#feed').innerHTML = hupNote + (shown.length ? shown.map((i) => `
    <article class="item">
      ${mediaHTML(i.images)}
      <div class="body">
        <div class="meta">
          <span class="kind ${i.kind}"><span class="dot"></span>${i.kind === 'moment' ? 'Moment' : 'Hup'}</span>
          <span>${fmtDate(i.t)}</span>
          ${i.collection ? `<span>· ${esc(i.collection)}</span>` : ''}
          <a class="open" href="${esc(i.link)}" target="_blank" rel="noopener">View ↗</a>
        </div>
        ${i.title ? `<h3>${esc(i.title)}</h3>` : ''}
        ${i.kind === 'moment' ? (i.text ? `<p class="text clamp">${esc(i.text)}</p>` : '') : `<p class="text">${i.html}</p>`}
      </div>
    </article>`).join('') : waiting ? `<div class="skeleton"></div><div class="skeleton"></div>` : (hupNote ? '' : `<p class="empty">Nothing here yet.</p>`));
  const apiMore = !waiting && (state.fmMore || state.hupMore);
  const showFeedMore = remaining > 0;
  $('#status').innerHTML = (state.notes.length ? esc(state.notes.join(' ')) + ' ' : '') +
    (showFeedMore ? `<button class="more" id="feedMore">Show more (${remaining})</button>` : '') +
    (!showFeedMore && apiMore ? `<button class="more" id="more">Show more</button>` : '');
  if (showFeedMore) $('#feedMore').onclick = () => { state.feedShown += FEED_PAGE; renderFeed(); };
  if (!showFeedMore && apiMore) $('#more').onclick = loadMore;
}

// Every source renders as soon as it arrives (Moments usually first), instead of waiting for the slowest.
function fetchBatch() {
  const gen = state.gen;
  const add = (items) => { if (gen !== state.gen) return; state.items.push(...items); };
  const done = () => { if (gen !== state.gen) return; state.pending--; renderFeed(); };
  const jobs = [];
  if (state.fmOffset === 0 || state.fmMore) jobs.push(loadMoments(state.address, state.fmOffset)
    .then((r) => { if (gen !== state.gen) return; state.fmOffset += PAGE; state.fmMore = r.more; add(r.items); })
    .catch(() => { if (gen !== state.gen) return; state.fmMore = false; state.notes.push('Forever Moments is unreachable right now.'); })
    .finally(done));
  if (state.hupPage === 1 || state.hupMore) jobs.push(loadHup(state.address, state.hupPage)
    .then((r) => { if (gen !== state.gen) return; state.hupPage += 1; state.hupMore = r.more; add(r.items); })
    .catch(() => { if (gen !== state.gen) return; state.hupMore = false; if (state.hupPage === 1) state.hupBlocked = true; })
    .finally(done));
  state.pending += jobs.length;
  return Promise.all(jobs);
}
// "Show more" after everything loaded is shown: fetch the next page from the sources that have one.
async function loadMore() {
  state.notes = [];
  $('#status').textContent = 'One moment…';
  state.feedShown = state.items.filter((i) => state.filter === 'all' || i.kind === state.filter).length + FEED_PAGE;
  await fetchBatch();
}

function show(address) {
  Object.assign(state, { address, gen: state.gen + 1, pending: 0, hupBlocked: false, items: [], feedShown: FEED_PAGE,
    fmOffset: 0, fmMore: false, hupPage: 1, hupMore: false, notes: [] });
  $('#formError').hidden = true;
  $('#addr').value = address;
  $('#filters').hidden = false;
  $('#profile').innerHTML = `<div class="skeleton" style="width:112px;height:112px;border-radius:50%;margin:0 auto"></div>`;
  $('#status').textContent = '';
  loadLSP3(address).then((p) => { if (address === state.address) renderProfile(p, address); }).catch(async () => {
    if (address !== state.address) return;
    let isContract = false;
    try { const code = await rpc('eth_getCode', [address, 'latest']); isContract = !!(code && code !== '0x'); } catch {}
    if (address !== state.address) return;
    const inspect = `https://universaleverything.io/${address}`;
    $('#profile').innerHTML = `<img class="avatar" src="sun.svg" alt="">
      <h2>${isContract ? 'Universal Profile' : 'Unknown address'}</h2>
      <div class="idrow">
      <button type="button" class="addr" data-addr="${esc(address)}" title="Copy ${esc(address)}" aria-label="Copy address ${esc(address)}">${esc(short(address))}</button>
      <a class="ue" href="https://universaleverything.io/${esc(address)}" target="_blank" rel="noopener" title="Open on Universal Everything">profile ↗</a>
    </div>
      <p class="desc">${isContract
        ? 'Profile metadata could not be loaded — the on-chain IPFS file may be missing. Burnt Pix, Moments, and Hup below still show when they exist.'
        : 'No Universal Profile contract at this address on LUKSO mainnet.'}</p>
      <p class="desc profile-links"><a href="${esc(inspect)}" target="_blank" rel="noopener">Open on Universal Everything ↗</a>${
        isContract ? ' · <a href="https://my.universalprofile.cloud" target="_blank" rel="noopener">Update profile in UP cloud ↗</a>' : ''
      }</p>`;
  });
  showPix(address);
  fetchBatch();
  renderFeed();
}

// ---------- Which profile? ----------
// 1. Inside the LUKSO Grid: the owner of the Grid (up-provider context account)
// 2. ?address=0x… in the link
// 3. the address this visitor chose earlier (saved in this browser)
// 4. the default profile
const store = {
  get() { try { const a = localStorage.getItem(SAVED_KEY); return isAddr(a) ? a.toLowerCase() : null; } catch { return null; } },
  set(a) { try { a ? localStorage.setItem(SAVED_KEY, a) : localStorage.removeItem(SAVED_KEY); } catch {} },
};
let chosenByVisitor = false;
let gridAddr = null; // owner of the Grid this feed sits on (null outside the Grid)

// One up-provider for the whole page (grid-ad.js uses the same one for minting). Only loaded inside an iframe.
window.qfUP = IN_FRAME ? import('https://esm.sh/@lukso/up-provider@0.3.5?bundle')
  .then((m) => m.createClientUPProvider()).catch((e) => { console.warn('up-provider not loaded', e); return null; }) : Promise.resolve(null);

// Resolves with the Grid owner's address, or null when this isn't the Grid (or it doesn't answer in time).
async function gridOwner(timeoutMs) {
  const up = await window.qfUP;
  if (!up) return null;
  const now = () => { const a = (up.contextAccounts || [])[0]; return isAddr(a) ? a.toLowerCase() : null; };
  up.on?.('contextAccountsChanged', (accs) => {
    const a = (accs || [])[0];
    if (!isAddr(a)) return;
    gridAddr = a.toLowerCase();
    if (!chosenByVisitor && gridAddr !== state.address) show(gridAddr);
  });
  if (now()) return now();
  return new Promise((done) => {
    const t = setTimeout(() => done(now()), timeoutMs);
    up.on?.('contextAccountsChanged', () => { if (now()) { clearTimeout(t); done(now()); } });
  });
}

function fallbackAddress() {
  const qp = new URLSearchParams(location.search).get('address');
  return isAddr(qp) ? qp.toLowerCase() : store.get() || DEFAULT_ADDRESS;
}

$('#form').addEventListener('submit', (e) => {
  e.preventDefault();
  const a = $('#addr').value.trim();
  if (!a) { // empty = forget the saved address, back to the Grid owner or the default
    store.set(null); chosenByVisitor = false;
    const u = new URL(location.href); u.searchParams.delete('address');
    history.replaceState(null, '', u);
    show(gridAddr || DEFAULT_ADDRESS);
    return;
  }
  if (!isAddr(a)) { $('#formError').textContent = 'That doesn\'t look like a valid address. It starts with 0x followed by 40 characters.'; $('#formError').hidden = false; return; }
  const addr = a.toLowerCase();
  chosenByVisitor = true;
  store.set(addr);
  const u = new URL(location.href); u.searchParams.set('address', addr);
  history.replaceState(null, '', u);
  show(addr);
});
$('#filters').addEventListener('click', (e) => {
  const f = e.target.dataset?.f; if (!f) return;
  state.filter = f;
  state.feedShown = FEED_PAGE;
  document.querySelectorAll('#filters button').forEach((b) => b.classList.toggle('on', b.dataset.f === f));
  renderFeed();
});

if (IN_FRAME) {
  $('#profile').innerHTML = `<div class="skeleton" style="width:112px;height:112px;border-radius:50%;margin:0 auto"></div>`;
  gridOwner(2500).then((owner) => { gridAddr = owner; show(owner || fallbackAddress()); });
} else {
  show(fallbackAddress());
}

// ---------- Header hide/show (remembered, like the address) ----------
(() => {
  const KEY = 'qf.hideHeader', btn = $('#chromeToggle');
  const apply = (hide) => {
    $('#chrome').hidden = hide; btn.textContent = hide ? 'show header' : 'hide header';
    btn.setAttribute('aria-expanded', String(!hide)); document.body.classList.toggle('chrome-off', hide);
  };
  let hide = false; try { hide = localStorage.getItem(KEY) === '1'; } catch {}
  apply(hide);
  btn.addEventListener('click', () => {
    hide = !hide; apply(hide);
    try { hide ? localStorage.setItem(KEY, '1') : localStorage.removeItem(KEY); } catch {}
  });
})();

// ---------- Click the address to copy it ----------
$('#profile').addEventListener('click', async (e) => {
  const b = e.target.closest('.addr[data-addr]'); if (!b) return;
  const full = b.dataset.addr, label = b.textContent;
  try { await navigator.clipboard.writeText(full); }
  catch { const t = document.createElement('textarea'); t.value = full; document.body.append(t); t.select();
    try { document.execCommand('copy'); } catch {} t.remove(); }
  b.textContent = 'copied'; b.classList.add('done');
  clearTimeout(b._t); b._t = setTimeout(() => { b.textContent = label; b.classList.remove('done'); }, 1400);
});
