// Generative Grid — quiet block below the feed: live preview, counter, price and minting.
// Minting: inside the LUKSO Grid via up-provider; in a normal browser via the Universal Profile
// extension (EIP-6963 / window.lukso, fallback window.ethereum).
// ?gg=<number> shows that minted piece in the preview instead of a random seed.
// Mainnet = set this one line to 'mainnet' (and fill in the mainnet address below; also in scripts/build-gg.mjs).
const GG_NET = 'testnet';

const GG_NETS = {
  testnet: { chainId: 4201, name: 'LUKSO Testnet', symbol: 'LYXt', rpc: 'https://rpc.testnet.lukso.network',
    address: '0xe08833AcA3F7d7424ED1493168e599859b9d6FEd', explorer: 'https://explorer.execution.testnet.lukso.network' },
  mainnet: { chainId: 42, name: 'LUKSO', symbol: 'LYX', rpc: 'https://rpc.mainnet.lukso.network',
    address: '', explorer: 'https://explorer.execution.mainnet.lukso.network' },
};

(() => {
  const C = GG_NETS[GG_NET];
  const box = document.getElementById('gg');
  if (!box || !C.address) return;

  const SEL = { minted: '0x4f02c420', max: '0x32cb6b0c', price: '0x9d1b464a', script: '0xebe9eb9f', mint: '0x1249c58b', seedOf: '0x82829f74' };
  const MINTED_TOPIC = '0x5a3358a3d27a5373c0df2604662088d37894d56b7cfd27f315770440f4e0d919';
  const inGrid = window.parent !== window;
  const el = (id) => box.querySelector('#' + id);
  const st = { script: null, minted: null, max: 1000, price: null, provider: null, account: null, busy: false, msg: '',
    wallet: null }; // wallet: injected browser provider (extension), only outside the Grid
  const short = (a) => a.slice(0, 6) + '…' + a.slice(-4);
  const hexChain = '0x' + C.chainId.toString(16);

  async function rpc(method, params) {
    const r = await fetch(C.rpc, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.result;
  }
  const call = (data) => rpc('eth_call', [{ to: C.address, data }, 'latest']);
  const decodeString = (hex) => {
    const h = hex.slice(2), len = parseInt(h.slice(64, 128), 16);
    const b = Uint8Array.from(h.slice(128, 128 + len * 2).match(/../g) || [], (x) => parseInt(x, 16));
    return new TextDecoder().decode(b);
  };
  const lyx = (wei) => {
    const s = (Number(wei / 10n ** 12n) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 6 });
    return s + ' ' + C.symbol;
  };

  function draw(seed) {
    if (!st.script) return;
    el('ggArt').srcdoc = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;height:100%;overflow:hidden;background:#fbf7ee}canvas{display:block;width:100%!important;height:100%!important}</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js"><\/script></head><body>
<script>const SEED=${Number(seed)};\n${st.script.replace(/<\/script/gi, '<\\/script')}\n<\/script></body></html>`;
  }

  function render() {
    const soldOut = st.minted !== null && st.minted >= st.max;
    const canMint = !!st.provider && (inGrid || !!st.account);
    el('ggCount').textContent = st.minted === null ? '…' : soldOut ? `${st.max} of ${st.max} · sold out` : `#${st.minted + 1} of ${st.max}`;
    el('ggPrice').textContent = st.price === null || soldOut || canMint ? '' : lyx(st.price);
    const b = el('ggMint');
    b.classList.toggle('gg-connect', !!st.provider && !canMint);
    if (st.provider) {
      b.hidden = false;
      b.disabled = st.busy || soldOut || (canMint && st.price === null);
      b.textContent = soldOut ? 'Sold out' : !canMint ? (st.busy ? 'Connecting…' : 'Connect')
        : st.busy ? 'Minting…' : st.price != null ? `Mint for ${lyx(st.price)}` : 'Mint';
    } else {
      b.hidden = true;
    }
    el('ggNote').innerHTML = st.msg || (st.provider ? (!inGrid && st.account ? short(st.account) : '') :
      'Mint in your <a href="https://universaleverything.io" target="_blank" rel="noopener">Grid</a> or with the ' +
      '<a href="https://chromewebstore.google.com/detail/universal-profiles/abpickdkkbnbcoepogfhkhennhfhehfn" target="_blank" rel="noopener">Universal Profile extension</a>.');
  }

  async function refresh() {
    const [m, x, p] = await Promise.all([call(SEL.minted), call(SEL.max), call(SEL.price)]);
    st.minted = Number(BigInt(m)); st.max = Number(BigInt(x)); st.price = BigInt(p);
    render();
  }

  async function waitReceipt(hash) {
    for (let i = 0; i < 90; i++) {
      const r = await rpc('eth_getTransactionReceipt', [hash]);
      if (r) return r;
      await new Promise((ok) => setTimeout(ok, 2000));
    }
    throw new Error('timeout');
  }

  async function mint() {
    const pv = st.provider;
    st.busy = true; st.msg = ''; render();
    try {
      let [acc] = await pv.request({ method: 'eth_accounts', params: [] });
      if (!acc) [acc] = await pv.request({ method: 'eth_requestAccounts', params: [] });
      if (!acc) { st.msg = ''; return; }
      if (!(await ensureChain(pv))) { st.msg = `Switch to ${C.name} to mint.`; return; }
      await refresh();
      const hash = await pv.request({ method: 'eth_sendTransaction',
        params: [{ from: acc, to: C.address, value: '0x' + st.price.toString(16), data: SEL.mint }] });
      st.msg = 'Minting…'; render();
      const rc = await waitReceipt(hash);
      const log = rc.status === '0x1' && rc.logs.find((l) => l.topics[0] === MINTED_TOPIC && l.address.toLowerCase() === C.address.toLowerCase());
      if (!log) { st.msg = 'Mint failed.'; return; }
      const n = Number(BigInt(log.topics[2])), seed = Number(BigInt(log.data.slice(0, 66)));
      draw(seed);
      st.msg = `Minted: #${n} · <a href="${C.explorer}/tx/${hash}" target="_blank" rel="noopener">view ↗</a>`;
      await refresh();
    } catch (e) {
      console.warn(e);
      st.msg = 'Mint failed.';
    } finally {
      st.busy = false; render();
    }
  }

  // Asks the wallet to switch to C.chainId (adds the network if unknown). The Grid decides the chain itself.
  async function ensureChain(pv) {
    const now = async () => Number(await pv.request({ method: 'eth_chainId', params: [] }));
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

  async function connect() {
    const pv = st.provider;
    st.busy = true; st.msg = ''; render();
    try {
      const [acc] = await pv.request({ method: 'eth_requestAccounts', params: [] });
      st.account = acc || null;
      if (acc && !(await ensureChain(pv))) st.msg = `${short(acc)} · switch to ${C.name} to mint.`;
    } catch (e) {
      console.warn(e);
      st.msg = e && e.code === 4001 ? '' : 'Could not connect.';
    } finally {
      st.busy = false; render();
    }
  }

  // Browser extension: EIP-6963 first (prefer the Universal Profile extension), then window.lukso / window.ethereum.
  function findWallet() {
    return new Promise((done) => {
      const seen = [];
      const on = (e) => e.detail && e.detail.provider && seen.push(e.detail);
      window.addEventListener('eip6963:announceProvider', on);
      window.dispatchEvent(new Event('eip6963:requestProvider'));
      setTimeout(() => {
        window.removeEventListener('eip6963:announceProvider', on);
        const up = seen.find((d) => /universal\s*profile|lukso|universaleverything/i.test(`${d.info?.name} ${d.info?.rdns}`));
        done((up || seen[0])?.provider || window.lukso || window.ethereum || null);
      }, 400);
    });
  }

  async function initProvider() {
    try {
      if (inGrid) {
        const { createClientUPProvider } = await import('https://esm.sh/@lukso/up-provider@0.3.5?bundle');
        st.provider = createClientUPProvider();
      } else {
        const pv = await findWallet();
        if (!pv) { render(); return; }
        st.provider = pv;
        // Already connected earlier? Then skip the Connect step (no popup).
        const [acc] = await pv.request({ method: 'eth_accounts', params: [] }).catch(() => []);
        st.account = acc || null;
        pv.on?.('accountsChanged', (a) => { st.account = (a && a[0]) || null; st.msg = ''; render(); });
        pv.on?.('chainChanged', () => { st.msg = ''; render(); });
      }
      render();
    } catch (e) { console.warn('Wallet not loaded', e); }
  }

  async function previewFromUrl() {
    const n = Number(new URLSearchParams(location.search).get('gg'));
    if (!Number.isInteger(n) || n < 1) return null;
    const seed = BigInt(await call(SEL.seedOf + n.toString(16).padStart(64, '0')));
    return seed > 0n || n <= (st.minted || 0) ? seed : null;
  }

  el('ggNew').onclick = () => draw(Math.floor(Math.random() * 1e9));
  el('ggMint').onclick = () => (!inGrid && !st.account ? connect() : mint());

  Promise.all([call(SEL.script), previewFromUrl().catch(() => null)]).then(([h, seed]) => {
    st.script = decodeString(h); draw(seed ?? Math.floor(Math.random() * 1e9)); box.hidden = false;
  }).catch((e) => console.warn('Script not loaded', e));
  refresh().catch(() => {});
  setInterval(() => refresh().catch(() => {}), 30000);
  initProvider();
  render();
})();
