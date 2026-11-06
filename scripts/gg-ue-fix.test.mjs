// Regression tests for the owner-only UE image fix.
// Run: npm install --no-save --no-package-lock ethers@6.13.5 @noble/hashes@1.3.3 && node --test scripts/gg-ue-fix.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { ethers } from 'ethers';
import { keccak_256 } from '@noble/hashes/sha3';
import { loadGGUeFix } from './gg-ue-load.mjs';
import { ethCallForDecision, simulationReportOk } from './gg-ue-fix.simulate.mjs';

const GGUeFix = loadGGUeFix();
const BASE = 'https://minimalnl.github.io/stille-feed/gg/42/';
const NOT_OWNER = '0x7070b7Cb8fAe99B6C7DDd0eaBe831DCb6c3047FD';
const SOURCE = fs.readFileSync(new URL('../grid-ad.js', import.meta.url), 'utf8');

// Stored override shape verified on LUKSO mainnet for token 1 (icon 600, images only the 2400 file).
const STORED_OVERRIDE = {
  LSP4Metadata: {
    name: 'Generative Square #1',
    description: 'One square, its own seed. Script and seed live on-chain.',
    links: [],
    icon: [{ width: 600, height: 600, url: BASE + '1-600.png' }],
    images: [[{ width: 2400, height: 2400, url: BASE + '1.png' }]],
    assets: [],
    attributes: [{ key: 'Seed', value: 858479922, type: 'number' }],
  },
};
// tokenMetadataJSON() still returns this computed shape. It is not what UE shows once an override exists.
const COMPUTED = {
  LSP4Metadata: {
    name: 'Generative Square #1',
    description: 'One square, its own seed. Script and seed live on-chain.',
    links: [],
    icon: [],
    images: [[
      { width: 2400, height: 2400, url: BASE + '1.png' },
      { width: 600, height: 600, url: BASE + '1-600.png' },
    ]],
    assets: [],
    attributes: [{ key: 'Seed', value: 858479922, type: 'number' }],
  },
};

const keccak = (bytes) => ethers.keccak256(bytes);
const nobleKeccak = (bytes) => '0x' + Buffer.from(keccak_256(bytes)).toString('hex');

function pictured(metadata) {
  const lsp = metadata.LSP4Metadata;
  return JSON.stringify({ icon: lsp.icon, images: lsp.images });
}

test('LSP4 key is 32 bytes and matches keccak256("LSP4Metadata")', () => {
  const key = GGUeFix.LSP4_METADATA_KEY;
  assert.equal(key, ethers.keccak256(ethers.toUtf8Bytes('LSP4Metadata')));
  assert.equal(key.slice(2).length, 64);
  assert.equal(Buffer.from(key.slice(2), 'hex').length, 32);
});

test('selectors match ethers.id of the canonical signatures', () => {
  const sigs = {
    setDataForTokenId: 'setDataForTokenId(bytes32,bytes32,bytes)',
    getDataForTokenId: 'getDataForTokenId(bytes32,bytes32)',
    tokenMetadataJSON: 'tokenMetadataJSON(uint256)',
    imageBaseURI: 'imageBaseURI()',
  };
  for (const [name, sig] of Object.entries(sigs)) {
    assert.equal(GGUeFix.SEL[name], ethers.id(sig).slice(0, 10), sig);
  }
});

test('setDataForTokenId calldata matches ethers AbiCoder for real metadata', () => {
  const iface = new ethers.Interface(['function setDataForTokenId(bytes32 tokenId, bytes32 dataKey, bytes value)']);
  const decision = GGUeFix.decideToken(STORED_OVERRIDE, BASE, 1);
  assert.equal(decision.action, 'update');
  const json = JSON.stringify(decision.metadata);
  const value = GGUeFix.encodeVerifiableURI(json, keccak);
  for (const n of [1, 7, 255]) {
    const got = GGUeFix.encodeSetDataForTokenId(n, value);
    const expected = iface.encodeFunctionData('setDataForTokenId', [
      ethers.zeroPadValue(ethers.toBeHex(n), 32),
      GGUeFix.LSP4_METADATA_KEY,
      value,
    ]);
    assert.equal(got.toLowerCase(), expected.toLowerCase());
    const decoded = iface.decodeFunctionData('setDataForTokenId', got);
    assert.equal(decoded[1].toLowerCase(), GGUeFix.LSP4_METADATA_KEY);
    assert.equal(ethers.getBytes(decoded[1]).length, 32);
    assert.equal(decoded[2].toLowerCase(), value.toLowerCase());
  }
});

test('VerifiableURI uses a real keccak256 of the UTF-8 JSON and a base64 data URL', () => {
  const decision = GGUeFix.decideToken(structuredClone(STORED_OVERRIDE), BASE, 1);
  decision.metadata.LSP4Metadata.description += ' café';
  const json = JSON.stringify(decision.metadata);
  const value = GGUeFix.encodeVerifiableURI(json, keccak);
  const hex = value.slice(2);
  assert.equal(hex.slice(0, GGUeFix.VERIFIABLE_URI_PREFIX.length), GGUeFix.VERIFIABLE_URI_PREFIX);
  const digest = hex.slice(16, 16 + 64);
  const utf8 = ethers.toUtf8Bytes(json);
  assert.equal('0x' + digest, ethers.keccak256(utf8));
  assert.equal(nobleKeccak(utf8), ethers.keccak256(utf8));
  assert.equal(GGUeFix.encodeVerifiableURI(json, nobleKeccak), value);
  const url = Buffer.from(hex.slice(16 + 64), 'hex').toString('utf8');
  assert.match(url, /^data:application\/json;base64,/);
  const decoded = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64').toString('utf8');
  assert.equal(decoded, json);
  assert.match(decoded, /café/);
  const wrapped = ethers.AbiCoder.defaultAbiCoder().encode(['bytes'], [value]);
  // Objects created inside the grid-ad.js realm are not host-realm references.
  assert.equal(JSON.stringify(GGUeFix.tryDecodeStoredMetadata(wrapped)), json);
});

test('patched icon and images are the same 2400 original and keep the other LSP4 fields', () => {
  const before = structuredClone(STORED_OVERRIDE);
  before.LSP4Metadata.attributes.push({ key: 'Note', value: 'keep me', type: 'string' });
  before.LSP4Metadata.extra = { keep: true };
  const decision = GGUeFix.decideToken(before, BASE, 1);
  const lsp = decision.metadata.LSP4Metadata;
  const url = BASE + '1.png';
  assert.equal(JSON.stringify(lsp.icon), JSON.stringify([{ width: 2400, height: 2400, url }]));
  assert.equal(JSON.stringify(lsp.images), JSON.stringify([[{ width: 2400, height: 2400, url }]]));
  assert.equal(pictured(decision.metadata).includes('600'), false);
  assert.equal(GGUeFix.has600Image(decision.metadata), false);
  assert.equal(lsp.name, before.LSP4Metadata.name);
  assert.equal(lsp.description, before.LSP4Metadata.description);
  assert.equal(JSON.stringify(lsp.links), '[]');
  assert.equal(JSON.stringify(lsp.assets), '[]');
  assert.equal(JSON.stringify(lsp.attributes), JSON.stringify(before.LSP4Metadata.attributes));
  assert.equal(JSON.stringify(lsp.extra), JSON.stringify({ keep: true }));
  assert.equal(JSON.stringify(Object.keys(lsp)), JSON.stringify(Object.keys(before.LSP4Metadata)));
  assert.equal(before.LSP4Metadata.icon[0].width, 600);
});

test('computed metadata is not treated as already fixed, and a patch keeps its seed', () => {
  assert.equal(GGUeFix.isAlreadyCorrect(COMPUTED, BASE, 1), false);
  assert.equal(GGUeFix.isAlreadyCorrect(STORED_OVERRIDE, BASE, 1), false);
  const decision = GGUeFix.decideToken(COMPUTED, BASE, 1);
  assert.equal(decision.action, 'update');
  assert.equal(pictured(decision.metadata).includes('600'), false);
  assert.equal(JSON.stringify(decision.metadata.LSP4Metadata.attributes), JSON.stringify(COMPUTED.LSP4Metadata.attributes));
  assert.equal(decision.metadata.LSP4Metadata.name, 'Generative Square #1');
  assert.equal(GGUeFix.isAlreadyCorrect(decision.metadata, BASE, 1), true);
  assert.equal(GGUeFix.decideToken(decision.metadata, BASE, 1).action, 'skip');
});

test('idempotent retry skips tokens already updated and continues after a cancel', () => {
  const store = new Map([1, 2, 3, 4].map((n) => {
    const meta = structuredClone(STORED_OVERRIDE);
    meta.LSP4Metadata.name = `Generative Square #${n}`;
    meta.LSP4Metadata.icon[0].url = BASE + n + '-600.png';
    meta.LSP4Metadata.images[0][0].url = BASE + n + '.png';
    meta.LSP4Metadata.attributes[0].value = 1000 + n;
    return [n, meta];
  }));
  const pass = (cancelAt) => {
    const updated = [];
    const skipped = [];
    for (const n of [1, 2, 3, 4]) {
      const decision = GGUeFix.decideToken(store.get(n), BASE, n);
      if (decision.action === 'skip') { skipped.push(n); continue; }
      if (cancelAt === n) return { updated, skipped, cancelledAt: n };
      assert.equal(decision.metadata.LSP4Metadata.attributes[0].value, 1000 + n);
      assert.equal(pictured(decision.metadata).includes('600'), false);
      store.set(n, decision.metadata);
      updated.push(n);
    }
    return { updated, skipped, cancelledAt: null };
  };
  const first = pass(3);
  assert.deepEqual(first, { updated: [1, 2], skipped: [], cancelledAt: 3 });
  assert.match(GGUeFix.resultMessage({ ...first, minted: 4 }), /Cancelled at token 3\. Updated 2, skipped 0/);
  const second = pass(null);
  assert.deepEqual(second, { updated: [3, 4], skipped: [1, 2], cancelledAt: null });
  const third = pass(null);
  assert.deepEqual(third, { updated: [], skipped: [1, 2, 3, 4], cancelledAt: null });
  assert.match(GGUeFix.resultMessage({ updated: [], skipped: [1, 2, 3, 4], minted: 4 }), /Nothing to sign/);
});

test('missing override falls back without dropping the supplied seed', () => {
  assert.equal(GGUeFix.decideToken(null, BASE, 4).action, 'need-seed');
  const decision = GGUeFix.decideToken(null, BASE, 4, 176084045);
  assert.equal(decision.action, 'update');
  assert.equal(JSON.stringify(decision.metadata.LSP4Metadata.attributes), JSON.stringify([{ key: 'Seed', value: 176084045, type: 'number' }]));
  assert.equal(decision.metadata.LSP4Metadata.icon[0].url, BASE + '4.png');
  assert.equal(pictured(decision.metadata).includes('600'), false);
});

test('empty override decodes to null and a present data-JSON round-trips', () => {
  const empty = ethers.AbiCoder.defaultAbiCoder().encode(['bytes'], ['0x']);
  assert.equal(GGUeFix.tryDecodeStoredMetadata(empty), null);
  assert.equal(GGUeFix.tryDecodeStoredMetadata('0x'), null);
  const junk = ethers.AbiCoder.defaultAbiCoder().encode(['bytes'], ['0x010203']);
  assert.throws(() => GGUeFix.tryDecodeStoredMetadata(junk), /VerifiableURI|data JSON/);
});

test('owner guard accepts only the contract owner and never 0x7070', () => {
  assert.notEqual(GGUeFix.OWNER.toLowerCase(), NOT_OWNER.toLowerCase());
  assert.equal(GGUeFix.fixGuard(NOT_OWNER), 'Only the contract owner can fix metadata.');
  assert.equal(GGUeFix.fixGuard('0x52224e802F722A3F3f1de8b2157597ae7fEfffD1'), '');
  assert.equal(GGUeFix.fixGuard(GGUeFix.OWNER), '');
  assert.equal(GGUeFix.fixGuard(''), 'Connect to fix metadata.');
  assert.equal(GGUeFix.fixGuard(null), 'Connect to fix metadata.');
});

test('user-facing copy describes 2400 for both fields and the computed-metadata limit', () => {
  const note = GGUeFix.idleNote(7);
  const done = GGUeFix.resultMessage({ updated: [1], skipped: [2], minted: 7 });
  for (const text of [note, done, GGUeFix.LIMITATION]) {
    assert.doesNotMatch(text, /icon\s*=\s*600/i);
    assert.doesNotMatch(text, /-600\.png/);
    assert.match(text, /computed metadata/);
  }
  assert.match(note, /icon and images/);
  assert.match(note, /2400px/);
  assert.match(SOURCE, /GGUeFix\.decideToken/);
  assert.match(SOURCE, /GGUeFix\.encodeSetDataForTokenId/);
  assert.doesNotMatch(SOURCE, /icon=600/);
  assert.doesNotMatch(SOURCE, /\$\{baseURI\}\$\{[^}]+\}-600\.png/);
  assert.doesNotMatch(SOURCE, /width:\s*600,\s*height:\s*600/);
});

test('simulation report accepts all-skipped and mixed updated+skipped runs', () => {
  assert.equal(ethCallForDecision('skip'), 'skipped');
  assert.equal(ethCallForDecision('update'), 'update');
  const skipped = (n) => ({ n, ethCall: ethCallForDecision('skip') });
  const updated = (n) => ({ n, ethCall: { from: GGUeFix.OWNER, ok: true, result: '0x' } });
  const failed = (n) => ({ n, ethCall: { ok: false, error: 'execution reverted' } });
  const allSkipped = [skipped(1), skipped(2), skipped(3), skipped(4), skipped(5), skipped(6), skipped(7)];
  const mixed = [updated(1), skipped(2), updated(3), skipped(4)];
  assert.equal(simulationReportOk(allSkipped), true);
  assert.deepEqual(allSkipped.map((token) => token.ethCall), ['skipped', 'skipped', 'skipped', 'skipped', 'skipped', 'skipped', 'skipped']);
  assert.equal(simulationReportOk(mixed), true);
  assert.equal(simulationReportOk([updated(1), updated(2)]), true);
  // The previous check looked for 'skipped' while the row stored decideToken's 'skip'.
  assert.equal(simulationReportOk([{ n: 1, ethCall: 'skip' }]), false);
  assert.equal(simulationReportOk([updated(1), { n: 2, ethCall: 'skip' }]), false);
  assert.equal(simulationReportOk([updated(1), failed(2), skipped(3)]), false);
  assert.equal(simulationReportOk([{ n: 1, ethCall: { ok: true } }, failed(2)]), false);
});
