// Generative Grid — rustig blok onderaan de feed: live voorbeeld, teller, prijs en minten.
// Mainnet = deze ene regel naar 'mainnet' zetten (en het mainnet-adres hieronder invullen).
const GG_NET = 'mainnet';

const GG_NETS = {
  testnet: { chainId: 4201, name: 'LUKSO testnet', rpc: 'https://rpc.testnet.lukso.network',
    address: '0x55b0284376aC05E37Ad7eFFA4Ee0E06E665c10B6', explorer: 'https://explorer.execution.testnet.lukso.network' },
  mainnet: { chainId: 42, name: 'LUKSO', rpc: 'https://rpc.mainnet.lukso.network',
    address: '', explorer: 'https://explorer.execution.mainnet.lukso.network' },
};

(() => {
  const C = GG_NETS[GG_NET];
  const box = document.getElementById('gg');
  if (!box || !C.address) return;

  const SEL = { minted: '0x4f02c420', max: '0x32cb6b0c', price: '0x9d1b464a', script: '0xebe9eb9f', mint: '0x1249c58b' };
  const MINTED_TOPIC = '0x5a3358a3d27a5373c0df2604662088d37894d56b7cfd27f315770440f4e0d919';
  const inGrid = window.parent !== window;
  const el = (id) => box.querySelector('#' + id);
  const st = { script: null, minted: null, max: 1000, price: null, provider: null, account: null, busy: false, msg: '' };

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
    return s + ' LYX';
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
    el('ggCount').textContent = st.minted === null ? '…' : soldOut ? `${st.max} of ${st.max} · sold out` : `#${st.minted + 1} of ${st.max}`;
    el('ggPrice').textContent = st.price === null || soldOut || st.provider ? '' : lyx(st.price);
    const b = el('ggMint');
    if (st.provider) {
      b.hidden = false;
      b.disabled = st.busy || soldOut || st.price === null;
      b.textContent = st.busy ? 'Minting…' : soldOut ? 'Sold out' : st.price != null ? `Mint for ${lyx(st.price)}` : 'Mint';
    } else {
      b.hidden = true;
    }
    el('ggNote').innerHTML = st.msg || (st.provider ? '' :
      'Add this feed to your <a href="https://universaleverything.io" target="_blank" rel="noopener">Grid</a> to mint.');
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
      const chain = Number(await pv.request({ method: 'eth_chainId', params: [] }));
      if (chain !== C.chainId) { st.msg = `Switch to ${C.name} to mint.`; return; }
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

  async function initProvider() {
    if (!inGrid) return;
    try {
      const { createClientUPProvider } = await import('https://esm.sh/@lukso/up-provider@0.3.5?bundle');
      st.provider = createClientUPProvider();
      render();
    } catch (e) { console.warn('UP provider not loaded', e); }
  }

  el('ggNew').onclick = () => draw(Math.floor(Math.random() * 1e9));
  el('ggMint').onclick = mint;

  call(SEL.script).then((h) => { st.script = decodeString(h); draw(Math.floor(Math.random() * 1e9)); box.hidden = false; })
    .catch((e) => console.warn('Script not loaded', e));
  refresh().catch(() => {});
  setInterval(() => refresh().catch(() => {}), 30000);
  initProvider();
  render();
})();
