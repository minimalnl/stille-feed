// Renders small cached WebP thumbnails of the owner's Burnt Pix, so visitors don't
// download ~0.5 MB of on-chain SVG per piece. Output: thumbs/index.json + thumbs/<n>.webp
// Run: node scripts/build-thumbs.mjs [address]   (needs `sharp`; used by .github/workflows/pages.yml)
import sharp from 'sharp';
import { mkdir, writeFile, rm } from 'node:fs/promises';

const ADDRESS = (process.argv[2] || process.env.PIX_ADDRESS || '0xeccedbdad7dae297d1ef1134cca43cdfc2857bd1').toLowerCase();
const RPC = 'https://rpc.mainnet.lukso.network';
const IPFS = 'https://api.universalprofile.cloud/ipfs/';
const BURNTPIX = '0x3983151e0442906000dab83c8b1cf3f2d2535f82';
const LSP4_METADATA = '9afb95cacc9f95858ec44aa8c3b685511002e30ae54415823f406128b85b238e';
const SIZE = 800, SIZE_1X = 400, OUT = new URL('../thumbs/', import.meta.url);

const rpc = async (to, data) => {
  for (let i = 0; ; i++) {
    try {
      const r = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }) })).json();
      if (r.error) throw new Error(r.error.message);
      return r.result;
    } catch (e) { if (i >= 2) throw e; await new Promise((ok) => setTimeout(ok, 1500)); }
  }
};
const bytesFromAbi = (hex) => { const h = hex.slice(2); const len = parseInt(h.slice(64, 128), 16); return Buffer.from(h.slice(128, 128 + len * 2), 'hex'); };
// VerifiableURI: 0x0000 + method(4) + hashLen(2) + hash + url
const urlFromValue = (b) => b.length > 8 && b[0] === 0 && b[1] === 0 ? b.subarray(8 + b.readUInt16BE(6)).toString('utf8') : b.toString('utf8');
const fromDataUri = (u) => { const c = u.indexOf(','); const meta = u.slice(5, c); const body = u.slice(c + 1);
  return /;base64/.test(meta) ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body), 'utf8'); };
const load = async (u) => u.startsWith('data:') ? fromDataUri(u) : Buffer.from(await (await fetch(u.startsWith('ipfs://') ? IPFS + u.slice(7) : u)).arrayBuffer());

const r = (await rpc(BURNTPIX, '0xa3b261f2' + ADDRESS.slice(2).padStart(64, '0'))).slice(2);
const n = parseInt(r.slice(64, 128), 16) || 0;
const ids = [...Array(n)].map((_, i) => '0x' + r.slice(128 + i * 64, 192 + i * 64));
console.log(`${ADDRESS}: ${n} Burnt Pix`);

await rm(OUT, { recursive: true, force: true }); await mkdir(OUT, { recursive: true });
const pieces = [];
for (const id of ids) {
  try {
    const url = urlFromValue(bytesFromAbi(await rpc(BURNTPIX, '0x16e023b3' + id.slice(2) + LSP4_METADATA)));
    const json = JSON.parse((await load(url)).toString('utf8'));
    const md = json.LSP4Metadata || {};
    const iterations = Number((md.attributes || []).find((a) => a.key === 'Iterations')?.value ?? 0);
    const img = (md.images || [])[0]?.[0]?.url;
    const base = BigInt(id).toString(16);
    const file = `${base}.webp`;
    const file1x = `${base}-1x.webp`;
    if (img) {
      const buf = await load(img);
      await sharp(buf, { density: 96 }).resize(SIZE, SIZE, { fit: 'cover' }).webp({ quality: 80 }).toFile(new URL(file, OUT).pathname);
      await sharp(buf, { density: 96 }).resize(SIZE_1X, SIZE_1X, { fit: 'cover' }).webp({ quality: 80 }).toFile(new URL(file1x, OUT).pathname);
    }
    pieces.push({ id, iterations, thumb: img ? file : null, thumb1x: img ? file1x : null });
    process.stdout.write('.');
  } catch (e) { console.warn(`\n${id}: ${e.message}`); }
}
pieces.sort((a, b) => b.iterations - a.iterations);
await writeFile(new URL('index.json', OUT), JSON.stringify({ address: ADDRESS, updated: new Date().toISOString(), pieces }));
console.log(`\nwrote ${pieces.length} thumbnails`);
