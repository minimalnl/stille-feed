// Quiet Feed: tiny read-only proxy for Hup posts (Cloudflare Worker).
// Hup's API sends no CORS headers, so a static page can't read it directly.
// This Worker forwards exactly one endpoint, GET only, and adds CORS + a short cache.
//
//   GET https://<worker>/api/v1/networks/posts?wallet_address=0x…&network_id=42&post_type=original&limit=12&page=1
//     -> https://hup.social/api/v1/networks/posts?…  (same query, only the parameters below)
//
// Deploy notes: worker/README.md

const UPSTREAM = 'https://hup.social';
const PATH = '/api/v1/networks/posts';
const PARAMS = {
  wallet_address: /^0x[0-9a-fA-F]{40}$/,
  network_id: /^\d{1,6}$/,
  post_type: /^[a-z_]{1,20}$/,
  limit: /^\d{1,2}$/,
  page: /^\d{1,4}$/,
};
const CACHE_SECONDS = 60;

function cors(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes('*') ? '*' : allowed.includes(origin) ? origin : null;
  const h = { 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
  if (ok) h['Access-Control-Allow-Origin'] = ok;
  return h;
}

function reply(status, body, headers) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...headers },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const h = cors(request.headers.get('Origin') || '', env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    if (request.method !== 'GET') return reply(405, { error: 'GET only' }, { ...h, Allow: 'GET, OPTIONS' });
    if (url.pathname !== PATH) return reply(404, { error: 'Not found' }, h);

    // Rebuild the query from known parameters only (fixed order -> better cache hits).
    const q = new URLSearchParams();
    for (const [k, re] of Object.entries(PARAMS)) {
      const v = url.searchParams.get(k);
      if (v == null) continue;
      if (!re.test(v)) return reply(400, { error: `Bad ${k}` }, h);
      q.set(k, k === 'wallet_address' ? v.toLowerCase() : v);
    }
    if (!q.has('wallet_address')) return reply(400, { error: 'wallet_address is required' }, h);

    const target = `${UPSTREAM}${PATH}?${q}`;
    const cache = caches.default;
    const key = new Request(target, { method: 'GET' });
    let res = await cache.match(key);
    if (!res) {
      let up;
      try {
        up = await fetch(target, { headers: { Accept: 'application/json', 'User-Agent': 'quiet-feed-proxy/1.0' },
          cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true } });
      } catch {
        return reply(502, { error: 'Hup unreachable' }, h);
      }
      const ok = up.status === 200;
      res = new Response(up.body, {
        status: up.status,
        headers: { 'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': ok ? `public, max-age=${CACHE_SECONDS}` : 'no-store' },
      });
      if (ok) ctx.waitUntil(cache.put(key, res.clone()));
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(h)) out.headers.set(k, v);
    out.headers.set('X-Content-Type-Options', 'nosniff');
    return out;
  },
};
