// Read-only check of the approved collection-header update. Does not sign or send.
// Run: node scripts/collection-header-set.simulate.mjs
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { ethers } from 'ethers';
import { loadCollectionHeader } from './collection-header-set-load.mjs';

const H = loadCollectionHeader();
const RPC = 'https://rpc.mainnet.lukso.network';
const OWNER = '0x52224e802F722A3F3f1de8b2157597ae7fEfffD1';
const NEVER = '0x7070b7Cb8fAe99B6C7DDd0eaBe831DCb6c3047FD';

async function ethCall(from, data) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ from, to: H.CONTRACT, data }, 'latest'] }),
  });
  const body = await res.json();
  if (body.error) return { ok: false, error: body.error.message || JSON.stringify(body.error) };
  return { ok: true, result: body.result };
}

const report = {
  rpc: RPC,
  contract: H.CONTRACT,
  chainId: H.CHAIN_ID,
  sentTransaction: false,
};
const ownerCall = await ethCall(OWNER, ethers.id('owner()').slice(0, 10));
if (!ownerCall.ok) throw new Error(ownerCall.error);
const owner = ethers.AbiCoder.defaultAbiCoder().decode(['address'], ownerCall.result)[0];
report.owner = owner;
report.ownerIsExpected = owner.toLowerCase() === OWNER.toLowerCase();
report.ownerIsNot7070 = owner.toLowerCase() !== NEVER.toLowerCase();
if (!report.ownerIsExpected || !report.ownerIsNot7070) throw new Error('unexpected contract owner ' + owner);

const storedCall = await ethCall(OWNER, H.getDataCalldata());
if (!storedCall.ok) throw new Error(storedCall.error);
const stored = H.storedBytes(storedCall.result);
report.storedBytes = stored.length;
report.decision = H.decide(stored).action;

const filesOk = H.ARTWORK.every((art) => {
  const name = art.url.endsWith('1800.png') ? 'generative-square-header-1800.png' : 'generative-square-header.png';
  const local = fs.readFileSync(new URL('../collection/' + name, import.meta.url));
  return createHash('sha256').update(local).digest('hex') === art.sha256;
});
report.localArtworkMatchesApproved = filesOk;
report.artwork = [];
for (const art of H.ARTWORK) {
  const res = await fetch(art.url, { cache: 'no-store' });
  const buf = Buffer.from(await res.arrayBuffer());
  const hash = createHash('sha256').update(buf).digest('hex');
  report.artwork.push({ url: art.url, status: res.status, bytes: buf.length, hash, matchesApproved: hash === art.sha256 });
}
const hostedOk = report.artwork.every((item) => item.status === 200 && item.matchesApproved);

let prompts = 0;
const dry = await H.run({
  account: OWNER,
  chainId: 42,
  contract: '0x33Dd4D3da812e2cc1B3692456470DFDD99659e62',
  readStored: async () => stored,
  checkArtwork: () => H.checkArtwork(fetch),
  dryRun: async (data, account) => {
    report.dryRun = await ethCall(account, data);
    report.dryRun.dataMatchesApproved = data === H.APPROVED_CALLDATA;
    report.dryRun.from = account;
    if (!report.dryRun.ok) throw new Error(report.dryRun.error || 'dry-run reverted');
  },
  // The real button would open the wallet here. This run stops instead of signing.
  send: async (data, account) => {
    prompts += 1;
    report.prompt = { from: account, dataMatchesApproved: data === H.APPROVED_CALLDATA };
    const error = new Error('User rejected the request');
    error.code = 4001;
    throw error;
  },
});
report.button = { status: dry.status, sent: dry.sent, message: dry.message || '' };
report.promptAttempts = prompts;
report.forbiddenDryRun = await ethCall(NEVER, H.APPROVED_CALLDATA);
report.ok = report.ownerIsExpected
  && report.ownerIsNot7070
  && filesOk
  && hostedOk
  && report.decision === 'update'
  && report.button.status === 'cancelled'
  && report.button.sent === false
  && prompts === 1
  && report.prompt.dataMatchesApproved === true
  && report.prompt.from.toLowerCase() === OWNER.toLowerCase()
  && report.dryRun?.ok === true
  && report.dryRun.dataMatchesApproved === true
  && report.dryRun.from.toLowerCase() === OWNER.toLowerCase()
  && report.forbiddenDryRun.ok === false
  && report.sentTransaction === false;

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
