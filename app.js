// Stille feed — alleen lezen, geen wallet, geen LYX.
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
const fmtDate = (ms) => new Date(ms).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });

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
  if (res.error || !res.result || res.result === '0x') throw new Error('Geen Universal Profile');
  const url = decodeUrlFromValue(res.result);
  if (!url) throw new Error('Geen LSP3-profiel');
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
async function loadPixMeta(id) {
  const url = decodeUrlFromValue(await rpcCall(BURNTPIX, '0x16e023b3' + id.slice(2) + LSP4_METADATA));
  const json = url.startsWith('data:') ? JSON.parse(url.slice(url.indexOf(',') + 1)) : await getJSON(ipfs(url));
  const md = json.LSP4Metadata || {};
  const img = (md.images || [])[0]?.[0]?.url || '';
  const it = (md.attributes || []).find((a) => a.key === 'Iterations')?.value;
  return { id, img, iterations: it, link: `https://universaleverything.io/asset/${BURNTPIX}/tokenId/${id}` };
}
function pixCard(p) {
  return `<a class="pix" href="${esc(p.link)}" target="_blank" rel="noopener" title="Bekijk deze Burnt Pix">
    ${p.img ? `<img src="${esc(p.img)}" alt="Burnt Pix" loading="lazy">` : '<span class="pix-empty"></span>'}
    <span class="pix-cap">${p.iterations != null ? Number(p.iterations).toLocaleString('nl-NL') + ' iteraties' : 'Burnt Pix'}</span></a>`;
}
async function showMorePix() {
  const gen = pix.gen;
  const next = pix.pieces.slice(pix.shown, pix.shown + PIX_PAGE);
  pix.shown += next.length;
  const btn = $('#pixMore'); if (btn) btn.textContent = 'Even geduld…';
  const grid = $('#pixGrid');
  next.forEach((p) => { grid.insertAdjacentHTML('beforeend', pixCard(p)); });
  if (gen !== pix.gen) return;
  const rest = pix.pieces.length - pix.shown;
  $('#pixFoot').innerHTML = rest > 0 ? `<button class="more" id="pixMore">Meer tonen (${rest})</button>` : '';
  if (rest > 0) $('#pixMore').onclick = showMorePix;
}
async function showPix(address) {
  pix.gen++; pix.pieces = []; pix.shown = 0;
  const sec = $('#pixSection'); sec.hidden = true;
  let ids = [];
  try { ids = await loadPixIds(address); } catch { return; }
  if (!ids.length || address !== state.address) return;
  sec.hidden = false;
  $('#pixCount').textContent = ids.length === 1 ? '1 stuk' : `${ids.length} stukken`;
  $('#pixGrid').innerHTML = ''; $('#pixFoot').innerHTML = 'Iteraties laden…';
  const gen = pix.gen;
  const pieces = await Promise.all(ids.map((id) => loadPixMeta(id).catch(() => null)));
  if (gen !== pix.gen || address !== state.address) return;
  pix.pieces = pieces.filter((p) => p).sort((a, b) => (b.iterations || 0) - (a.iterations || 0));
  $('#pixFoot').innerHTML = '';
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
async function loadHup(address, page) {
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
    ${p.image ? `<img class="avatar" src="${esc(p.image)}" alt="Profielfoto van ${esc(p.name)}">` : `<img class="avatar" src="sun.svg" alt="">`}
    <h2>${esc(p.name || 'Naamloos profiel')}</h2>
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
  const hupNote = state.hupBlocked && state.filter !== 'moment' ? `<p class="note">Hup-posts kan deze pagina niet rechtstreeks ophalen.
    <a href="https://hup.social/${esc(state.address)}" target="_blank" rel="noopener">Bekijk de posts op Hup ↗</a></p>` : '';
  $('#feed').innerHTML = hupNote + (list.length ? list.map((i) => `
    <article class="item">
      ${mediaHTML(i.images)}
      <div class="body">
        <div class="meta">
          <span class="kind ${i.kind}"><span class="dot"></span>${i.kind === 'moment' ? 'Moment' : 'Hup'}</span>
          <span>${fmtDate(i.t)}</span>
          ${i.collection ? `<span>· ${esc(i.collection)}</span>` : ''}
          <a class="open" href="${esc(i.link)}" target="_blank" rel="noopener">Bekijk ↗</a>
        </div>
        ${i.title ? `<h3>${esc(i.title)}</h3>` : ''}
        ${i.kind === 'moment' ? (i.text ? `<p class="text clamp">${esc(i.text)}</p>` : '') : `<p class="text">${i.html}</p>`}
      </div>
    </article>`).join('') : (hupNote ? '' : `<p class="empty">Hier is het nog stil.</p>`));
  const more = state.fmMore || state.hupMore;
  $('#status').innerHTML = (state.notes.length ? esc(state.notes.join(' ')) + ' ' : '') +
    (more ? `<button class="more" id="more">Meer laden</button>` : '');
  if (more) $('#more').onclick = loadMore;
}

async function fetchBatch() {
  const jobs = [];
  if (state.fmOffset === 0 || state.fmMore) jobs.push(loadMoments(state.address, state.fmOffset).then((r) => { state.fmOffset += PAGE; state.fmMore = r.more; return r.items; })
    .catch(() => { state.fmMore = false; state.notes.push('Forever Moments is nu niet bereikbaar.'); return []; }));
  if (state.hupPage === 1 || state.hupMore) jobs.push(loadHup(state.address, state.hupPage).then((r) => { state.hupPage += 1; state.hupMore = r.more; return r.items; })
    .catch(() => { state.hupMore = false; state.hupBlocked = true; return []; }));
  const res = await Promise.all(jobs);
  state.items.push(...res.flat());
}
async function loadMore() { $('#status').textContent = 'Even geduld…'; state.notes = []; await fetchBatch(); renderFeed(); }

async function show(address) {
  Object.assign(state, { address, hupBlocked: false, items: [], fmOffset: 0, fmMore: false, hupPage: 1, hupMore: false, notes: [] });
  $('#formError').hidden = true;
  $('#addr').value = address;
  $('#filters').hidden = true;
  $('#profile').innerHTML = `<div class="skeleton" style="width:112px;height:112px;border-radius:50%;margin:0 auto"></div>`;
  $('#feed').innerHTML = `<div class="skeleton"></div><div class="skeleton"></div>`;
  $('#status').textContent = '';
  const profile = loadLSP3(address).then((p) => renderProfile(p, address)).catch(() => {
    $('#profile').innerHTML = `<img class="avatar" src="sun.svg" alt=""><h2>Onbekend profiel</h2><div class="addr">${esc(short(address))}</div>
      <p class="desc">Op dit adres vond ik geen LSP3-profiel op het LUKSO mainnet.</p>`;
  });
  showPix(address);
  await Promise.all([profile, fetchBatch()]);
  $('#filters').hidden = false;
  renderFeed();
}

$('#form').addEventListener('submit', (e) => {
  e.preventDefault();
  const a = $('#addr').value.trim();
  if (!isAddr(a)) { $('#formError').textContent = 'Dat lijkt geen geldig adres. Een adres begint met 0x en heeft 40 tekens daarna.'; $('#formError').hidden = false; return; }
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
