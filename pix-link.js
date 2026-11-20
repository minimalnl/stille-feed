// Short links to one Burnt Pix in Mark's collection.
// A Burnt Pix tokenId is bytes32: 12 zero bytes, then the 20-byte address of that piece's fractal contract.
//   ?pix=<first 8 hex chars of that address>     short form, for posts
//   ?id=<last 40 hex chars of the tokenId>       the whole address, unambiguous
// A 64-hex tokenId is also accepted for ?id=; the address is still the last 40 hex chars.
// A link is resolved in the profile on screen first, then in Mark's collection 0x7070…47FD,
// so an old ?pix= link still opens when the feed itself is a different profile.
// With no ?pix= or ?id=, the profile's biggest piece leads (most iterations, then lowest token id).
// 8 hex chars are unique across that collection today. If two pieces ever share a prefix, every match
// is returned, ordered by token id (address ascending) — nothing is dropped and nothing is guessed.
(function () {
  const OWNER = '0x7070b7cb8fae99b6c7ddd0eabe831dcb6c3047fd';

  function clean(v) {
    if (v == null) return '';
    return String(v).trim().toLowerCase().replace(/^0x/, '');
  }
  function blank(v) {
    return v == null || String(v).trim() === '';
  }
  function normalizePix(v) {
    const s = clean(v);
    return /^[0-9a-f]{8}$/.test(s) ? s : null;
  }
  function normalizeId(v) {
    const s = clean(v);
    if (/^[0-9a-f]{40}$/.test(s)) return s;
    if (/^[0-9a-f]{64}$/.test(s)) return s.slice(-40);
    return null;
  }
  function addressOf(tokenId) {
    const s = clean(tokenId);
    return /^[0-9a-f]{64}$/.test(s) ? s.slice(-40) : null;
  }
  function tokenIdFromAddress(addr) {
    const s = clean(addr);
    if (!/^[0-9a-f]{40}$/.test(s)) return null;
    return '0x' + s.padStart(64, '0');
  }
  function shortOf(tokenId) {
    const a = addressOf(tokenId);
    return a ? a.slice(0, 8) : null;
  }
  // Which param to honour. A well-formed ?id= wins over ?pix=. A broken ?id= falls through to ?pix=.
  function plan(query) {
    const q = query || {};
    const hasPix = !blank(q.pix);
    const hasId = !blank(q.id);
    if (!hasPix && !hasId) return { kind: 'absent' };
    if (hasId) {
      const id = normalizeId(q.id);
      if (id) return { kind: 'id', id };
    }
    if (hasPix) {
      const pix = normalizePix(q.pix);
      if (pix) return { kind: 'pix', pix };
    }
    return { kind: 'bad' };
  }
  function resolve(ids, query) {
    const p = plan(query);
    if (p.kind === 'absent' || p.kind === 'bad') return { kind: p.kind, ids: [] };
    const list = [];
    for (const raw of ids || []) {
      const address = addressOf(raw);
      if (!address) continue;
      const id = tokenIdFromAddress(address);
      if (id) list.push({ id, address });
    }
    if (p.kind === 'id') {
      const hit = list.find((x) => x.address === p.id);
      return hit ? { kind: 'one', ids: [hit.id] } : { kind: 'none', ids: [] };
    }
    const hits = list.filter((x) => x.address.startsWith(p.pix));
    hits.sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));
    if (!hits.length) return { kind: 'none', ids: [] };
    if (hits.length === 1) return { kind: 'one', ids: [hits[0].id] };
    return { kind: 'many', ids: hits.map((h) => h.id) };
  }
  function readQuery(search) {
    const q = new URLSearchParams(String(search || '').replace(/^\?/, ''));
    return { pix: q.get('pix'), id: q.get('id') };
  }
  function iterationsLabel(value) {
    if (value == null || value === '') return 'Burnt Pix';
    const n = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isFinite(n)) return 'Burnt Pix';
    return n.toLocaleString('en-US') + ' iterations';
  }
  // Most iterations first. Ties break on the token address, lowest first, so the leader is stable.
  function order(pieces) {
    return [...(pieces || [])].map((p, i) => ({ p, i })).sort((a, b) => {
      const d = (Number(b.p.iterations) || 0) - (Number(a.p.iterations) || 0);
      if (d) return d;
      const aa = addressOf(a.p.id) || '';
      const bb = addressOf(b.p.id) || '';
      if (aa !== bb) return aa < bb ? -1 : 1;
      return a.i - b.i;
    }).map((x) => x.p);
  }
  function biggest(pieces) {
    return order(pieces)[0] || null;
  }
  // 0 iterations is unrefined. null, once the count has loaded, means the same and stays out of the list.
  function refined(pieces) {
    return (pieces || []).filter((p) => {
      const value = p && p.iterations;
      if (value == null || value === '') return false;
      const n = typeof value === 'number' ? value : Number(String(value).trim());
      return Number.isFinite(n) && n > 0;
    });
  }
  // step +1 is the next-smaller piece (the arrow). The list wraps, so the smallest leads back to the biggest.
  function stepPiece(pieces, currentId, step) {
    const sorted = order(pieces);
    if (sorted.length < 2) return null;
    const cur = addressOf(currentId);
    const i = sorted.findIndex((p) => addressOf(p.id) === cur);
    const dir = step < 0 ? -1 : 1;
    if (i < 0) return dir < 0 ? null : sorted[0];
    return sorted[(i + dir + sorted.length) % sorted.length];
  }
  function nextPiece(pieces, currentId) { return stepPiece(pieces, currentId, 1); }
  function previousPiece(pieces, currentId) { return stepPiece(pieces, currentId, -1); }
  function addressParam(owner) {
    const s = clean(owner || '');
    return /^[0-9a-f]{40}$/.test(s) ? '0x' + s : null;
  }
  // Same-site link to a profile, without a piece selected, so that profile's biggest pix leads.
  function ownerHref(href, owner) {
    const u = new URL(href, 'https://minimalnl.github.io');
    u.searchParams.set('address', addressParam(owner) || OWNER);
    u.searchParams.delete('pix');
    u.searchParams.delete('id');
    return `${u.pathname}${u.search}${u.hash}`;
  }
  // Shareable link to one piece. Uses the short ?pix= form and keeps the profile in ?address=.
  function pieceHref(href, tokenId, owner) {
    const u = new URL(href, 'https://minimalnl.github.io');
    const short = shortOf(tokenId);
    if (short) {
      u.searchParams.set('pix', short);
      u.searchParams.delete('id');
    }
    const who = addressParam(owner);
    if (who) u.searchParams.set('address', who);
    return `${u.pathname}${u.search}${u.hash}`;
  }

  // A visit counts only when the URL was opened with a well-formed ?pix=.
  // ?id= alone is a different link, and a Grid frame is not this trail.
  function entryPixFromSearch(search) {
    const decided = plan(readQuery(search));
    return decided.kind === 'pix' ? decided.pix : '';
  }
  // Another site (a Hup post, a Forever Moment). Same-origin and empty referrers are not stored.
  function externalReferrer(referrer, pageHref) {
    const raw = String(referrer || '').trim();
    if (!raw) return '';
    try {
      const ref = new URL(raw);
      const page = new URL(pageHref);
      if (!ref.origin || ref.origin === 'null' || ref.origin === page.origin) return '';
      return ref.href;
    } catch { return ''; }
  }
  function entryRecord(search, referrer, pageHref, inFrame) {
    if (inFrame) return null;
    const pix = entryPixFromSearch(search);
    if (!pix) return null;
    return { pix, referrer: externalReferrer(referrer, pageHref) };
  }
  // The live document.referrer still names the same site we stored at arrival.
  function referrerOriginMatches(stored, liveReferrer) {
    try {
      if (!stored || !liveReferrer) return false;
      const a = new URL(stored);
      const b = new URL(liveReferrer);
      return !!a.origin && a.origin !== 'null' && a.origin === b.origin;
    } catch { return false; }
  }
  // 'hidden' | 'piece' (return to the entry pix) | 'post' (leave for the referrer).
  // currentShort '*' means several pieces are open. '' means the picture is not drawn yet.
  function backSealMode(entryPix, referrer, currentShort, inFrame, linkKind) {
    const entry = normalizePix(entryPix);
    if (inFrame || !entry) return 'hidden';
    if (linkKind !== 'pix' && linkKind !== 'id') return 'hidden';
    if (currentShort === '*') return 'piece';
    const cur = normalizePix(currentShort) || '';
    if (cur && cur !== entry) return 'piece';
    return String(referrer || '').trim() ? 'post' : 'hidden';
  }
  // On the entry pix, history.back() is the post only while this document is still the
  // arrival history entry (nothing has been pushed since). After the arrow pushState's,
  // the previous entry is another pix, so the stored referrer URL is the way out.
  function backClick(entryPix, referrer, currentShort, historyLength, liveReferrer, entryHist, inFrame, linkKind) {
    const mode = backSealMode(entryPix, referrer, currentShort, inFrame, linkKind);
    if (mode === 'piece') return { kind: 'piece', pix: normalizePix(entryPix) };
    if (mode !== 'post') return { kind: 'none' };
    const len = Number(historyLength);
    const atArrival = Number(entryHist) > 1 && len === Number(entryHist);
    if (atArrival && len > 1 && referrerOriginMatches(referrer, liveReferrer)) return { kind: 'back' };
    return { kind: 'href', href: String(referrer) };
  }

  globalThis.PixLink = {
    OWNER, normalizePix, normalizeId, addressOf, tokenIdFromAddress, shortOf,
    plan, resolve, readQuery, ownerHref, pieceHref, iterationsLabel,
    order, biggest, refined, nextPiece, previousPiece,
    entryPixFromSearch, externalReferrer, entryRecord, referrerOriginMatches, backSealMode, backClick,
  };
})();
