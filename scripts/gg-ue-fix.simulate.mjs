// Read-only check: build the exact Fix-images calldata and eth_call it as the contract owner.
// Does not sign, send, or connect a wallet. Run: node scripts/gg-ue-fix.simulate.mjs
import { pathToFileURL } from 'node:url';
import { ethers } from 'ethers';
import { keccak_256 } from '@noble/hashes/sha3';
import { loadGGUeFix } from './gg-ue-load.mjs';

// decideToken uses action 'skip'. The report status is 'skipped' so a later
// all-skipped or mixed run still counts as success.
export function ethCallForDecision(action) {
  return action === 'skip' ? 'skipped' : action;
}

export function simulationReportOk(tokens) {
  return Array.isArray(tokens) && tokens.every((token) => token?.ethCall?.ok === true || token?.ethCall === 'skipped');
}

const GGUeFix = loadGGUeFix();
const RPC = 'https://rpc.mainnet.lukso.network';
const ADDR = '0x33Dd4D3da812e2cc1B3692456470DFDD99659e62';
const OWNER = '0x52224e802F722A3F3f1de8b2157597ae7fEfffD1';
const NOT_OWNER = '0x7070b7Cb8fAe99B6C7DDd0eaBe831DCb6c3047FD';
const nobleKeccak = (bytes) => '0x' + Buffer.from(keccak_256(bytes)).toString('hex');

const provider = new ethers.JsonRpcProvider(RPC, 42, { staticNetwork: true });
const readAbi = new ethers.Interface([
  'function minted() view returns (uint256)',
  'function owner() view returns (address)',
  'function imageBaseURI() view returns (string)',
  'function tokenMetadataJSON(uint256) view returns (string)',
  'function setDataForTokenId(bytes32 tokenId, bytes32 dataKey, bytes value)',
]);
const reader = new ethers.Contract(ADDR, readAbi, provider);

function pngSize(buf) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(sig) || buf.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new Error('response is not a PNG');
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function imageSize(url) {
  const res = await fetch(url, { headers: { Range: 'bytes=0-31' } });
  if (!res.ok && res.status !== 206) throw new Error(`${url} HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const size = pngSize(buf);
  return { url, status: res.status, bytes: buf.length, ...size };
}

export async function simulateReadOnly() {
const report = { rpc: RPC, contract: ADDR, sentTransaction: false };
try {
  const [minted, owner, baseURI] = await Promise.all([
    reader.minted(), reader.owner(), reader.imageBaseURI(),
  ]);
  report.minted = Number(minted);
  report.owner = owner;
  report.ownerIsExpected = owner.toLowerCase() === OWNER.toLowerCase();
  report.ownerIsNot7070 = owner.toLowerCase() !== NOT_OWNER.toLowerCase();
  report.baseURI = baseURI;
  if (!report.ownerIsExpected || !report.ownerIsNot7070) throw new Error('unexpected contract owner ' + owner);

  report.tokens = [];
  for (let n = 1; n <= report.minted; n++) {
    const id = ethers.zeroPadValue(ethers.toBeHex(n), 32);
    const getData = GGUeFix.SEL.getDataForTokenId + id.slice(2) + GGUeFix.LSP4_METADATA_KEY.slice(2);
    const raw = await provider.call({ to: ADDR, data: getData });
    const existing = GGUeFix.tryDecodeStoredMetadata(raw);
    const computed = JSON.parse(await reader.tokenMetadataJSON(n));
    // Same choice as the button: the override when present, otherwise the computed JSON.
    const source = existing || computed;
    const decision = GGUeFix.decideToken(source, baseURI, n);
    const row = {
      n,
      overridePresent: !!existing,
      alreadyCorrect: decision.action === 'skip',
      storedIcon: existing?.LSP4Metadata?.icon ?? null,
      storedImages: existing?.LSP4Metadata?.images ?? null,
      computedIcon: computed?.LSP4Metadata?.icon ?? null,
      computedImages: computed?.LSP4Metadata?.images ?? null,
      seed: source?.LSP4Metadata?.attributes ?? null,
    };
    if (decision.action !== 'update') {
      row.ethCall = ethCallForDecision(decision.action);
      report.tokens.push(row);
      if (decision.action !== 'skip') throw new Error(`token ${n} was not updated or skipped (${decision.action})`);
      continue;
    }
    const json = JSON.stringify(decision.metadata);
    const value = GGUeFix.encodeVerifiableURI(json, nobleKeccak);
    const data = GGUeFix.encodeSetDataForTokenId(n, value);
    const independent = readAbi.encodeFunctionData('setDataForTokenId', [id, GGUeFix.LSP4_METADATA_KEY, value]);
    if (data.toLowerCase() !== independent.toLowerCase()) throw new Error('calldata diverges from ethers at token ' + n);
    row.calldataBytes = (data.length - 2) / 2;
    row.imageFields = {
      icon: decision.metadata.LSP4Metadata.icon,
      images: decision.metadata.LSP4Metadata.images,
    };
    row.attributesPreserved = JSON.stringify(decision.metadata.LSP4Metadata.attributes) === JSON.stringify(source.LSP4Metadata.attributes);
    row.namePreserved = decision.metadata.LSP4Metadata.name === source.LSP4Metadata.name;
    try {
      const sim = await provider.call({ from: owner, to: ADDR, data });
      row.ethCall = { from: owner, ok: true, result: sim };
    } catch (e) {
      row.ethCall = { from: owner, ok: false, error: e.shortMessage || e.message };
      report.tokens.push(row);
      throw new Error(`eth_call reverted for token ${n}: ${row.ethCall.error}`);
    }
    row.image = await imageSize(decision.metadata.LSP4Metadata.icon[0].url);
    report.tokens.push(row);
    if (row.image.width !== 2400 || row.image.height !== 2400) {
      throw new Error(`token ${n} image is ${row.image.width}x${row.image.height}`);
    }
  }
  report.updated = report.tokens.filter((token) => token.ethCall?.ok === true).map((token) => token.n);
  report.skipped = report.tokens.filter((token) => token.ethCall === 'skipped').map((token) => token.n);
  report.ok = simulationReportOk(report.tokens);
} catch (e) {
  report.ok = false;
  report.error = e?.message || String(e);
}
return report;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const report = await simulateReadOnly();
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}
