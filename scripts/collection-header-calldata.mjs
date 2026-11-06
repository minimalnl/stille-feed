// Read-only check of the collection setData call. Does not send a transaction.
//   node scripts/collection-header-calldata.mjs

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AbiCoder } from 'ethers';
import { CONTRACT, OWNER, RPC, LSP4_METADATA_KEY } from './collection-header-data.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function call(data, from) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to: CONTRACT, from, data }, 'latest'],
    }),
  });
  const body = await res.json();
  return body;
}

const current = await call('0x54f6127f' + LSP4_METADATA_KEY.slice(2));
if (current.error) throw new Error(JSON.stringify(current.error));
const [currentBytes] = AbiCoder.defaultAbiCoder().decode(['bytes'], current.result);
const currentHex = String(currentBytes);
console.log('current collection LSP4Metadata', currentHex === '0x' ? 'empty' : currentHex);

const calldata = (await readFile(join(root, 'collection', 'setdata-calldata.txt'), 'utf8')).trim();
const simulated = await call(calldata, OWNER);
console.log(JSON.stringify({
  from: OWNER,
  to: CONTRACT,
  selector: calldata.slice(0, 10),
  ok: !simulated.error && typeof simulated.result === 'string',
  result: simulated.result ?? null,
  error: simulated.error ?? null,
  sentTransaction: false,
}, null, 2));
if (simulated.error) process.exit(1);
