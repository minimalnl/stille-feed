// Short links to one Burnt Pix in Mark's collection.
// A Burnt Pix tokenId is bytes32: 12 zero bytes, then the 20-byte address of that piece's fractal contract.
//   ?pix=<first 8 hex chars of that address>     short form, for posts
//   ?id=<last 40 hex chars of the tokenId>       the whole address, unambiguous
// A 64-hex tokenId is also accepted for ?id=; the address is still the last 40 hex chars.
// Both are resolved only against PIX owner 0x7070…47FD (not the profile the feed happens to be showing).
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
  // Same-site link to the collection owner. Keeps theme and any other params; drops the piece params.
  function ownerHref(href) {
    const u = new URL(href, 'https://minimalnl.github.io');
    u.searchParams.set('address', OWNER);
    u.searchParams.delete('pix');
    u.searchParams.delete('id');
    return `${u.pathname}${u.search}${u.hash}`;
  }
  function iterationsLabel(value) {
    if (value == null || value === '') return 'Burnt Pix';
    const n = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isFinite(n)) return 'Burnt Pix';
    return n.toLocaleString('en-US') + ' iterations';
  }

  globalThis.PixLink = {
    OWNER, normalizePix, normalizeId, addressOf, tokenIdFromAddress, shortOf,
    plan, resolve, readQuery, ownerHref, iterationsLabel,
  };
})();
