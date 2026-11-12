// Grid account vs standalone extension. Connect never sends a transaction.
// Run: node --test scripts/gg-connect.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

function loadHelpers() {
  const sandbox = {
    console,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    crypto: webcrypto,
    atob,
    btoa,
    location: { search: '' },
    document: { getElementById() { return null; } },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(new URL('../grid-ad.js', import.meta.url), 'utf8'), sandbox, { filename: 'grid-ad.js' });
  return sandbox;
}

const sandbox = loadHelpers();
const G = sandbox.GGConnect;
const Fix = sandbox.GGUeFix;
const Header = sandbox.GGCollectionHeader;
const SOURCE = fs.readFileSync(new URL('../grid-ad.js', import.meta.url), 'utf8');
const GRID = '0x78780000000000000000000000000000000047fd';
const EXTENSION = '0x0400000000000000000000000000000000001491';
const OWNER = '0x52224e802F722A3F3f1de8b2157597ae7fEfffD1';
const NEVER = '0x7070b7Cb8fAe99B6C7DDd0eaBe831DCb6c3047FD';
const CONTRACT = '0x33Dd4D3da812e2cc1B3692456470DFDD99659e62';

function extensionWallet(name, rdns) {
  return { info: { name, rdns }, provider: { id: rdns } };
}

test('inside the Grid the logged-in Grid account is used, not the extension', () => {
  const extension = extensionWallet('Universal Profile', 'io.lukso.universalprofile');
  const rabby = extensionWallet('Rabby', 'io.rabby');
  const grid = {
    isUPClientProvider: true,
    contextAccounts: [GRID],
    accounts: [EXTENSION],
  };
  const announcedGrid = { info: { name: 'UE Universal Profile', rdns: 'dev.lukso.auth' }, provider: grid };
  const choice = G.chooseWallets({
    inGrid: true,
    gridProvider: grid,
    extensions: [extension, announcedGrid, rabby],
  });
  assert.equal(choice.useGrid, true);
  assert.equal(choice.active.kind, 'grid');
  assert.equal(choice.active.provider, grid);
  assert.equal(choice.wallets[0], choice.active);
  assert.equal(JSON.stringify(choice.wallets.slice(1).map((wallet) => wallet.info.name)), JSON.stringify(['Universal Profile', 'Rabby']));
  assert.equal(G.gridAccount(grid).toLowerCase(), GRID);
  assert.equal(G.mintAccount({ useGrid: true, gridAccount: GRID, allowed: [EXTENSION] }), null);
  assert.equal(G.mintAccount({ useGrid: true, gridAccount: GRID, allowed: [GRID] }).toLowerCase(), GRID);
  const mismatch = G.acceptConnectedAccount({ useGrid: true, gridAccount: GRID, requested: [EXTENSION] });
  assert.equal(mismatch.account, null);
  assert.equal(mismatch.mismatch, true);
  const matched = G.acceptConnectedAccount({ useGrid: true, gridAccount: GRID, requested: [GRID] });
  assert.equal(matched.account.toLowerCase(), GRID);
  assert.equal(matched.mismatch, false);
  assert.equal(G.acceptConnectedAccount({ useGrid: true, gridAccount: null, requested: [EXTENSION] }).waiting, true);
});

test('a normal browser still uses the extension and can remember Rabby', () => {
  const up = extensionWallet('Universal Profile', 'io.lukso.universalprofile');
  const rabby = extensionWallet('Rabby', 'io.rabby');
  const choice = G.chooseWallets({ inGrid: false, gridProvider: null, extensions: [up, rabby] });
  assert.equal(choice.useGrid, false);
  assert.equal(choice.active, null);
  assert.deepEqual(choice.wallets, [up, rabby]);
  assert.equal(G.mintAccount({ useGrid: false, gridAccount: null, allowed: [EXTENSION] }).toLowerCase(), EXTENSION);
  const accepted = G.acceptConnectedAccount({ useGrid: false, gridAccount: null, requested: [EXTENSION] });
  assert.equal(accepted.account.toLowerCase(), EXTENSION);
  assert.equal(G.isGridProvider(up), false);
  assert.equal(G.isGridProvider({ info: { rdns: 'dev.lukso.auth' }, provider: {} }), true);
});

test('without a Grid provider the extension is only a fallback, not the automatic account', () => {
  const extension = extensionWallet('Universal Profile', 'io.lukso.universalprofile');
  const choice = G.chooseWallets({ inGrid: true, gridProvider: null, extensions: [extension] });
  assert.equal(choice.useGrid, false);
  assert.equal(choice.active, null);
  assert.equal(choice.wallets[0], extension);
});

test('connect asks for accounts and refuses to send or sign', () => {
  G.assertConnectMethod('eth_requestAccounts');
  G.assertConnectMethod('eth_accounts');
  for (const method of ['eth_sendTransaction', 'eth_signTransaction', 'personal_sign', 'eth_sign']) {
    assert.throws(() => G.assertConnectMethod(method), /connect must not send or sign/);
  }
  const connectFn = SOURCE.slice(SOURCE.indexOf('async function connect'), SOURCE.indexOf('function findWallets'));
  assert.match(connectFn, /eth_requestAccounts/);
  assert.doesNotMatch(connectFn, /eth_sendTransaction/);
  assert.doesNotMatch(connectFn, /personal_sign/);
  const initFn = SOURCE.slice(SOURCE.indexOf('async function initProvider'), SOURCE.indexOf('async function previewFromUrl'));
  const allowedFn = SOURCE.slice(SOURCE.indexOf('async function readAllowed'), SOURCE.indexOf('async function connect'));
  assert.match(initFn, /GGConnect\.chooseWallets/);
  assert.match(initFn, /waitForGridProfile/);
  assert.match(initFn, /readAllowed/);
  assert.match(allowedFn, /eth_accounts/);
  assert.doesNotMatch(allowedFn, /eth_requestAccounts/);
  assert.doesNotMatch(initFn, /eth_requestAccounts/);
  assert.doesNotMatch(initFn, /eth_sendTransaction/);
  assert.doesNotMatch(initFn, /hasRealExtension/);
  assert.doesNotMatch(SOURCE, /st\.wallets = \[upWallet\]/);
  assert.doesNotMatch(SOURCE, /!st\.useUpProvider \?/);
});

test('owner controls still accept only 0x5222 and refuse 0x7070', () => {
  assert.notEqual(Fix.OWNER.toLowerCase(), NEVER.toLowerCase());
  assert.equal(Fix.OWNER.toLowerCase(), OWNER.toLowerCase());
  assert.equal(Header.OWNER.toLowerCase(), OWNER.toLowerCase());
  assert.equal(Header.NEVER.toLowerCase(), NEVER.toLowerCase());
  assert.equal(Fix.fixGuard(NEVER), 'Only the contract owner can fix metadata.');
  assert.equal(Fix.fixGuard(OWNER), '');
  assert.equal(Header.guard(NEVER, 42, CONTRACT), Header.MSG.owner);
  assert.equal(Header.guard(OWNER, 42, CONTRACT), '');
  assert.equal(Header.guard('0x0400000000000000000000000000000000001491', 42, CONTRACT), Header.MSG.owner);
});
