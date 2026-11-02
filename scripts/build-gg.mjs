// Prerenders every minted Generative Grid square to PNG, so wallets and marketplaces can show it.
// The contract's on-chain LSP4Metadata points to <imageBaseURI><n>.png and <n>-600.png;
// imageBaseURI = https://minimalnl.github.io/stille-feed/gg/<chainId>/  ->  this writes gg/<chainId>/.
// The image is drawn with the on-chain script() + seedOf(n) in headless Chrome, exactly like the feed's
// preview iframe (same p5 version, same HTML wrapper, devicePixelRatio 1 -> 2400 x 2400).
// Existing PNGs are kept when the seed matches (gg/ is cached between workflow runs).
// Run: node scripts/build-gg.mjs [--check]   (--check: only report whether there are new mints; needs playwright-core + sharp + Chrome; CHROME_PATH overrides the binary)
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';

// Keep in sync with GG_NETS in grid-ad.js (only nets whose contract builds metadata, i.e. v3+).
const NETS = [
  { chainId: 4201, rpc: 'https://rpc.testnet.lukso.network', address: '0xe08833AcA3F7d7424ED1493168e599859b9d6FEd' },
  // { chainId: 42, rpc: 'https://rpc.mainnet.lukso.network', address: '' },
];
const P5 = 'https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js';
const SEL = { minted: '0x4f02c420', script: '0xebe9eb9f', seedOf: '0x82829f74' };

const exists = (p) => access(p).then(() => true, () => false);
const decodeString = (hex) => { const h = hex.slice(2), len = parseInt(h.slice(64, 128), 16);
  return Buffer.from(h.slice(128, 128 + len * 2), 'hex').toString('utf8'); };

// Same document the feed puts in its preview iframe (grid-ad.js draw()).
export const artHtml = (script, seed) => `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;height:100%;overflow:hidden;background:#fbf7ee}canvas{display:block;width:100%!important;height:100%!important}</style>
<script src="${P5}"><\/script></head><body>
<script>const SEED=${Number(seed)};\n${script.replace(/<\/script/gi, '<\\/script')}\n<\/script></body></html>`;

export async function openRenderer() {
  const { chromium } = await import('playwright-core'); // lazy: --check runs without dependencies
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome' });
  const ctx = await browser.newContext({ viewport: { width: 600, height: 600 }, deviceScaleFactor: 1 });
  const p5src = Buffer.from(await (await fetch(P5)).arrayBuffer());
  await ctx.route(P5, (r) => r.fulfill({ body: p5src, contentType: 'application/javascript' }));
  const render = async (script, seed) => {
    const page = await ctx.newPage();
    try {
      await page.setContent(artHtml(script, seed));
      await page.waitForFunction(() => window.frameCount >= 1 && document.querySelector('canvas'), null, { timeout: 60000 });
      const url = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
      return Buffer.from(url.split(',')[1], 'base64');
    } finally { await page.close(); }
  };
  return { render, close: () => browser.close() };
}

const rpcCall = async (net, data) => {
  for (let i = 0; ; i++) {
    try {
      const j = await (await fetch(net.rpc, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: net.address, data }, 'latest'] }) })).json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (e) { if (i >= 2) throw e; await new Promise((ok) => setTimeout(ok, 1500)); }
  }
};

// For the frequent schedule: is there anything to render? Writes changed=true|false to $GITHUB_OUTPUT.
async function check() {
  let changed = false;
  for (const net of NETS) {
    if (!net.address) continue;
    const old = await readFile(`gg/${net.chainId}/index.json`, 'utf8').then(JSON.parse, () => ({}));
    const minted = Number(BigInt(await rpcCall(net, SEL.minted)));
    if (old.address?.toLowerCase() !== net.address.toLowerCase() || old.minted !== minted) changed = true;
  }
  console.log(`changed=${changed}`);
  if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT, `changed=${changed}\n`, { flag: 'a' });
}

async function main() {
  const { default: sharp } = await import('sharp');
  const r = await openRenderer();
  try {
    for (const net of NETS) {
      if (!net.address) continue;
      const call = (data) => rpcCall(net, data);
      const dir = `gg/${net.chainId}/`;
      await mkdir(dir, { recursive: true });
      const old = await readFile(dir + 'index.json', 'utf8').then(JSON.parse, () => ({}));
      const same = old.address?.toLowerCase() === net.address.toLowerCase();
      const minted = Number(BigInt(await call(SEL.minted)));
      const script = decodeString(await call(SEL.script));
      const tokens = [];
      let made = 0;
      for (let n = 1; n <= minted; n++) {
        const seed = Number(BigInt(await call(SEL.seedOf + n.toString(16).padStart(64, '0'))));
        const prev = same && old.tokens?.find((t) => t.n === n);
        if (!(prev && prev.seed === seed && await exists(`${dir}${n}.png`) && await exists(`${dir}${n}-600.png`))) {
          const png = await r.render(script, seed);
          const meta = await sharp(png).metadata();
          if (meta.width !== 2400 || meta.height !== 2400) throw new Error(`#${n}: unexpected size ${meta.width}x${meta.height}`);
          await writeFile(`${dir}${n}.png`, await sharp(png).png({ compressionLevel: 9 }).toBuffer());
          await writeFile(`${dir}${n}-600.png`, await sharp(png).resize(600, 600).png({ compressionLevel: 9 }).toBuffer());
          made++;
        }
        tokens.push({ n, seed });
      }
      await writeFile(dir + 'index.json', JSON.stringify({ chainId: net.chainId, address: net.address, minted, tokens }));
      console.log(`${net.chainId} ${net.address}: ${minted} minted, ${made} rendered`);
    }
  } finally { await r.close(); }
}

if (import.meta.url === `file://${process.argv[1]}`) await (process.argv.includes('--check') ? check() : main());
