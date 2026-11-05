// Generative Grid: a quiet "tip the creator" block at the bottom of the feed. Live preview, counter, price,
// and minting 1-5 pieces. Inside the LUKSO Grid it mints via up-provider (shared with app.js, window.qfUP);
// in a normal browser via the Universal Profile extension (EIP-6963 / window.lukso, fallback window.ethereum).
// ?gg=<number> shows that minted piece in the preview instead of a random seed.
//
// The contract has one mint() per piece (exact price, no batch). "Mint 3" therefore sends 3 transactions,
// one after the other: each is simulated first, sent with the exact price of that number, and confirmed
// before the next. Anything unexpected (price changed, sold out, not enough LYX, rejected) stops the run;
// a failed mint reverts and costs only gas.
//
// Mainnet = set this one line to 'mainnet' (and fill in the mainnet address below; also in scripts/build-gg.mjs).
// Only after Mark tested on testnet and said yes.
const GG_NET = 'testnet';

const GG_NETS = {
  testnet: { chainId: 4201, name: 'LUKSO Testnet', symbol: 'LYXt', rpc: 'https://rpc.testnet.lukso.network',
    address: '0xF4947C5F85115D9FA6c039Ac459C630370F8F239', explorer: 'https://explorer.execution.testnet.lukso.network' },
  mainnet: { chainId: 42, name: 'LUKSO', symbol: 'LYX', rpc: 'https://rpc.mainnet.lukso.network',
    address: '', explorer: 'https://explorer.execution.mainnet.lukso.network' },
};

(() => {
  const C = GG_NETS[GG_NET];
  const box = document.getElementById('gg');
  if (!box || !C.address) return;

  const MAX_QTY = 5;
  const TIER_SIZE = 100; // contract: price doubles every 100 (priceFor = BASE_PRICE << (n-1)/100)
  const SEL = { minted: '0x4f02c420', max: '0x32cb6b0c', price: '0x9d1b464a', base: '0xf86325ed', priceFor: '0x8d5555f2',
    script: '0xebe9eb9f', mint: '0x1249c58b', seedOf: '0x82829f74' };
  const ERR = { '0x52df9fe5': 'sold out', '0x6871963e': 'price changed' }; // SoldOut(), WrongPrice(uint256,uint256)
  const MINTED_TOPIC = '0x5a3358a3d27a5373c0df2604662088d37894d56b7cfd27f315770440f4e0d919';
  const P5 = 'https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js';
  const P5_SRI = 'sha512-uaz5GpnQoE6t5echKlX8P52czvsIGgLPcvlzfvRubLZ1Hp8JemUDnbUiAahbVtPb+jUVrNETuXvAhDDF/N3M4w==';
  const inGrid = window.parent !== window;
  const el = (id) => box.querySelector('#' + id);
  const st = { script: null, minted: null, max: 1000, base: null, prices: [], qty: 1, provider: null, account: null, wallets: [], wallet: null,
    busy: false, msg: '', progress: '' };
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const short = (a) => a.slice(0, 6) + '…' + a.slice(-4);
  const hexChain = '0x' + C.chainId.toString(16);
  const hex = (n) => '0x' + BigInt(n).toString(16);
  const pad = (n) => BigInt(n).toString(16).padStart(64, '0');

  // JSON-RPC to the testnet node; several calls at once go out as one batch.
  async function rpcBatch(calls) {
    const r = await fetch(C.rpc, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(calls.map(([method, params], id) => ({ jsonrpc: '2.0', id, method, params }))) });
    const j = await r.json();
    const byId = new Map((Array.isArray(j) ? j : [j]).map((x) => [x.id, x]));
    return calls.map((_, id) => {
      const x = byId.get(id);
      if (!x || x.error) { const e = new Error(x?.error?.message || 'No answer'); e.data = x?.error?.data; throw e; }
      return x.result;
    });
  }
  const rpc = async (method, params) => (await rpcBatch([[method, params]]))[0];
  const call = (data) => rpc('eth_call', [{ to: C.address, data }, 'latest']);
  const decodeString = (h0) => {
    const h = h0.slice(2), len = parseInt(h.slice(64, 128), 16);
    const b = Uint8Array.from(h.slice(128, 128 + len * 2).match(/../g) || [], (x) => parseInt(x, 16));
    return new TextDecoder().decode(b);
  };
  const lyx = (wei) => (Number(wei / 10n ** 9n) / 1e9).toLocaleString('en-US', { maximumFractionDigits: 9 }) + ' ' + C.symbol;
  const priceFor = (n) => (n < 1 || n > st.max || st.base === null ? 0n : st.base << BigInt(Math.floor((n - 1) / TIER_SIZE)));
  const left = () => (st.minted === null ? 0 : Math.max(0, st.max - st.minted));
  const total = (q) => st.prices.slice(0, q).reduce((a, b) => a + b, 0n);

  // ---------- Art ----------
  function draw(seed) {
    if (!st.script) return;
    el('ggArt').srcdoc = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;height:100%;overflow:hidden;background:#fbf7ee}canvas{display:block;width:100%!important;height:100%!important}</style>
<script src="${P5}" integrity="${P5_SRI}" crossorigin="anonymous"><\/script></head><body>
<script>const SEED=${Number(seed)};\n${st.script.replace(/<\/script/gi, '<\\/script')}\n<\/script></body></html>`;
  }
  const randomSeed = () => Math.floor(Math.random() * 1e9); // same range as the contract (SEED_RANGE)

  // The script is immutable in the contract (no setter), so it can be cached per contract address.
  async function loadScript() {
    const key = `qf:c:ggscript:${C.chainId}:${C.address.toLowerCase()}`;
    try { const s = localStorage.getItem(key); if (s) return s; } catch {}
    const s = decodeString(await call(SEL.script));
    try { localStorage.setItem(key, s); } catch {}
    return s;
  }

  // ---------- UI ----------
  function render() {
    const soldOut = st.minted !== null && st.minted >= st.max;
    const canMint = !!st.provider && (inGrid || !!st.account);
    const q = Math.min(st.qty, Math.max(1, left()));
    el('ggCount').textContent = st.minted === null ? '…' : soldOut ? `${st.max} of ${st.max} · sold out` : `#${st.minted + 1} of ${st.max}`;
    el('ggPrice').textContent = !st.prices.length || soldOut ? '' : `${lyx(st.prices[0])} each`;

    const qty = el('ggQty');
    qty.hidden = !canMint || soldOut || st.base === null;
    qty.querySelectorAll('button').forEach((b) => {
      const n = Number(b.dataset.q);
      b.classList.toggle('on', n === q);
      b.disabled = st.busy || n > left();
      b.setAttribute('aria-pressed', String(n === q));
    });

    const b = el('ggMint');
    b.classList.toggle('gg-connect', !!st.provider && !canMint);
    if (st.provider) {
      b.hidden = false;
      b.disabled = st.busy || soldOut || (canMint && st.base === null);
      b.textContent = soldOut ? 'Sold out' : !canMint ? (st.busy ? 'Connecting…' : 'Connect')
        : st.busy ? (st.progress || 'Minting…') : st.base !== null ? `Mint ${q} for ${lyx(total(q))}` : 'Mint';
    } else {
      b.hidden = true;
    }
    el('ggNote').innerHTML = st.msg || (st.provider ? (canMint && q > 1 && !st.busy ? `${q} pieces = ${q} confirmations, one after the other.`
      : !inGrid && st.account ? short(st.account) + (st.wallets.length > 1 ? ` · ${esc(st.wallet?.info.name || '')} · <button type="button" class="gg-switch" id="ggSwitch">change</button>` : '') : '') :
      'Mint in your <a href="https://universaleverything.io" target="_blank" rel="noopener">Grid</a> or with the ' +
      '<a href="https://chromewebstore.google.com/detail/universal-profiles/abpickdkkbnbcoepogfhkhennhfhehfn" target="_blank" rel="noopener">Universal Profile extension</a>.');
  }

  // Counter + prices of the next MAX_QTY numbers, in one request.
  async function refresh() {
    const [m, x, base, cur] = (await rpcBatch([SEL.minted, SEL.max, SEL.base, SEL.price]
      .map((d) => ['eth_call', [{ to: C.address, data: d }, 'latest']]))).map((h) => BigInt(h));
    st.minted = Number(m); st.max = Number(x); st.base = base;
    // Sanity check against the contract's own price; if the formula ever disagrees, ask the contract per number.
    if (left() > 0 && priceFor(st.minted + 1) !== cur) {
      const nums = [...Array(Math.min(MAX_QTY, left()))].map((_, i) => st.minted + 1 + i);
      const ps = await rpcBatch(nums.map((n) => ['eth_call', [{ to: C.address, data: SEL.priceFor + pad(n) }, 'latest']]));
      st.prices = ps.map((h) => BigInt(h));
    } else {
      st.prices = [...Array(Math.min(MAX_QTY, left()))].map((_, i) => priceFor(st.minted + 1 + i));
    }
    if (st.qty > Math.max(1, left())) st.qty = Math.max(1, left());
    render();
  }

  async function waitReceipt(hash) {
    for (let i = 0; i < 90; i++) { // ~3 minutes
      const r = await rpc('eth_getTransactionReceipt', [hash]).catch(() => null);
      if (r) return r;
      await new Promise((ok) => setTimeout(ok, 2000));
    }
    return null;
  }

  // Human message for a failed simulation or wallet error.
  function why(e) {
    const data = typeof e?.data === 'string' ? e.data : e?.data?.data || e?.data?.originalError?.data || '';
    const sel = String(data).slice(0, 10);
    if (ERR[sel] === 'sold out') return 'Sold out.';
    if (ERR[sel] === 'price changed') return 'The price just changed. Check it and mint again.';
    const m = String(e?.message || '');
    if (/insufficient funds|exceeds balance|not enough/i.test(m)) return `Not enough ${C.symbol} for this mint.`;
    return 'Mint failed.';
  }

  async function mint() {
    if (st.busy) return; // double click / double tap guard
    const pv = st.provider;
    const q = Math.min(st.qty, Math.max(1, left()));
    const quoted = st.prices.slice(0, q);
    st.busy = true; st.msg = ''; st.progress = ''; render();
    const done = []; // { n, hash }
    let stop = '';
    try {
      // In the Grid the chain is fixed by the Grid: check it before asking anyone to connect.
      if (inGrid && !(await ensureChain(pv))) { st.msg = `Minting is on ${C.name} for now; this Grid is on another network.`; return; }
      let [acc] = (await pv.request({ method: 'eth_accounts', params: [] })) || [];
      if (!acc) [acc] = (await pv.request({ method: 'eth_requestAccounts', params: [] })) || [];
      if (!acc) { st.msg = inGrid ? 'Connect your profile to the Grid to mint.' : 'Connect a profile to mint.'; return; }
      if (!inGrid && !(await ensureChain(pv))) { st.msg = `Switch to ${C.name} to mint.`; return; }
      await refresh();
      if (left() === 0) { st.msg = 'Sold out.'; return; }
      if (left() < q) { st.qty = left(); st.msg = `Only ${left()} left. Check the price and mint again.`; return; }
      // Never pay more than the price that was on the button.
      if (st.prices.slice(0, q).some((p, i) => p > quoted[i])) { st.msg = 'The price just changed. Check it and mint again.'; return; }
      const need = total(q);
      const bal = BigInt(await rpc('eth_getBalance', [acc, 'latest']));
      if (bal < need) { st.msg = `Not enough ${C.symbol}: ${q} ${q === 1 ? 'piece costs' : 'pieces cost'} ${lyx(need)} plus a little gas.`; return; }

      for (let i = 0; i < q; i++) {
        st.progress = q > 1 ? `Minting ${i + 1} of ${q}…` : 'Minting…'; render();
        if (i > 0) await refresh();
        const n = st.minted + 1;
        if (n > st.max) { stop = 'Sold out.'; break; }
        const value = BigInt(await call(SEL.priceFor + pad(n))); // the contract's own price for this number
        if (value > quoted[i]) { stop = 'The price changed, so I stopped.'; break; }
        const tx = { from: acc, to: C.address, value: hex(value), data: SEL.mint };
        // Dry run first: catches sold out / wrong price / no balance before the wallet asks anything.
        try { await rpc('eth_call', [tx, 'latest']); } catch (e) { stop = why(e); break; }
        let hash;
        try { hash = await pv.request({ method: 'eth_sendTransaction', params: [tx] }); } catch (e) {
          stop = e?.code === 4001 || /reject|denied|cancel/i.test(e?.message || '') ? 'Cancelled.' : why(e);
          break;
        }
        const rc = await waitReceipt(hash);
        if (!rc) { stop = `Still pending · <a href="${C.explorer}/tx/${hash}" target="_blank" rel="noopener">view ↗</a>`; break; }
        const log = rc.status === '0x1' && rc.logs.find((l) => l.topics[0] === MINTED_TOPIC && l.address.toLowerCase() === C.address.toLowerCase());
        if (!log) { stop = `Mint failed (only gas was used) · <a href="${C.explorer}/tx/${hash}" target="_blank" rel="noopener">view ↗</a>`; break; }
        const num = Number(BigInt(log.topics[2])), seed = Number(BigInt(log.data.slice(0, 66)));
        done.push({ n: num, hash });
        draw(seed);
      }
    } catch (e) {
      console.warn(e);
      stop = e?.code === 4001 ? 'Cancelled.' : why(e);
    } finally {
      const list = done.map((d) => `<a href="${C.explorer}/tx/${d.hash}" target="_blank" rel="noopener">#${d.n}</a>`).join(' · ');
      if (done.length) st.msg = `Minted ${list}. Thank you!` + (stop ? ` <span class="gg-stop">${done.length} of ${q} · ${stop}</span>` : '');
      else if (stop) st.msg = stop;
      st.busy = false; st.progress = '';
      await refresh().catch(() => {});
      render();
    }
  }

  // Asks the wallet to switch to C.chainId (adds the network if unknown). The Grid decides the chain itself.
  async function ensureChain(pv) {
    // up-provider knows the Grid's chain locally; otherwise ask the wallet (with a timeout, it should answer at once).
    const now = async () => (inGrid && Number.isInteger(Number(pv.chainId)) && pv.chainId ? Number(pv.chainId)
      : Number(await Promise.race([pv.request({ method: 'eth_chainId', params: [] }),
        new Promise((_, no) => setTimeout(() => no(new Error('No answer from wallet')), 10000))])));
    if (await now() === C.chainId) return true;
    if (inGrid) return false;
    try {
      await pv.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexChain }] });
    } catch (e) {
      if (e && (e.code === 4902 || e.code === -32603 || /unrecognized|not added|unknown chain/i.test(e.message || ''))) {
        try {
          await pv.request({ method: 'wallet_addEthereumChain', params: [{ chainId: hexChain, chainName: C.name,
            nativeCurrency: { name: C.symbol, symbol: C.symbol, decimals: 18 }, rpcUrls: [C.rpc], blockExplorerUrls: [C.explorer] }] });
          if (await now() !== C.chainId) await pv.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexChain }] });
        } catch (e2) { console.warn(e2); return false; }
      } else { console.warn(e); return false; }
    }
    return (await now()) === C.chainId;
  }

  async function connect(picked) {
    if (st.busy) return;
    if (!picked && st.wallets.length > 1) { st.msg = ''; render(); showPicker(); return; }
    const pv = st.provider;
    st.busy = true; st.msg = ''; render();
    try {
      const [acc] = (await pv.request({ method: 'eth_requestAccounts', params: [] })) || [];
      st.account = acc || null;
      if (acc && !(await ensureChain(pv))) st.msg = `${short(acc)} · switch to ${C.name} to mint.`;
    } catch (e) {
      console.warn(e);
      st.msg = e && e.code === 4001 ? '' : 'Could not connect.';
    } finally {
      st.busy = false; render();
    }
  }

  // Browser extensions: every EIP-6963 wallet, plus window.lukso / window.ethereum when not announced.
  const WKEY = 'qf.wallet';
  const isUP = (w) => /universal\s*profile|lukso|universaleverything/i.test(`${w.info?.name} ${w.info?.rdns}`);
  function findWallets() {
    return new Promise((done) => {
      const seen = [];
      const add = (info, provider) => { if (provider && !seen.some((w) => w.provider === provider)) seen.push({ info: info || {}, provider }); };
      const on = (e) => e.detail && add(e.detail.info, e.detail.provider);
      window.addEventListener('eip6963:announceProvider', on);
      window.dispatchEvent(new Event('eip6963:requestProvider'));
      setTimeout(() => {
        window.removeEventListener('eip6963:announceProvider', on);
        if (window.lukso && !seen.some(isUP)) add({ name: 'Universal Profile' }, window.lukso);
        if (window.ethereum && !seen.length) add({ name: window.ethereum.isRabby ? 'Rabby' : window.ethereum.isMetaMask ? 'MetaMask' : 'Browser wallet' }, window.ethereum);
        // Universal Profile first, the rest in announce order.
        done(seen.filter(isUP).concat(seen.filter((w) => !isUP(w))));
      }, 400);
    });
  }
  function preferred() {
    let saved = ''; try { saved = localStorage.getItem(WKEY) || ''; } catch (e) {}
    return st.wallets.find((w) => w.info.name === saved) || st.wallets[0] || null;
  }
  const bound = new WeakSet();
  function useWallet(w) {
    st.wallet = w; st.provider = w.provider;
    if (bound.has(w.provider)) return; bound.add(w.provider);
    w.provider.on?.('accountsChanged', (a) => { if (st.provider !== w.provider) return; st.account = (a && a[0]) || null; st.msg = ''; render(); });
    w.provider.on?.('chainChanged', () => { if (st.provider === w.provider) { st.msg = ''; render(); } });
  }
  function hidePicker() { const p = el('ggPick'); if (p) p.remove(); }
  function showPicker() {
    hidePicker();
    const p = document.createElement('div');
    p.id = 'ggPick'; p.className = 'gg-pick'; p.setAttribute('role', 'group'); p.setAttribute('aria-label', 'Choose a wallet');
    const t = document.createElement('span'); t.className = 'gg-pick-t'; t.textContent = 'Connect with'; p.append(t);
    st.wallets.forEach((w) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'gg-pick-w';
      if (w === preferred()) b.classList.add('on');
      if (w.info.icon && /^data:image\//.test(w.info.icon)) { const i = document.createElement('img'); i.src = w.info.icon; i.alt = ''; b.append(i); }
      b.append(document.createTextNode(w.info.name || 'Wallet'));
      b.onclick = () => { hidePicker(); try { localStorage.setItem(WKEY, w.info.name || ''); } catch (e) {} useWallet(w); connect(true); };
      p.append(b);
    });
    const x = document.createElement('button'); x.type = 'button'; x.className = 'gg-pick-x'; x.textContent = 'Cancel';
    x.onclick = () => { hidePicker(); render(); }; p.append(x);
    el('ggMint').closest('.gg-act').after(p);
    p.querySelector('.gg-pick-w').focus();
  }

  async function initProvider() {
    try {
      if (inGrid) {
        st.provider = await (window.qfUP || Promise.resolve(null));
        if (st.provider) {
          st.provider.on?.('accountsChanged', () => { st.msg = ''; render(); });
          st.provider.on?.('chainChanged', () => { st.msg = ''; render(); });
        }
      } else {
        st.wallets = await findWallets();
        const w = preferred();
        if (!w) { render(); return; }
        useWallet(w);
        // Already connected earlier with the remembered wallet? Then skip the Connect step (no popup).
        let saved = null; try { saved = localStorage.getItem(WKEY); } catch (e) {}
        if (st.wallets.length === 1 || saved === w.info.name) {
          const [acc] = await w.provider.request({ method: 'eth_accounts', params: [] }).catch(() => []);
          st.account = acc || null;
        }
      }
      render();
    } catch (e) { console.warn('Wallet not loaded', e); }
  }

  async function previewFromUrl() {
    const n = Number(new URLSearchParams(location.search).get('gg'));
    if (!Number.isInteger(n) || n < 1) return null;
    const seed = BigInt(await call(SEL.seedOf + pad(n)));
    return seed > 0n || n <= (st.minted || 0) ? seed : null;
  }

  el('ggNote').onclick = (e) => { if (e.target.id === 'ggSwitch' && !st.busy) showPicker(); };
  el('ggNew').onclick = () => draw(randomSeed());
  el('ggMint').onclick = () => (!inGrid && !st.account ? connect() : mint());
  el('ggQty').onclick = (e) => {
    const n = Number(e.target.dataset?.q);
    if (!n || st.busy || n > left()) return;
    st.qty = n; st.msg = ''; render();
  };

  // Nothing of this block loads (no RPC, no p5) until the visitor scrolls near the bottom.
  let started = false;
  function start() {
    if (started) return; started = true;
    Promise.all([loadScript(), previewFromUrl().catch(() => null)]).then(([s, seed]) => {
      st.script = s; draw(seed ?? randomSeed()); box.hidden = false;
    }).catch((e) => console.warn('Script not loaded', e));
    refresh().catch(() => {});
    setInterval(() => { if (!document.hidden && !st.busy) refresh().catch(() => {}); }, 30000);
    initProvider();
    render();
  }
  const sentinel = document.querySelector('.foot') || box;
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { io.disconnect(); start(); } }, { rootMargin: '600px 0px' });
    io.observe(sentinel);
  } else start();
})();
