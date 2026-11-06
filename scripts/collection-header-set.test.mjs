// Owner-only collection header: guards, exact approved calldata, cancel, and retry.
// Run: npm install --no-save --no-package-lock ethers@6.13.5 && node --test scripts/collection-header-set.test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { ethers } from 'ethers';
import { loadCollectionHeader } from './collection-header-set-load.mjs';
import { loadGGUeFix } from './gg-ue-load.mjs';

const H = loadCollectionHeader();
const Fix = loadGGUeFix();
const SOURCE = fs.readFileSync(new URL('../grid-ad.js', import.meta.url), 'utf8');
const OWNER = '0x52224e802F722A3F3f1de8b2157597ae7fEfffD1';
const NEVER = '0x7070b7Cb8fAe99B6C7DDd0eaBe831DCb6c3047FD';
const CONTRACT = '0x33Dd4D3da812e2cc1B3692456470DFDD99659e62';
const CALLDATA = fs.readFileSync(new URL('../collection/setdata-calldata.txt', import.meta.url), 'utf8').trim();
const VALUE = fs.readFileSync(new URL('../collection/setdata-value.txt', import.meta.url), 'utf8').trim();
const JSON_TEXT = fs.readFileSync(new URL('../collection/lsp4-metadata.json', import.meta.url), 'utf8').trim();

function view(value) {
  return JSON.parse(JSON.stringify(value));
}

function readyDeps(overrides = {}) {
  const calls = { art: 0, dry: 0, send: 0, order: [] };
  const deps = {
    account: OWNER,
    chainId: 42,
    contract: CONTRACT,
    readStored: async () => '0x',
    checkArtwork: async () => { calls.art += 1; calls.order.push('art'); return { ok: true }; },
    dryRun: async () => { calls.dry += 1; calls.order.push('dry'); },
    send: async (data, account) => {
      calls.send += 1;
      calls.order.push('send');
      calls.data = data;
      calls.from = account;
      return '0x' + 'ab'.repeat(32);
    },
    ...overrides,
  };
  return { deps, calls };
}

test('the button is locked to the approved header calldata and the LSP4 key only', () => {
  assert.equal(H.APPROVED_CALLDATA, CALLDATA);
  assert.equal(H.APPROVED_VALUE, VALUE);
  assert.equal(H.SET_DATA, ethers.id('setData(bytes32,bytes)').slice(0, 10));
  assert.equal(H.GET_DATA, ethers.id('getData(bytes32)').slice(0, 10));
  assert.equal(H.LSP4_METADATA_KEY, ethers.id('LSP4Metadata'));
  assert.equal(H.getDataCalldata(), ethers.Interface.from(['function getData(bytes32)']).encodeFunctionData('getData', [H.LSP4_METADATA_KEY]));
  const iface = new ethers.Interface(['function setData(bytes32 dataKey, bytes dataValue)']);
  const encoded = iface.encodeFunctionData('setData', [H.LSP4_METADATA_KEY, H.APPROVED_VALUE]);
  assert.equal(encoded.toLowerCase(), CALLDATA.toLowerCase());
  const decoded = iface.decodeFunctionData('setData', H.APPROVED_CALLDATA);
  assert.equal(decoded[0].toLowerCase(), H.LSP4_METADATA_KEY);
  assert.equal(decoded[1].toLowerCase(), H.APPROVED_VALUE.toLowerCase());
  assert.equal(CALLDATA.slice(0, 10), H.SET_DATA);
  assert.equal(CALLDATA.includes(Fix.SEL.setDataForTokenId.slice(2)), false);
  for (const name of ['LSP4TokenName', 'LSP4TokenSymbol', 'LSP4TokenType']) {
    assert.equal(CALLDATA.toLowerCase().includes(ethers.id(name).slice(2)), false);
  }
  const url = Buffer.from(VALUE.slice(2 + 16 + 64), 'hex').toString('utf8');
  const json = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64').toString('utf8');
  assert.equal(json, JSON_TEXT);
  assert.equal(json.includes('-600.png'), false);
  assert.match(json, /generative-square-header\.png/);
  assert.match(json, /generative-square-header-1800\.png/);
});

test('guards accept only the owner on chain 42 and never 0x7070', () => {
  assert.notEqual(H.OWNER.toLowerCase(), H.NEVER.toLowerCase());
  assert.equal(H.OWNER.toLowerCase(), OWNER.toLowerCase());
  assert.equal(H.NEVER.toLowerCase(), NEVER.toLowerCase());
  assert.equal(H.CHAIN_ID, 42);
  assert.equal(H.guard(null, 42, CONTRACT), H.MSG.connect);
  assert.equal(H.guard('', 42, CONTRACT), H.MSG.connect);
  assert.equal(H.guard(NEVER, 42, CONTRACT), H.MSG.owner);
  assert.equal(H.guard('0x7777c761e451D44F2B7C01D94318996128bc051d', 42, CONTRACT), H.MSG.owner);
  assert.equal(H.guard(OWNER, 1, CONTRACT), H.MSG.chain);
  assert.equal(H.guard(OWNER, 4201, CONTRACT), H.MSG.chain);
  assert.equal(H.guard(OWNER, '0x2a', CONTRACT), '');
  assert.equal(H.guard(OWNER, 42, '0xF4947C5F85115D9FA6c039Ac459C630370F8F239'), H.MSG.contract);
  assert.equal(H.guard(OWNER, 42, CONTRACT), '');
  assert.equal(Fix.OWNER.toLowerCase(), H.OWNER.toLowerCase());
});

test('empty metadata can be set, the approved value is skipped, and anything else stops', () => {
  assert.equal(H.decide('0x').action, 'update');
  assert.equal(H.decide(null).action, 'update');
  assert.equal(H.decide(H.APPROVED_VALUE).action, 'skip');
  assert.equal(H.decide(H.APPROVED_VALUE.toUpperCase()).action, 'skip');
  const empty = ethers.AbiCoder.defaultAbiCoder().encode(['bytes'], ['0x']);
  assert.equal(H.decide(H.storedBytes(empty)).action, 'update');
  const present = ethers.AbiCoder.defaultAbiCoder().encode(['bytes'], [H.APPROVED_VALUE]);
  assert.equal(H.decide(H.storedBytes(present)).action, 'skip');
  const other = ethers.AbiCoder.defaultAbiCoder().encode(['bytes'], ['0x00008019f9b10020']);
  assert.equal(H.decide(H.storedBytes(other)).action, 'review');
  assert.equal(H.decide('0x01').action, 'review');
  assert.throws(() => H.storedBytes('0x1234'), (error) => error.review === true);
});

test('artwork check accepts only the two approved files', async () => {
  const files = H.ARTWORK.map((art) => {
    const name = art.url.endsWith('1800.png')
      ? 'generative-square-header-1800.png'
      : 'generative-square-header.png';
    const bytes = fs.readFileSync(new URL('../collection/' + name, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), art.sha256);
    assert.equal(H.pngSize(bytes).width, art.width);
    assert.equal(H.pngSize(bytes).height, art.height);
    return bytes;
  });
  const ok = view(await H.checkArtwork(async (url) => ({
    ok: true,
    async arrayBuffer() {
      const art = H.ARTWORK.find((item) => item.url === url);
      const file = files[H.ARTWORK.indexOf(art)];
      return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    },
  })));
  assert.equal(ok.ok, true);
  const missing = view(await H.checkArtwork(async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) })));
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'unavailable');
  const wrong = Buffer.from(files[0]);
  wrong[80] ^= 0xff;
  const mismatch = view(await H.checkArtwork(async (url) => ({
    ok: true,
    async arrayBuffer() {
      const file = url.endsWith('1800.png') ? files[1] : wrong;
      return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    },
  })));
  assert.equal(mismatch.reason, 'mismatch');
});

test('a prepared update dry-runs the exact calldata before the wallet, and a failed dry-run does not send', async () => {
  const { deps, calls } = readyDeps();
  const result = view(await H.run(deps));
  assert.equal(result.status, 'sent');
  assert.equal(result.sent, true);
  assert.deepEqual(calls.order, ['art', 'dry', 'send']);
  assert.equal(calls.data, CALLDATA);
  assert.equal(calls.from.toLowerCase(), OWNER.toLowerCase());
  const stopped = readyDeps({
    dryRun: async () => { throw new Error('execution reverted'); },
  });
  const reverted = view(await H.run(stopped.deps));
  assert.equal(reverted.status, 'reverted');
  assert.equal(reverted.sent, false);
  assert.equal(stopped.calls.send, 0);
});

test('skip, review, a missing banner, and the wrong account never reach the wallet', async () => {
  const cases = [
    { readStored: async () => H.APPROVED_VALUE, status: 'skipped', art: 0 },
    { readStored: async () => '0x010203', status: 'review', art: 0 },
    { readStored: async () => { const error = new Error('bad'); error.review = true; throw error; }, status: 'review', art: 0 },
    { readStored: async () => { throw new Error('rpc'); }, status: 'blocked', art: 0 },
    { checkArtwork: async () => ({ ok: false, reason: 'unavailable', message: H.MSG.unavailable }), status: 'blocked', art: 1 },
    { checkArtwork: async () => ({ ok: false, reason: 'mismatch', message: H.MSG.mismatch }), status: 'review', art: 1 },
    { account: NEVER, status: 'blocked', art: 0 },
    { account: null, status: 'blocked', art: 0 },
    { chainId: 4201, status: 'blocked', art: 0 },
    { contract: '0xF4947C5F85115D9FA6c039Ac459C630370F8F239', status: 'blocked', art: 0 },
  ];
  for (const item of cases) {
    const { status, art, ...depOverrides } = item;
    const { deps, calls } = readyDeps(depOverrides);
    const result = view(await H.run(deps));
    assert.equal(result.status, status, JSON.stringify(item));
    assert.equal(result.sent, false);
    assert.equal(calls.send, 0);
    assert.equal(calls.dry, 0);
    if (!depOverrides.checkArtwork) assert.equal(calls.art, art);
  }
});

test('cancel can be retried, and a second click during the prompt does not send twice', async () => {
  let mode = 'hold';
  let gate;
  let sends = 0;
  const { deps } = readyDeps({
    send: (data, account) => {
      sends += 1;
      assert.equal(data, CALLDATA);
      assert.equal(String(account).toLowerCase(), OWNER.toLowerCase());
      if (mode === 'hold') return new Promise((resolve, reject) => { gate = { resolve, reject }; });
      if (mode === 'cancel') { const error = new Error('User rejected the request'); error.code = 4001; throw error; }
      return '0x' + '11'.repeat(32);
    },
  });
  const click = H.createClick(deps);
  const first = click();
  for (let i = 0; i < 20 && sends === 0; i++) await Promise.resolve();
  assert.equal(sends, 1);
  const second = view(await click());
  assert.equal(second.status, 'busy');
  assert.equal(second.sent, false);
  assert.equal(sends, 1);
  const error = new Error('User rejected the request');
  error.code = 4001;
  gate.reject(error);
  const cancelled = view(await first);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.sent, false);
  mode = 'cancel';
  const rejected = view(await click());
  assert.equal(rejected.status, 'cancelled');
  assert.equal(sends, 2);
  mode = 'ok';
  const sent = view(await click());
  assert.equal(sent.status, 'sent');
  assert.equal(sent.sent, true);
  assert.equal(sends, 3);
});

test('the page asks the wallet only from the header click, and the 2400 token fix stays in place', () => {
  const mentions = SOURCE.match(/setCollectionHeader\(\)/g) || [];
  assert.deepEqual(mentions, ['setCollectionHeader()', 'setCollectionHeader()']);
  assert.equal((SOURCE.match(/=> setCollectionHeader\(\)/g) || []).length, 1);
  const headerFn = SOURCE.slice(SOURCE.indexOf('async function setCollectionHeader'), SOURCE.indexOf('async function connect'));
  assert.match(headerFn, /if \(st\.headerBusy\) return/);
  assert.match(headerFn, /headerClick\(\)/);
  assert.doesNotMatch(headerFn, /eth_sendTransaction/);
  assert.doesNotMatch(headerFn, /ensureChain/);
  assert.doesNotMatch(headerFn, /setDataForTokenId/);
  const click = SOURCE.slice(SOURCE.indexOf('const headerClick'), SOURCE.indexOf('async function setCollectionHeader'));
  assert.match(click, /eth_sendTransaction/);
  assert.match(click, /to: GGCollectionHeader\.CONTRACT/);
  assert.match(click, /value: '0x0'/);
  assert.match(click, /checkArtwork\(fetch\)/);
  assert.match(SOURCE, /GGUeFix\.decideToken/);
  assert.match(SOURCE, /GGUeFix\.encodeSetDataForTokenId/);
  assert.match(SOURCE, /id="ggHeader"|ggHeader/);
  assert.match(fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8'), /id="ggHeader"/);
});
