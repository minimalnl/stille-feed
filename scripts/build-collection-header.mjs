// Builds the Generative Square collection header from the deployed art script.
// Left panel: published token 5. Middle: published token 7.
// Right panel: seed 100000609, rendered here because no minted token is both
// the smallest square and the darkest background.
//
//   node scripts/build-collection-header.mjs
//
// Needs Chrome, network (p5, the two published PNGs, and script() on LUKSO).

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { AbiCoder, id } from 'ethers';
import {
  CONTRACT, RPC, PANELS, PANEL_PX, HEADER_WIDTH, HEADER_HEIGHT,
  headerMetadataJson, encodeVerifiableURI, encodeSetData, predictSquare,
} from './collection-header-data.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const artPath = join(root, 'collection', 'deployed-art.js');
const outDir = join(root, 'collection');
const P5_URL = 'https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rpc(data) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: CONTRACT, data }, 'latest'] }),
  });
  const body = await res.json();
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result;
}

async function assertArtMatchesChain() {
  const local = await readFile(artPath, 'utf8');
  const hex = await rpc('0xebe9eb9f');
  const [script] = AbiCoder.defaultAbiCoder().decode(['string'], hex);
  if (script !== local) throw new Error('collection/deployed-art.js is not the script() stored on the contract');
  if (id('LSP4Metadata') !== '0x9afb95cacc9f95858ec44aa8c3b685511002e30ae54415823f406128b85b238e') {
    throw new Error('LSP4Metadata key mismatch');
  }
}

function decodePng(buf) {
  return PNG.sync.read(buf);
}

function encodePng(png) {
  return PNG.sync.write(png);
}

async function renderSeed(seed, art) {
  const dir = await mkdtemp(join(tmpdir(), 'square-header-'));
  const port = 8766 + (seed % 200);
  let server;
  let chrome;
  try {
    const p5 = Buffer.from(await (await fetch(P5_URL)).arrayBuffer());
    await writeFile(join(dir, 'p5.min.js'), p5);
    const html = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0}canvas{display:block}</style>
<script src="/p5.min.js"></script></head><body>
<script>const SEED=${Number(seed)};\n${art}\n</script></body></html>`;
    await writeFile(join(dir, 'index.html'), html);
    server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: dir, stdio: 'ignore' });
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/p5.min.js`)).ok) break;
      } catch { /* not up yet */ }
      await sleep(100);
    }
    const debugPort = 9400 + (seed % 200);
    chrome = spawn('/usr/bin/google-chrome', [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`, '--window-size=2400,2400',
      '--force-device-scale-factor=1', 'about:blank',
    ], { stdio: 'ignore' });
    let version;
    for (let i = 0; i < 50; i++) {
      try {
        version = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
        if (version.ok) break;
      } catch { /* not up yet */ }
      await sleep(100);
    }
    const page = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
    const pending = new Map();
    let rpcId = 0;
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (!msg.id || !pending.has(msg.id)) return;
      const { resolve, reject, timer } = pending.get(msg.id);
      clearTimeout(timer);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    });
    const call = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++rpcId;
      const timer = setTimeout(() => reject(new Error('timeout ' + method)), 60000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
    await call('Page.enable');
    await call('Emulation.setDeviceMetricsOverride', { width: 2400, height: 2400, deviceScaleFactor: 1, mobile: false });
    await call('Page.navigate', { url: `http://127.0.0.1:${port}/` });
    const drawn = await call('Runtime.evaluate', {
      expression: `new Promise((resolve, reject) => {
        const start = Date.now();
        const tick = () => {
          const canvas = document.querySelector('canvas');
          if (canvas && canvas.width === 2400 && window.frameCount >= 1) resolve(canvas.toDataURL('image/png'));
          else if (Date.now() - start > 30000) reject('canvas was not drawn');
          else setTimeout(tick, 40);
        };
        tick();
      })`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (drawn.exceptionDetails) throw new Error(JSON.stringify(drawn.exceptionDetails));
    const dataUrl = drawn.result?.value;
    if (!dataUrl?.startsWith('data:image/png')) throw new Error('renderer did not return a PNG');
    ws.close();
    return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  } finally {
    chrome?.kill('SIGKILL');
    server?.kill('SIGKILL');
    await rm(dir, { recursive: true, force: true });
  }
}

function pixel(png, x, y) {
  const i = (png.width * y + x) << 2;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
}

function diff(a, b) {
  let max = 0;
  const n = Math.min(a.data.length, b.data.length);
  for (let i = 0; i < n; i += 4) {
    const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
    if (d > max) max = d;
  }
  return max;
}

function boxDownsample(src, factor) {
  const width = src.width / factor;
  const height = src.height / factor;
  const out = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const i = (src.width * (y * factor + dy) + (x * factor + dx)) << 2;
          r += src.data[i];
          g += src.data[i + 1];
          b += src.data[i + 2];
          a += src.data[i + 3];
        }
      }
      const n = factor * factor;
      const o = (width * y + x) << 2;
      out.data[o] = Math.round(r / n);
      out.data[o + 1] = Math.round(g / n);
      out.data[o + 2] = Math.round(b / n);
      out.data[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

function sampleScale(src, x0, y0, sw, sh, dw, dh) {
  const out = new PNG({ width: dw, height: dh });
  for (let y = 0; y < dh; y++) {
    const sy = y0 + Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const sx = x0 + Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / dw));
      const i = (src.width * sy + sx) << 2;
      const o = (dw * y + x) << 2;
      out.data[o] = src.data[i];
      out.data[o + 1] = src.data[i + 1];
      out.data[o + 2] = src.data[i + 2];
      out.data[o + 3] = 255;
    }
  }
  return out;
}

async function main() {
  await assertArtMatchesChain();
  const art = await readFile(artPath, 'utf8');
  for (const panel of PANELS) {
    const predicted = predictSquare(panel.seed);
    if (predicted.background !== panel.background || predicted.square !== panel.square) {
      throw new Error(`seed ${panel.seed} does not match the planned colors`);
    }
  }

  const tokenPng = {};
  for (const id of [5, 7]) {
    const buf = Buffer.from(await (await fetch(`https://minimalnl.github.io/stille-feed/gg/42/${id}.png`)).arrayBuffer());
    tokenPng[id] = decodePng(buf);
    if (tokenPng[id].width !== PANEL_PX || tokenPng[id].height !== PANEL_PX) {
      throw new Error(`token ${id} is not ${PANEL_PX}px`);
    }
  }

  console.log('checking the renderer against published token 7');
  const rendered7 = decodePng(await renderSeed(118881353, art));
  const mismatch = diff(rendered7, tokenPng[7]);
  if (mismatch !== 0) throw new Error(`renderer does not match published token 7 (max channel drift ${mismatch})`);
  console.log('renderer matches token 7 exactly');

  const small = decodePng(await renderSeed(PANELS[2].seed, art));
  const sources = [tokenPng[5], tokenPng[7], small];
  const header = new PNG({ width: HEADER_WIDTH, height: HEADER_HEIGHT });
  for (let p = 0; p < sources.length; p++) {
    for (let y = 0; y < PANEL_PX; y++) {
      sources[p].data.copy(
        header.data,
        ((y * HEADER_WIDTH) + p * PANEL_PX) << 2,
        (y * PANEL_PX) << 2,
        ((y + 1) * PANEL_PX) << 2,
      );
    }
  }
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'generative-square-header.png'), encodePng(header));
  const smallHeader = boxDownsample(header, 4);
  await writeFile(join(outDir, 'generative-square-header-1800.png'), encodePng(smallHeader));

  const json = headerMetadataJson();
  await writeFile(join(outDir, 'lsp4-metadata.json'), json + '\n');
  const { keccak256 } = await import('ethers');
  const value = encodeVerifiableURI(json, (bytes) => keccak256(bytes));
  const calldata = encodeSetData(value);
  await writeFile(join(outDir, 'setdata-calldata.txt'), calldata + '\n');
  await writeFile(join(outDir, 'setdata-value.txt'), value + '\n');

  const cropH = Math.round(HEADER_WIDTH * 170 / 880);
  const cropY = Math.floor((HEADER_HEIGHT - cropH) / 2);
  const crop = sampleScale(header, 0, cropY, HEADER_WIDTH, cropH, 1760, 340);
  const artifactDir = '/opt/cursor/artifacts';
  await mkdir(artifactDir, { recursive: true });
  await writeFile(join(artifactDir, 'generative-square-header.png'), encodePng(smallHeader));
  await writeFile(join(artifactDir, 'generative-square-header-wide-crop.png'), encodePng(crop));
  console.log('wrote collection header', HEADER_WIDTH, 'x', HEADER_HEIGHT);
  console.log('wide crop y', cropY, 'height', cropH, 'of', HEADER_HEIGHT);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
