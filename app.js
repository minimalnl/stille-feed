// Quiet Feed — read-only, no wallet, no LYX.
const DEFAULT_ADDRESS = '0xeccedbdad7dae297d1ef1134cca43cdfc2857bd1'; // @mark op Hup (LUKSO mainnet UP)
const RPC = 'https://rpc.mainnet.lukso.network';
const IPFS = 'https://api.universalprofile.cloud/ipfs/';
const FM = 'https://www.forevermoments.life/api/public/v1';
// Hup's API stuurt geen CORS-headers; daarom eerst via de lokale proxy (serve.py), daarna direct.
const HUP_BASES = (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? ['/hup-api'] : []).concat('https://hup.social/api/v1');
const LSP3_KEY = '0x5ef83ad9559033e6e941db7d7c495acdce616347d28e90c7ce47cbfcfcad3bc5';
const PAGE = 12;
const BURNTPIX = '0x3983151e0442906000dab83c8b1cf3f2d2535f82'; // Burnt Pix (LSP8) op LUKSO mainnet
const LSP4_METADATA = '9afb95cacc9f95858ec44aa8c3b685511002e30ae54415823f406128b85b238e';
const PIX_PAGE = 6;

const $ = (s) => document.querySelector(s);
const pix = { pieces: [], shown: 0, gen: 0 };
const state = { address: null, items: [], filter: 'all', fmOffset: 0, fmMore: false, hupPage: 1, hupMore: false, notes: [] };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ipfs = (u) => !u ? '' : u.startsWith('ipfs://') ? IPFS + u.slice(7) : u.startsWith('/api/') ? 'https://hup.social' + u : u;
const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(a || '');
const short = (a) => a.slice(0, 6) + '…' + a.slice(-4);
const fmtDate = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

async function getJSON(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(r.status + ' ' + url);
  return r.json();
}

// ---------- LUKSO RPC ----------
async function rpcCall(to, data) {
  const res = await getJSON(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }) });
  if (res.error) throw new Error(res.error.message);
  return res.result;
}
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
async function loadLSP3(address) {
  const res = await getJSON(RPC, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: address, data: '0x54f6127f' + LSP3_KEY.slice(2) }, 'latest'] }),
  });
  if (res.error || !res.result || res.result === '0x') throw new Error('No Universal Profile');
  const url = decodeUrlFromValue(res.result);
  if (!url) throw new Error('No LSP3 profile');
  const json = url.startsWith('data:') ? await (await fetch(url)).json() : await getJSON(ipfs(url));
  const p = json.LSP3Profile || json;
  const imgs = [...(p.profileImage || [])].sort((a, b) => (a.width || 0) - (b.width || 0));
  const img = imgs.find((i) => (i.width || 0) >= 200) || imgs[imgs.length - 1];
  return { name: p.name, description: p.description, tags: p.tags || [], image: img ? ipfs(img.url) : '' };
}

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
  return d.pieces.map((p) => ({ id: p.id, iterations: p.iterations, img: p.thumb ? 'thumbs/' + p.thumb : '', link: pixLink(p.id) }));
}
function pixCard(p) {
  return `<a class="pix" href="${esc(p.link)}" target="_blank" rel="noopener" title="View this Burnt Pix">
    ${p.img ? `<img src="${esc(p.img)}" alt="Burnt Pix" loading="lazy">` : '<span class="pix-empty"></span>'}
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
    try { ids = await loadPixIds(address); } catch { return; }
    if (!ids.length || address !== state.address) return;
    sec.hidden = false;
    $('#pixCount').textContent = ids.length === 1 ? '1 piece' : `${ids.length} pieces`;
    $('#pixGrid').innerHTML = ''; $('#pixFoot').innerHTML = 'Loading iterations…';
    pieces = await Promise.all(ids.map(async (id) => ({ id, img: null, link: pixLink(id), iterations: await loadPixIterations(id).catch(() => 0) })));
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
let hupBase = null;
async function hupGet(path) {
  const bases = hupBase ? [hupBase] : HUP_BASES;
  let err;
  for (const b of bases) {
    try { const j = await getJSON(b + path); hupBase = b; return j; } catch (e) { err = e; }
  }
  throw err;
}
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
async function loadHupFromChain(address, limit) {
  const res = await getJSON(RPC, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getLogs', params: [{
      address: HUP_CONTRACT, fromBlock: '0x1', toBlock: 'latest',
      topics: [HUP_POST_EVENT, null, '0x000000000000000000000000' + address.slice(2).toLowerCase()]
    }] }),
  });
  const logs = (res.result || []).slice(-limit).reverse();
  const posts = await Promise.all(logs.map(async (log) => {
    try {
      const postId = parseInt(log.topics[1], 16);
      const networkId = parseInt(log.topics[3], 16) || 42;
      const buf = new Uint8Array(log.data.slice(2).match(/../g).map((b) => parseInt(b, 16)));
      const cid = extractIPFSCID(new TextDecoder().decode(buf));
      if (!cid) return null;
      const content = await getJSON(ipfs('ipfs://' + cid));
      const els = content.elements || [];
      const text = els.find((e) => e.type === 'text')?.data?.text || '';
      const media = els.find((e) => e.type === 'media')?.data?.items || [];
      const block = await getJSON(RPC, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBlockByNumber', params: [log.blockNumber, false] }),
      });
      const t = parseInt(block.result.timestamp, 16) * 1000;
      return {
        kind: 'hup', t, html: hupText(text),
        images: media.filter((m) => m.type === 'image' && m.cid).map((m) => ipfs(m.cid)).slice(0, 4),
        link: `https://hup.social/networks/${networkId}/${postId}`,
      };
    } catch { return null; }
  }));
  return posts.filter((p) => p);
}
async function loadHup(address, page) {
  if (page === 1) {
    try { return { more: false, items: await loadHupFromChain(address, PAGE) }; } catch (e) { console.warn('Hup chain load failed:', e); }
  }
  const d = await hupGet(`/networks/posts?wallet_address=${address}&network_id=42&post_type=original&limit=${PAGE}&page=${page}`);
  return {
    more: !!d.nextPage,
    items: (d.data || []).filter((p) => !p.is_deleted).map((p) => {
      const els = p.content?.elements || [];
      const text = els.find((e) => e.type === 'text')?.data?.text || '';
      const media = els.find((e) => e.type === 'media')?.data?.items || [];
      return {
        kind: 'hup', t: Date.parse(p.created_at), html: hupText(text),
        images: media.filter((m) => m.type === 'image' && m.cid).map((m) => ipfs(m.cid)).slice(0, 4),
        link: `https://hup.social/networks/${p.network_id}/${p.id}`,
      };
    }),
  };
}

// ---------- Render ----------
function renderProfile(p, address) {
  $('#profile').innerHTML = `
    ${p.image ? `<img class="avatar" src="${esc(p.image)}" alt="Profile picture of ${esc(p.name)}">` : `<img class="avatar" src="sun.svg" alt="">`}
    <h2>${esc(p.name || 'Unnamed profile')}</h2>
    <div class="addr" title="${esc(address)}">${esc(short(address))}</div>
    ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ''}
    ${p.tags.length ? `<div class="tags">${p.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}`;
}
function mediaHTML(imgs) {
  if (!imgs.length) return '';
  if (imgs.length === 1) return `<img class="media" loading="lazy" src="${esc(imgs[0])}" alt="">`;
  return `<div class="grid">${imgs.map((u) => `<img class="media" loading="lazy" src="${esc(u)}" alt="">`).join('')}</div>`;
}
function renderFeed() {
  const list = state.items.filter((i) => state.filter === 'all' || i.kind === state.filter).sort((a, b) => b.t - a.t);
  const hupNote = state.hupBlocked && state.filter !== 'moment' ? `<p class="note">This page can't load Hup posts directly.
    <a href="https://hup.social/${esc(state.address)}" target="_blank" rel="noopener">View the posts on Hup ↗</a></p>` : '';
  $('#feed').innerHTML = hupNote + (list.length ? list.map((i) => `
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
    </article>`).join('') : (hupNote ? '' : `<p class="empty">Nothing here yet.</p>`));
  const more = state.fmMore || state.hupMore;
  $('#status').innerHTML = (state.notes.length ? esc(state.notes.join(' ')) + ' ' : '') +
    (more ? `<button class="more" id="more">Load more</button>` : '');
  if (more) $('#more').onclick = loadMore;
}

async function fetchBatch() {
  const jobs = [];
  if (state.fmOffset === 0 || state.fmMore) jobs.push(loadMoments(state.address, state.fmOffset).then((r) => { state.fmOffset += PAGE; state.fmMore = r.more; return r.items; })
    .catch(() => { state.fmMore = false; state.notes.push('Forever Moments is unreachable right now.'); return []; }));
  if (state.hupPage === 1 || state.hupMore) jobs.push(loadHup(state.address, state.hupPage).then((r) => { state.hupPage += 1; state.hupMore = r.more; return r.items; })
    .catch((e) => { state.hupMore = false; if (state.hupPage === 1) state.hupBlocked = true; return []; }));
  const res = await Promise.all(jobs);
  state.items.push(...res.flat());
}
async function loadMore() { $('#status').textContent = 'One moment…'; state.notes = []; await fetchBatch(); renderFeed(); }

async function show(address) {
  Object.assign(state, { address, hupBlocked: false, items: [], fmOffset: 0, fmMore: false, hupPage: 1, hupMore: false, notes: [] });
  $('#formError').hidden = true;
  $('#addr').value = address;
  $('#filters').hidden = true;
  $('#profile').innerHTML = `<div class="skeleton" style="width:112px;height:112px;border-radius:50%;margin:0 auto"></div>`;
  $('#feed').innerHTML = `<div class="skeleton"></div><div class="skeleton"></div>`;
  $('#status').textContent = '';
  const profile = loadLSP3(address).then((p) => renderProfile(p, address)).catch(() => {
    $('#profile').innerHTML = `<img class="avatar" src="sun.svg" alt=""><h2>Unknown profile</h2><div class="addr">${esc(short(address))}</div>
      <p class="desc">No LSP3 profile found at this address on LUKSO mainnet.</p>`;
  });
  showPix(address);
  await Promise.all([profile, fetchBatch()]);
  $('#filters').hidden = false;
  renderFeed();
}

$('#form').addEventListener('submit', (e) => {
  e.preventDefault();
  const a = $('#addr').value.trim();
  if (!isAddr(a)) { $('#formError').textContent = 'That doesn\'t look like a valid address. It starts with 0x followed by 40 characters.'; $('#formError').hidden = false; return; }
  history.replaceState(null, '', '?address=' + a);
  show(a.toLowerCase());
});
$('#filters').addEventListener('click', (e) => {
  const f = e.target.dataset?.f; if (!f) return;
  state.filter = f;
  document.querySelectorAll('#filters button').forEach((b) => b.classList.toggle('on', b.dataset.f === f));
  renderFeed();
});

const qp = new URLSearchParams(location.search).get('address');
show(isAddr(qp) ? qp.toLowerCase() : DEFAULT_ADDRESS);
