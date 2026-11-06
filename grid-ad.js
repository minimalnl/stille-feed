// Generative Grid: a quiet "tip the creator" block at the bottom of the feed. Live preview, counter, price,
// and minting 1-5 pieces. Inside the LUKSO Grid it mints via up-provider (shared with app.js, window.qfUP);
// in a normal browser via the Universal Profile extension (EIP-6963 / window.lukso, fallback window.ethereum).
// ?gg=<number> shows that minted piece in the preview instead of a random seed.
//
// The contract has one mint() per piece (exact price, no batch). "Mint 3" therefore sends 3 transactions,
// one after the other: each is simulated first, sent with the exact price of that number, and confirmed
// before the next. Anything unexpected (price changed, sold out, not enough LYX, rejected) stops the run;
// a failed mint reverts and costs only gas.
//
// Mainnet by default; testnet still available via ?ggnet=testnet.
const GG_NET = new URLSearchParams(location.search).get('ggnet') === 'testnet' ? 'testnet' : 'mainnet';

const GG_NETS = {
  testnet: { chainId: 4201, name: 'LUKSO Testnet', symbol: 'LYXt', rpc: 'https://rpc.testnet.lukso.network',
    address: '0xF4947C5F85115D9FA6c039Ac459C630370F8F239', explorer: 'https://explorer.execution.testnet.lukso.network' },
  mainnet: { chainId: 42, name: 'LUKSO', symbol: 'LYX', rpc: 'https://rpc.mainnet.lukso.network',
    address: '0x33Dd4D3da812e2cc1B3692456470DFDD99659e62', explorer: 'https://explorer.execution.mainnet.lukso.network' },
};

// Pure LSP4 helpers for the owner-only "Fix images for UE" tool. Universal Everything follows the
// per-token getDataForTokenId override. The contract's tokenMetadataJSON() stays the immutable
// computed metadata (it still mentions the 600px file) until a new deployment, which this tool is not.
const GGUeFix = (() => {
  const OWNER = '0x52224e802f722a3f3f1de8b2157597ae7fefffd1';
  const LSP4_METADATA_KEY = '0x9afb95cacc9f95858ec44aa8c3b685511002e30ae54415823f406128b85b238e';
  // 0x0000 + keccak256(utf8) method 0x8019f9b1 + hash length 0x0020. Matches bytes already stored on the contract.
  const VERIFIABLE_URI_PREFIX = '00008019f9b10020';
  const SEL = {
    tokenMetadataJSON: '0xdd36d1d2', // tokenMetadataJSON(uint256)
    imageBaseURI: '0x77645839',
    setDataForTokenId: '0xd6c1407c',
    getDataForTokenId: '0x16e023b3',
  };
  const SIZE = 2400;
  const LIMITATION = 'New mints still get the contract\'s computed metadata until you run this again.';

  const originalUrl = (baseURI, tokenId) => `${baseURI}${tokenId}.png`;
  const image2400 = (url) => ({ width: SIZE, height: SIZE, url });
  const lsp4 = (metadata) => {
    if (!metadata || typeof metadata !== 'object') return null;
    if (metadata.LSP4Metadata && typeof metadata.LSP4Metadata === 'object') return metadata.LSP4Metadata;
    return metadata;
  };
  const pictureList = (value, out) => {
    if (Array.isArray(value)) { value.forEach((item) => pictureList(item, out)); return; }
    if (value && typeof value === 'object' && ('url' in value || 'width' in value || 'height' in value)) out.push(value);
  };
  const has600Image = (metadata) => {
    const lsp = lsp4(metadata);
    if (!lsp) return false;
    const pics = [];
    pictureList(lsp.icon, pics);
    pictureList(lsp.images, pics);
    return pics.some((img) => Number(img.width) === 600 || Number(img.height) === 600 || String(img.url || '').includes('-600.png'));
  };
  const isOne2400 = (img, url) => !!img && typeof img === 'object' && Number(img.width) === SIZE && Number(img.height) === SIZE && img.url === url;
  function isAlreadyCorrect(metadata, baseURI, tokenId) {
    const lsp = lsp4(metadata);
    if (!lsp) return false;
    const url = originalUrl(baseURI, tokenId);
    if (!Array.isArray(lsp.icon) || lsp.icon.length !== 1 || !isOne2400(lsp.icon[0], url)) return false;
    if (!Array.isArray(lsp.images) || lsp.images.length !== 1 || !Array.isArray(lsp.images[0]) || lsp.images[0].length !== 1) return false;
    if (!isOne2400(lsp.images[0][0], url)) return false;
    return !has600Image(metadata);
  }
  function withOriginalImages(metadata, baseURI, tokenId) {
    if (!metadata || typeof metadata !== 'object') throw new Error('missing metadata');
    const next = JSON.parse(JSON.stringify(metadata));
    const url = originalUrl(baseURI, tokenId);
    const lsp = next.LSP4Metadata && typeof next.LSP4Metadata === 'object' ? next.LSP4Metadata : next;
    lsp.icon = [image2400(url)];
    lsp.images = [[image2400(url)]];
    return next.LSP4Metadata ? next : { LSP4Metadata: next };
  }
  function fallbackMetadata(tokenId, baseURI, seed) {
    const url = originalUrl(baseURI, tokenId);
    return {
      LSP4Metadata: {
        name: `Generative Square #${tokenId}`,
        description: 'One square, its own seed. Script and seed live on-chain.',
        links: [],
        icon: [image2400(url)],
        images: [[image2400(url)]],
        assets: [],
        attributes: [{ key: 'Seed', value: seed, type: 'number' }],
      },
    };
  }
  function assertImageFields2400(metadata, baseURI, tokenId) {
    if (!isAlreadyCorrect(metadata, baseURI, tokenId) || has600Image(metadata)) {
      throw new Error('metadata image fields are not the 2400 original');
    }
  }
  // action: 'skip' | 'need-seed' | 'update'. Patch keeps every field except icon and images.
  function decideToken(existing, baseURI, tokenId, seed) {
    if (isAlreadyCorrect(existing, baseURI, tokenId)) return { action: 'skip' };
    if (!existing) {
      if (seed == null) return { action: 'need-seed' };
      const metadata = fallbackMetadata(tokenId, baseURI, seed);
      assertImageFields2400(metadata, baseURI, tokenId);
      return { action: 'update', metadata };
    }
    const metadata = withOriginalImages(existing, baseURI, tokenId);
    assertImageFields2400(metadata, baseURI, tokenId);
    return { action: 'update', metadata };
  }
  function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function utf8FromBase64(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function encodeVerifiableURI(jsonStr, keccak256) {
    const jsonBytes = new TextEncoder().encode(jsonStr);
    const digest = String(keccak256(jsonBytes)).replace(/^0x/i, '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error('keccak256 must be 32 bytes');
    const dataURL = 'data:application/json;base64,' + utf8ToBase64(jsonStr);
    const urlHex = Array.from(new TextEncoder().encode(dataURL), (b) => b.toString(16).padStart(2, '0')).join('');
    return '0x' + VERIFIABLE_URI_PREFIX + digest + urlHex;
  }
  function encodeSetDataForTokenId(tokenId, valueHex) {
    const key = LSP4_METADATA_KEY.replace(/^0x/i, '');
    if (key.length !== 64) throw new Error('LSP4Metadata key must be 32 bytes');
    const value = String(valueHex).replace(/^0x/i, '').toLowerCase();
    if (!value || value.length % 2) throw new Error('metadata value must be even hex');
    const valueBytes = value.length / 2;
    const padBytes = (32 - (valueBytes % 32)) % 32;
    const head = SEL.setDataForTokenId.replace(/^0x/i, '')
      + BigInt(tokenId).toString(16).padStart(64, '0')
      + key
      + '60'.padStart(64, '0')
      + BigInt(valueBytes).toString(16).padStart(64, '0');
    return '0x' + head + value + '0'.repeat(padBytes * 2);
  }
  function decodeAbiBytes(hex) {
    if (hex == null) return new Uint8Array();
    let h = String(hex).toLowerCase();
    if (h.startsWith('0x')) h = h.slice(2);
    if (!h || /^0+$/.test(h)) return new Uint8Array();
    if (h.length < 64) throw new Error('short ABI bytes');
    const offsetBytes = Number.parseInt(h.slice(0, 64), 16);
    if (!Number.isFinite(offsetBytes)) throw new Error('bad ABI offset');
    const offset = offsetBytes * 2;
    if (h.length < offset + 64) throw new Error('truncated ABI bytes');
    const len = Number.parseInt(h.slice(offset, offset + 64), 16);
    if (!Number.isFinite(len) || len < 0) throw new Error('bad ABI length');
    if (len === 0) return new Uint8Array();
    const start = offset + 64;
    if (h.length < start + len * 2) throw new Error('truncated ABI bytes');
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      const byte = Number.parseInt(h.slice(start + i * 2, start + i * 2 + 2), 16);
      if (!Number.isFinite(byte)) throw new Error('bad ABI data');
      out[i] = byte;
    }
    return out;
  }
  // null when the token has no override yet. Throws when bytes are present but not data-JSON,
  // so the tool stops instead of replacing metadata it cannot read.
  function tryDecodeStoredMetadata(callResultHex) {
    const bytes = decodeAbiBytes(callResultHex);
    if (bytes.length === 0) return null;
    const v = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    let urlHex;
    if (v.startsWith('0000')) {
      const hashLen = Number.parseInt(v.slice(12, 16), 16);
      if (!Number.isFinite(hashLen)) throw new Error('bad VerifiableURI hash length');
      const urlStart = 16 + hashLen * 2;
      if (v.length < urlStart) throw new Error('truncated VerifiableURI');
      urlHex = v.slice(urlStart);
    } else if (v.length >= 8 + 64) {
      urlHex = v.slice(8 + 64);
    } else {
      throw new Error('Stored LSP4 metadata is not a VerifiableURI');
    }
    if (urlHex.length % 2) throw new Error('odd url hex');
    const urlBytes = new Uint8Array(urlHex.length / 2);
    for (let i = 0; i < urlBytes.length; i++) urlBytes[i] = Number.parseInt(urlHex.slice(i * 2, i * 2 + 2), 16);
    const url = new TextDecoder().decode(urlBytes);
    if (!url.startsWith('data:')) throw new Error('Stored LSP4 metadata URL is not a data JSON');
    const comma = url.indexOf(',');
    if (comma < 0) throw new Error('bad data URL');
    const json = /;base64/i.test(url.slice(0, comma)) ? utf8FromBase64(url.slice(comma + 1)) : decodeURIComponent(url.slice(comma + 1));
    const metadata = JSON.parse(json);
    if (!metadata || typeof metadata !== 'object') throw new Error('LSP4 JSON is not an object');
    return metadata;
  }
  function fixGuard(account) {
    if (!account) return 'Connect to fix metadata.';
    if (String(account).toLowerCase() !== OWNER.toLowerCase()) return 'Only the contract owner can fix metadata.';
    return '';
  }
  function idleNote(minted) {
    return `Points icon and images at the 2400px file for ${minted} tokens. ${LIMITATION}`;
  }
  function resultMessage({ updated = [], skipped = [], minted, cancelledAt, failedAt } = {}) {
    const up = updated.length;
    const sk = skipped.length;
    if (cancelledAt != null) return `Cancelled at token ${cancelledAt}. Updated ${up}, skipped ${sk}. Run again to continue. ${LIMITATION}`;
    if (failedAt != null) return `Stopped at token ${failedAt}. Updated ${up}, skipped ${sk}. Run again to continue. ${LIMITATION}`;
    if (!up) return `All ${minted} tokens already use the 2400px file. Nothing to sign. ${LIMITATION}`;
    return `Updated ${up} ${up === 1 ? 'token' : 'tokens'} (${updated.join(', ')}). Skipped ${sk} already on the 2400px file. ${LIMITATION}`;
  }
  return {
    OWNER, LSP4_METADATA_KEY, VERIFIABLE_URI_PREFIX, SEL, SIZE, LIMITATION,
    originalUrl, isAlreadyCorrect, has600Image, withOriginalImages, fallbackMetadata,
    assertImageFields2400, decideToken, encodeVerifiableURI, encodeSetDataForTokenId,
    decodeAbiBytes, tryDecodeStoredMetadata, fixGuard, idleNote, resultMessage,
  };
})();
globalThis.GGUeFix = GGUeFix;

// Owner-only collection header. One setData of LSP4Metadata, and only the banner
// approved in the merged header (ff6bf44 / merge 0360485). It does not write token
// metadata, name, symbol, price, seeds, or ownership.
const GGCollectionHeader = (() => {
  const OWNER = '0x52224e802f722a3f3f1de8b2157597ae7fefffd1';
  const NEVER = '0x7070b7cb8fae99b6c7ddd0eabe831dcb6c3047fd';
  const CHAIN_ID = 42;
  const CONTRACT = '0x33dd4d3da812e2cc1b3692456470dfdd99659e62';
  const LSP4_METADATA_KEY = '0x9afb95cacc9f95858ec44aa8c3b685511002e30ae54415823f406128b85b238e';
  const GET_DATA = '0x54f6127f'; // getData(bytes32)
  const SET_DATA = '0x7f23690c'; // setData(bytes32,bytes)
  const APPROVED_VALUE = '0x00008019f9b10020ed48b440a5fd04f2e8b547ef62f96c313ca146460d9a3ff202bd38d371266170646174613a6170706c69636174696f6e2f6a736f6e3b6261736536342c65794a4d553141305457563059575268644745694f6e7369626d46745a534936496b646c626d567959585270646d55675533463159584a6c496977695a47567a59334a7063485270623234694f694a50626d55676333463159584a6c4c43427064484d676233647549484e6c5a57517549464e6a636d6c7764434268626d51676332566c5a43427361585a6c494739754c574e6f59576c754c694973496d7870626d747a496a70625853776961574e76626949365733736964326c6b644767694f6a63794d444173496d686c6157646f644349364d6a51774d43776964584a73496a6f696148523063484d364c7939746157357062574673626d77755a326c30614856694c6d6c764c334e30615778735a53316d5a57566b4c324e766247786c59335270623234765a3256755a584a6864476c325a53317a63585668636d5574614756685a4756794c6e42755a794a394c48736964326c6b644767694f6a45344d444173496d686c6157646f644349364e6a41774c434a31636d77694f694a6f64485277637a6f764c323170626d6c74595778756243356e6158526f6457497561573876633352706247786c4c575a6c5a575176593239736247566a64476c766269396e5a57356c636d463061585a6c4c584e78645746795a53316f5a57466b5a5849744d5467774d433577626d636966563073496d6c745957646c6379493657317437496e64705a48526f496a6f334d6a41774c434a6f5a576c6e614851694f6a49304d444173496e567962434936496d68306448427a4f69387662576c7561573168624735734c6d647064476831596935706279397a64476c73624755745a6d566c5a43396a623278735a574e30615739754c32646c626d567959585270646d55746333463159584a6c4c57686c5957526c63693577626d636966537837496e64705a48526f496a6f784f4441774c434a6f5a576c6e614851694f6a59774d43776964584a73496a6f696148523063484d364c7939746157357062574673626d77755a326c30614856694c6d6c764c334e30615778735a53316d5a57566b4c324e766247786c59335270623234765a3256755a584a6864476c325a53317a63585668636d5574614756685a4756794c5445344d4441756347356e496e31645853776959584e7a5a58527a496a70625853776959585230636d6c696458526c637949365731313966513d3d';
  const APPROVED_CALLDATA = '0x7f23690c9afb95cacc9f95858ec44aa8c3b685511002e30ae54415823f406128b85b238e000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000003b100008019f9b10020ed48b440a5fd04f2e8b547ef62f96c313ca146460d9a3ff202bd38d371266170646174613a6170706c69636174696f6e2f6a736f6e3b6261736536342c65794a4d553141305457563059575268644745694f6e7369626d46745a534936496b646c626d567959585270646d55675533463159584a6c496977695a47567a59334a7063485270623234694f694a50626d55676333463159584a6c4c43427064484d676233647549484e6c5a57517549464e6a636d6c7764434268626d51676332566c5a43427361585a6c494739754c574e6f59576c754c694973496d7870626d747a496a70625853776961574e76626949365733736964326c6b644767694f6a63794d444173496d686c6157646f644349364d6a51774d43776964584a73496a6f696148523063484d364c7939746157357062574673626d77755a326c30614856694c6d6c764c334e30615778735a53316d5a57566b4c324e766247786c59335270623234765a3256755a584a6864476c325a53317a63585668636d5574614756685a4756794c6e42755a794a394c48736964326c6b644767694f6a45344d444173496d686c6157646f644349364e6a41774c434a31636d77694f694a6f64485277637a6f764c323170626d6c74595778756243356e6158526f6457497561573876633352706247786c4c575a6c5a575176593239736247566a64476c766269396e5a57356c636d463061585a6c4c584e78645746795a53316f5a57466b5a5849744d5467774d433577626d636966563073496d6c745957646c6379493657317437496e64705a48526f496a6f334d6a41774c434a6f5a576c6e614851694f6a49304d444173496e567962434936496d68306448427a4f69387662576c7561573168624735734c6d647064476831596935706279397a64476c73624755745a6d566c5a43396a623278735a574e30615739754c32646c626d567959585270646d55746333463159584a6c4c57686c5957526c63693577626d636966537837496e64705a48526f496a6f784f4441774c434a6f5a576c6e614851694f6a59774d43776964584a73496a6f696148523063484d364c7939746157357062574673626d77755a326c30614856694c6d6c764c334e30615778735a53316d5a57566b4c324e766247786c59335270623234765a3256755a584a6864476c325a53317a63585668636d5574614756685a4756794c5445344d4441756347356e496e31645853776959584e7a5a58527a496a70625853776959585230636d6c696458526c637949365731313966513d3d000000000000000000000000000000';
  const ARTWORK = [
    { url: 'https://minimalnl.github.io/stille-feed/collection/generative-square-header.png', width: 7200, height: 2400, sha256: '932450b224f16801c3917b92b2ecbbf9a6148a327508bac43b29d2b496d9a678' },
    { url: 'https://minimalnl.github.io/stille-feed/collection/generative-square-header-1800.png', width: 1800, height: 600, sha256: '2a30af729d519db15bd365c05bac8d1da11a67c18edfec7880857fe81104868e' },
  ];
  const MSG = {
    connect: 'Connect the owner profile to set the collection header.',
    owner: 'Only the contract owner can set the collection header.',
    chain: 'Switch to LUKSO mainnet (chain 42) before setting the header.',
    contract: 'This header update is only for the Generative Square contract on LUKSO mainnet.',
    skip: 'The collection header is already the approved banner. Nothing to sign.',
    review: 'Collection metadata is not the approved header. Stopped so nothing else in that field is overwritten. Nothing was signed.',
    unavailable: 'The approved banner is not available at its public URL yet. Nothing was signed.',
    mismatch: 'The public banner file is not the approved image. Stopped for review. Nothing was signed.',
    readFail: 'Could not read the collection metadata. Nothing was signed.',
    revert: 'The contract rejected the header update. Nothing was signed.',
    cancel: 'Cancelled. Nothing was signed.',
    sendFail: 'The wallet did not send the transaction. Nothing was signed.',
    busy: 'Already checking the header.',
    idle: 'One confirmation sets the approved three-square banner. Token images stay as they are.',
  };

  function hexToBytes(hex) {
    const h = String(hex == null ? '' : hex).replace(/^0x/i, '').toLowerCase();
    if (!h) return new Uint8Array();
    if (h.length % 2 || /[^0-9a-f]/.test(h)) {
      const error = new Error('unreadable metadata');
      error.review = true;
      throw error;
    }
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  const APPROVED_BYTES = hexToBytes(APPROVED_VALUE);

  function asBytes(stored) {
    if (stored == null) return new Uint8Array();
    if (typeof stored === 'string') return hexToBytes(stored);
    if (typeof stored.length === 'number') {
      const out = new Uint8Array(stored.length);
      for (let i = 0; i < stored.length; i++) out[i] = stored[i];
      return out;
    }
    const error = new Error('unreadable metadata');
    error.review = true;
    throw error;
  }
  function sameBytes(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if ((a[i] & 255) !== (b[i] & 255)) return false;
    return true;
  }
  function guard(account, chainId, contract) {
    const acc = String(account || '').toLowerCase();
    if (!acc) return MSG.connect;
    if (acc === NEVER.toLowerCase()) return MSG.owner;
    if (acc !== OWNER.toLowerCase()) return MSG.owner;
    if (Number(chainId) !== CHAIN_ID) return MSG.chain;
    if (String(contract || '').toLowerCase() !== CONTRACT) return MSG.contract;
    return '';
  }
  function decide(stored) {
    const bytes = asBytes(stored);
    if (bytes.length === 0) return { action: 'update' };
    if (sameBytes(bytes, APPROVED_BYTES)) return { action: 'skip' };
    return { action: 'review' };
  }
  function pngSize(bytes) {
    const u8 = asBytes(bytes);
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    if (u8.length < 24) return null;
    for (let i = 0; i < 8; i++) if (u8[i] !== sig[i]) return null;
    if (String.fromCharCode(u8[12], u8[13], u8[14], u8[15]) !== 'IHDR') return null;
    const width = ((u8[16] << 24) | (u8[17] << 16) | (u8[18] << 8) | u8[19]) >>> 0;
    const height = ((u8[20] << 24) | (u8[21] << 16) | (u8[22] << 8) | u8[23]) >>> 0;
    return { width, height };
  }
  async function sha256Hex(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', asBytes(bytes));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  async function checkArtwork(fetchImpl) {
    let mismatch = false;
    let unavailable = false;
    for (const art of ARTWORK) {
      let res;
      try { res = await fetchImpl(art.url, { cache: 'no-store' }); }
      catch { unavailable = true; continue; }
      if (!res || !res.ok) { unavailable = true; continue; }
      const buf = new Uint8Array(await res.arrayBuffer());
      const size = pngSize(buf);
      const hash = await sha256Hex(buf);
      if (!size || size.width !== art.width || size.height !== art.height || hash !== art.sha256) mismatch = true;
    }
    if (mismatch) return { ok: false, reason: 'mismatch', message: MSG.mismatch };
    if (unavailable) return { ok: false, reason: 'unavailable', message: MSG.unavailable };
    return { ok: true };
  }
  function isCancel(error) {
    return error?.code === 4001 || /reject|denied|cancel/i.test(error?.message || '');
  }
  function approvedCalldata() {
    const data = APPROVED_CALLDATA.toLowerCase();
    if (!data.startsWith(SET_DATA) || !data.includes(LSP4_METADATA_KEY.slice(2))) {
      throw new Error('approved header calldata is not setData of LSP4Metadata');
    }
    return APPROVED_CALLDATA;
  }
  async function run(deps) {
    const account = typeof deps.account === 'function' ? await deps.account() : deps.account;
    const chainId = typeof deps.chainId === 'function' ? await deps.chainId() : deps.chainId;
    const contract = typeof deps.contract === 'function' ? await deps.contract() : deps.contract;
    const denied = guard(account, chainId, contract);
    if (denied) return { status: 'blocked', message: denied, sent: false };
    let stored;
    try { stored = await deps.readStored(); }
    catch (error) {
      if (error?.review) return { status: 'review', message: MSG.review, sent: false };
      return { status: 'blocked', message: MSG.readFail, sent: false };
    }
    let decision;
    try { decision = decide(stored); }
    catch (error) {
      if (error?.review) return { status: 'review', message: MSG.review, sent: false };
      throw error;
    }
    if (decision.action === 'skip') return { status: 'skipped', message: MSG.skip, sent: false };
    if (decision.action !== 'update') return { status: 'review', message: MSG.review, sent: false };
    const art = await deps.checkArtwork();
    if (!art?.ok) {
      const review = art?.reason === 'mismatch';
      return { status: review ? 'review' : 'blocked', message: art?.message || MSG.unavailable, sent: false };
    }
    const data = approvedCalldata();
    try { await deps.dryRun(data, account); }
    catch { return { status: 'reverted', message: MSG.revert, sent: false }; }
    try {
      const hash = await deps.send(data, account);
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash || '')) return { status: 'failed', message: MSG.sendFail, sent: false };
      return { status: 'sent', hash, sent: true, data };
    } catch (error) {
      if (isCancel(error)) return { status: 'cancelled', message: MSG.cancel, sent: false };
      return { status: 'failed', message: MSG.sendFail, sent: false };
    }
  }
  function createClick(deps) {
    let busy = false;
    return async function click() {
      if (busy) return { status: 'busy', message: MSG.busy, sent: false };
      busy = true;
      try { return await run(deps); }
      finally { busy = false; }
    };
  }
  function storedBytes(callResultHex) {
    try { return GGUeFix.decodeAbiBytes(callResultHex); }
    catch (error) { error.review = true; throw error; }
  }
  function getDataCalldata() {
    return GET_DATA + LSP4_METADATA_KEY.slice(2);
  }
  return {
    OWNER, NEVER, CHAIN_ID, CONTRACT, LSP4_METADATA_KEY, GET_DATA, SET_DATA,
    APPROVED_VALUE, APPROVED_CALLDATA, ARTWORK, MSG,
    guard, decide, pngSize, sha256Hex, checkArtwork, run, createClick, storedBytes, getDataCalldata,
  };
})();
globalThis.GGCollectionHeader = GGCollectionHeader;


(() => {
  const C = GG_NETS[GG_NET];
  const box = document.getElementById('gg');
  if (!box || !C.address) return;

  // Lightweight keccak256 implementation (will load from CDN)
  let keccak256 = null;
  (async () => {
    try {
      const { keccak_256 } = await import('https://esm.sh/@noble/hashes@1.3.3/sha3');
      keccak256 = (data) => {
        const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
        return '0x' + Array.from(keccak_256(bytes)).map(b => b.toString(16).padStart(2, '0')).join('');
      };
    } catch (e) {
      console.warn('keccak256 not loaded', e);
    }
  })();

  const MAX_QTY = 5;
  const TIER_SIZE = 100; // contract: price doubles every 100 (priceFor = BASE_PRICE << (n-1)/100)
  const OWNER = GGUeFix.OWNER; // contract owner (Mark). Never the 0x7070 address.
  const LSP4_METADATA_KEY = GGUeFix.LSP4_METADATA_KEY; // LSP4Metadata key (32 bytes)
  const SEL = { minted: '0x4f02c420', max: '0x32cb6b0c', price: '0x9d1b464a', base: '0xf86325ed', priceFor: '0x8d5555f2',
    script: '0xebe9eb9f', mint: '0x1249c58b', seedOf: '0x82829f74', withdraw: '0x51cff8d9',
    tokenMetadataJSON: GGUeFix.SEL.tokenMetadataJSON, imageBaseURI: GGUeFix.SEL.imageBaseURI,
    setDataForTokenId: GGUeFix.SEL.setDataForTokenId, getDataForTokenId: GGUeFix.SEL.getDataForTokenId };
  const ERR = { '0x52df9fe5': 'sold out', '0x6871963e': 'price changed' }; // SoldOut(), WrongPrice(uint256,uint256)
  const MINTED_TOPIC = '0x5a3358a3d27a5373c0df2604662088d37894d56b7cfd27f315770440f4e0d919';
  const P5 = 'https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js';
  const P5_SRI = 'sha512-uaz5GpnQoE6t5echKlX8P52czvsIGgLPcvlzfvRubLZ1Hp8JemUDnbUiAahbVtPb+jUVrNETuXvAhDDF/N3M4w==';
  const inGrid = window.parent !== window;
  const el = (id) => box.querySelector('#' + id);
  const st = { script: null, minted: null, max: 1000, base: null, prices: [], qty: 1, provider: null, account: null, wallets: [], wallet: null,
    busy: false, msg: '', progress: '', useUpProvider: false, contractBalance: null, claimBusy: false, claimMsg: '', fixBusy: false, fixMsg: '', fixProgress: '', headerBusy: false, headerMsg: '' };
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const short = (a) => a.slice(0, 6) + '…' + a.slice(-4);
  const hexChain = '0x' + C.chainId.toString(16);
  const hex = (n) => '0x' + BigInt(n).toString(16);
  const pad = (n) => BigInt(n).toString(16).padStart(64, '0');

  // JSON-RPC to the testnet node; several calls at once go out as one batch.
  async function rpcBatch(calls) {
    const r = await fetch(C.rpc, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(calls.map(([method, params], id) => ({ jsonrpc: '2.0', id, method, params }))) });
    const j = await r.json();
    const byId = new Map((Array.isArray(j) ? j : [j]).map((x) => [x.id, x]));
    return calls.map((_, id) => {
      const x = byId.get(id);
      if (!x || x.error) { const e = new Error(x?.error?.message || 'No answer'); e.data = x?.error?.data; throw e; }
      return x.result;
    });
  }
  const rpc = async (method, params) => (await rpcBatch([[method, params]]))[0];
  const call = (data) => rpc('eth_call', [{ to: C.address, data }, 'latest']);
  const decodeString = (h0) => {
    const h = h0.slice(2), len = parseInt(h.slice(64, 128), 16);
    const b = Uint8Array.from(h.slice(128, 128 + len * 2).match(/../g) || [], (x) => parseInt(x, 16));
    return new TextDecoder().decode(b);
  };
  const lyx = (wei) => (Number(wei / 10n ** 9n) / 1e9).toLocaleString('en-US', { maximumFractionDigits: 9 }) + ' ' + C.symbol;
  const priceFor = (n) => (n < 1 || n > st.max || st.base === null ? 0n : st.base << BigInt(Math.floor((n - 1) / TIER_SIZE)));
  const left = () => (st.minted === null ? 0 : Math.max(0, st.max - st.minted));
  const total = (q) => st.prices.slice(0, q).reduce((a, b) => a + b, 0n);

  // ---------- Art ----------
  function draw(seed) {
    if (!st.script) return;
    el('ggArt').srcdoc = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;height:100%;overflow:hidden;background:#fbf7ee}canvas{display:block;width:100%!important;height:100%!important}</style>
<script src="${P5}" integrity="${P5_SRI}" crossorigin="anonymous"><\/script></head><body>
<script>const SEED=${Number(seed)};\n${st.script.replace(/<\/script/gi, '<\\/script')}\n<\/script></body></html>`;
  }
  const randomSeed = () => Math.floor(Math.random() * 1e9); // same range as the contract (SEED_RANGE)

  // The script is immutable in the contract (no setter), so it can be cached per contract address.
  async function loadScript() {
    const key = `qf:c:ggscript:${C.chainId}:${C.address.toLowerCase()}`;
    try { const s = localStorage.getItem(key); if (s) return s; } catch {}
    const s = decodeString(await call(SEL.script));
    try { localStorage.setItem(key, s); } catch {}
    return s;
  }

  // ---------- UI ----------
  function render() {
    const soldOut = st.minted !== null && st.minted >= st.max;
    const canMint = !!st.provider && !!st.account;
    const q = Math.min(st.qty, Math.max(1, left()));
    el('ggCount').textContent = st.minted === null ? '…' : soldOut ? `${st.max} of ${st.max} · sold out` : `#${st.minted + 1} of ${st.max}`;
    el('ggPrice').textContent = !st.prices.length || soldOut ? '' : `${lyx(st.prices[0])} each`;

    const qty = el('ggQty');
    qty.hidden = !canMint || soldOut || st.base === null;
    qty.querySelectorAll('button').forEach((b) => {
      const n = Number(b.dataset.q);
      b.classList.toggle('on', n === q);
      b.disabled = st.busy || n > left();
      b.setAttribute('aria-pressed', String(n === q));
    });

    const b = el('ggMint');
    b.classList.toggle('gg-connect', !!st.provider && !canMint);
    if (st.provider) {
      b.hidden = false;
      b.disabled = st.busy || soldOut || (canMint && st.base === null);
      b.textContent = soldOut ? 'Sold out' : !canMint ? (st.busy ? 'Connecting…' : 'Connect')
        : st.busy ? (st.progress || 'Minting…') : st.base !== null ? `Mint ${q} for ${lyx(total(q))}` : 'Mint';
    } else {
      b.hidden = true;
    }
    const walletSwitch = st.wallets.length > 1 && !st.useUpProvider ? ` · ${esc(st.wallet?.info.name || '')} · <button type="button" class="gg-switch" id="ggSwitch">change</button>` : '';
    el('ggNote').innerHTML = st.msg || (st.provider ? (canMint && q > 1 && !st.busy ? `${q} pieces = ${q} confirmations, one after the other.`
      : st.account ? short(st.account) + walletSwitch : '') :
      'Mint in your <a href="https://universaleverything.io" target="_blank" rel="noopener">Grid</a> or with the ' +
      '<a href="https://chromewebstore.google.com/detail/universal-profiles/abpickdkkbnbcoepogfhkhennhfhehfn" target="_blank" rel="noopener">Universal Profile extension</a>.');
    
    // Claim revenue button (owner only)
    const isOwner = st.account && st.account.toLowerCase() === OWNER.toLowerCase();
    const claimBtn = el('ggClaim');
    const claimNote = el('ggClaimNote');
    if (claimBtn && claimNote) {
      const hasBalance = st.contractBalance && st.contractBalance > 0n;
      claimBtn.hidden = !canMint || !isOwner;
      claimBtn.disabled = st.claimBusy || !hasBalance;
      claimBtn.textContent = st.claimBusy ? 'Claiming…' : hasBalance ? `Claim ${lyx(st.contractBalance)}` : 'No revenue yet';
      claimNote.innerHTML = st.claimMsg || (isOwner && hasBalance ? 'Sends 0 LYX, calls withdraw(owner)' : '');
    }
    
    // Fix images button (owner only)
    const fixBtn = el('ggFix');
    const fixNote = el('ggFixNote');
    if (fixBtn && fixNote) {
      const hasMinted = st.minted && st.minted > 0;
      fixBtn.hidden = !canMint || !isOwner;
      fixBtn.disabled = st.fixBusy || !hasMinted;
      fixBtn.textContent = st.fixBusy ? (st.fixProgress || 'Updating…') : hasMinted ? 'Fix images for UE' : 'No tokens yet';
      fixNote.innerHTML = st.fixMsg || (isOwner && hasMinted && !st.fixBusy ? esc(GGUeFix.idleNote(st.minted)) : '');
    }

    const headerBtn = el('ggHeader');
    const headerNote = el('ggHeaderNote');
    if (headerBtn && headerNote) {
      headerBtn.hidden = !canMint || !isOwner;
      headerBtn.disabled = st.headerBusy;
      headerBtn.textContent = st.headerBusy ? 'Checking header…' : 'Set collection header';
      headerNote.innerHTML = st.headerMsg || (isOwner && !st.headerBusy ? esc(GGCollectionHeader.MSG.idle) : '');
    }
  }

  // Counter + prices of the next MAX_QTY numbers, in one request.
  async function refresh() {
    const [m, x, base, cur] = (await rpcBatch([SEL.minted, SEL.max, SEL.base, SEL.price]
      .map((d) => ['eth_call', [{ to: C.address, data: d }, 'latest']]))).map((h) => BigInt(h));
    st.minted = Number(m); st.max = Number(x); st.base = base;
    // Also fetch contract balance for claim button
    try {
      const bal = await rpc('eth_getBalance', [C.address, 'latest']);
      st.contractBalance = BigInt(bal);
    } catch (e) { st.contractBalance = null; }
    // Sanity check against the contract's own price; if the formula ever disagrees, ask the contract per number.
    if (left() > 0 && priceFor(st.minted + 1) !== cur) {
      const nums = [...Array(Math.min(MAX_QTY, left()))].map((_, i) => st.minted + 1 + i);
      const ps = await rpcBatch(nums.map((n) => ['eth_call', [{ to: C.address, data: SEL.priceFor + pad(n) }, 'latest']]));
      st.prices = ps.map((h) => BigInt(h));
    } else {
      st.prices = [...Array(Math.min(MAX_QTY, left()))].map((_, i) => priceFor(st.minted + 1 + i));
    }
    if (st.qty > Math.max(1, left())) st.qty = Math.max(1, left());
    render();
  }

  async function waitReceipt(hash) {
    for (let i = 0; i < 90; i++) { // ~3 minutes
      const r = await rpc('eth_getTransactionReceipt', [hash]).catch(() => null);
      if (r) return r;
      await new Promise((ok) => setTimeout(ok, 2000));
    }
    return null;
  }

  // Human message for a failed simulation or wallet error.
  function why(e) {
    const data = typeof e?.data === 'string' ? e.data : e?.data?.data || e?.data?.originalError?.data || '';
    const sel = String(data).slice(0, 10);
    if (ERR[sel] === 'sold out') return 'Sold out.';
    if (ERR[sel] === 'price changed') return 'The price just changed. Check it and mint again.';
    const m = String(e?.message || '');
    if (/insufficient funds|exceeds balance|not enough/i.test(m)) return `Not enough ${C.symbol} for this mint.`;
    return 'Mint failed.';
  }

  async function mint() {
    if (st.busy) return; // double click / double tap guard
    const pv = st.provider;
    const q = Math.min(st.qty, Math.max(1, left()));
    const quoted = st.prices.slice(0, q);
    st.busy = true; st.msg = ''; st.progress = ''; render();
    const done = []; // { n, hash }
    let stop = '';
    try {
      // In the Grid the chain is fixed by the Grid: check it before asking anyone to connect.
      if (inGrid && !(await ensureChain(pv))) { st.msg = `Minting is on ${C.name} for now; this Grid is on another network.`; return; }
      let [acc] = (await pv.request({ method: 'eth_accounts', params: [] })) || [];
      if (!acc) {
        // No account yet: try eth_requestAccounts once (user-initiated call is OK)
        [acc] = (await pv.request({ method: 'eth_requestAccounts', params: [] })) || [];
        if (!acc) { 
          st.msg = inGrid && st.useUpProvider 
            ? 'Allow this mini-app in Universal Everything, then try Connect again.' 
            : 'Connect a profile to mint.'; 
          return; 
        }
      }
      if (!inGrid && !(await ensureChain(pv))) { st.msg = `Switch to ${C.name} to mint.`; return; }
      await refresh();
      if (left() === 0) { st.msg = 'Sold out.'; return; }
      if (left() < q) { st.qty = left(); st.msg = `Only ${left()} left. Check the price and mint again.`; return; }
      // Never pay more than the price that was on the button.
      if (st.prices.slice(0, q).some((p, i) => p > quoted[i])) { st.msg = 'The price just changed. Check it and mint again.'; return; }
      const need = total(q);
      const bal = BigInt(await rpc('eth_getBalance', [acc, 'latest']));
      if (bal < need) { st.msg = `Not enough ${C.symbol}: ${q} ${q === 1 ? 'piece costs' : 'pieces cost'} ${lyx(need)} plus a little gas.`; return; }

      for (let i = 0; i < q; i++) {
        st.progress = q > 1 ? `Minting ${i + 1} of ${q}…` : 'Minting…'; render();
        if (i > 0) await refresh();
        const n = st.minted + 1;
        if (n > st.max) { stop = 'Sold out.'; break; }
        const value = BigInt(await call(SEL.priceFor + pad(n))); // the contract's own price for this number
        if (value > quoted[i]) { stop = 'The price changed, so I stopped.'; break; }
        const tx = { from: acc, to: C.address, value: hex(value), data: SEL.mint };
        // Dry run first: catches sold out / wrong price / no balance before the wallet asks anything.
        try { await rpc('eth_call', [tx, 'latest']); } catch (e) { stop = why(e); break; }
        let hash;
        try { hash = await pv.request({ method: 'eth_sendTransaction', params: [tx] }); } catch (e) {
          stop = e?.code === 4001 || /reject|denied|cancel/i.test(e?.message || '') ? 'Cancelled.' : why(e);
          break;
        }
        const rc = await waitReceipt(hash);
        if (!rc) { stop = `Still pending · <a href="${C.explorer}/tx/${hash}" target="_blank" rel="noopener">view ↗</a>`; break; }
        const log = rc.status === '0x1' && rc.logs.find((l) => l.topics[0] === MINTED_TOPIC && l.address.toLowerCase() === C.address.toLowerCase());
        if (!log) { stop = `Mint failed (only gas was used) · <a href="${C.explorer}/tx/${hash}" target="_blank" rel="noopener">view ↗</a>`; break; }
        const num = Number(BigInt(log.topics[2])), seed = Number(BigInt(log.data.slice(0, 66)));
        done.push({ n: num, hash });
        draw(seed);
      }
    } catch (e) {
      console.warn(e);
      stop = e?.code === 4001 ? 'Cancelled.' : why(e);
    } finally {
      const list = done.map((d) => `<a href="${C.explorer}/tx/${d.hash}" target="_blank" rel="noopener">#${d.n}</a>`).join(' · ');
      if (done.length) st.msg = `Minted ${list}. Thank you!` + (stop ? ` <span class="gg-stop">${done.length} of ${q} · ${stop}</span>` : '');
      else if (stop) st.msg = stop;
      st.busy = false; st.progress = '';
      await refresh().catch(() => {});
      render();
    }
  }

  // Asks the wallet to switch to C.chainId (adds the network if unknown). The Grid decides the chain itself.
  async function ensureChain(pv) {
    // up-provider knows the Grid's chain locally; otherwise ask the wallet (with a timeout, it should answer at once).
    const now = async () => (inGrid && Number.isInteger(Number(pv.chainId)) && pv.chainId ? Number(pv.chainId)
      : Number(await Promise.race([pv.request({ method: 'eth_chainId', params: [] }),
        new Promise((_, no) => setTimeout(() => no(new Error('No answer from wallet')), 10000))])));
    if (await now() === C.chainId) return true;
    if (inGrid) return false;
    try {
      await pv.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexChain }] });
    } catch (e) {
      if (e && (e.code === 4902 || e.code === -32603 || /unrecognized|not added|unknown chain/i.test(e.message || ''))) {
        try {
          await pv.request({ method: 'wallet_addEthereumChain', params: [{ chainId: hexChain, chainName: C.name,
            nativeCurrency: { name: C.symbol, symbol: C.symbol, decimals: 18 }, rpcUrls: [C.rpc], blockExplorerUrls: [C.explorer] }] });
          if (await now() !== C.chainId) await pv.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexChain }] });
        } catch (e2) { console.warn(e2); return false; }
      } else { console.warn(e); return false; }
    }
    return (await now()) === C.chainId;
  }

  // Claim mint revenue (owner only): calls withdraw(address) with 0 LYX value
  async function claimRevenue() {
    if (st.claimBusy) return;
    const pv = st.provider;
    const acc = st.account;
    if (!acc) { st.claimMsg = 'Connect to claim revenue.'; render(); return; }
    if (acc.toLowerCase() !== OWNER.toLowerCase()) { 
      st.claimMsg = 'Only the contract owner can claim revenue.'; 
      render(); 
      return; 
    }
    st.claimBusy = true; st.claimMsg = ''; render();
    try {
      if (!(await ensureChain(pv))) { st.claimMsg = `Switch to ${C.name} to claim.`; return; }
      // withdraw(address payable to) calldata: selector + padded owner address
      const data = SEL.withdraw + OWNER.slice(2).padStart(64, '0');
      const tx = { from: acc, to: C.address, value: '0x0', data };
      // Dry run first
      try { await rpc('eth_call', [tx, 'latest']); } catch (e) {
        st.claimMsg = 'Claim failed: ' + (e?.message || 'contract reverted');
        return;
      }
      let hash;
      try { hash = await pv.request({ method: 'eth_sendTransaction', params: [tx] }); } catch (e) {
        st.claimMsg = e?.code === 4001 ? 'Cancelled.' : 'Could not send transaction.';
        return;
      }
      st.claimMsg = 'Claiming…';
      render();
      const rc = await waitReceipt(hash);
      if (!rc) { st.claimMsg = `Pending · <a href="${C.explorer}/tx/${hash}" target="_blank" rel="noopener">view ↗</a>`; return; }
      if (rc.status === '0x1') {
        st.claimMsg = `Claimed! <a href="${C.explorer}/tx/${hash}" target="_blank" rel="noopener">view ↗</a>`;
        await refresh().catch(() => {}); // refresh balance
      } else {
        st.claimMsg = `Claim failed · <a href="${C.explorer}/tx/${hash}" target="_blank" rel="noopener">view ↗</a>`;
      }
    } catch (e) {
      console.warn(e);
      st.claimMsg = 'Claim failed.';
    } finally {
      st.claimBusy = false;
      render();
    }
  }

  // Per-token LSP4 override wins in Universal Everything. tokenMetadataJSON() is the contract's
  // computed metadata and still describes the original images; this does not change future mints.
  async function readEffectiveMetadata(n) {
    const raw = await call(SEL.getDataForTokenId + pad(n) + LSP4_METADATA_KEY.slice(2));
    const override = GGUeFix.tryDecodeStoredMetadata(raw);
    if (override) return override;
    const computed = decodeString(await call(SEL.tokenMetadataJSON + pad(n)));
    if (!computed) return null;
    return JSON.parse(computed);
  }

  // Point icon and images at the 2400 original. Skip tokens whose stored override is already that.
  async function fixImagesForUE() {
    if (st.fixBusy) return;
    if (!keccak256) { st.fixMsg = esc('Loading keccak256…'); render(); setTimeout(fixImagesForUE, 500); return; }
    const pv = st.provider;
    const acc = st.account;
    const denied = GGUeFix.fixGuard(acc);
    if (denied) { st.fixMsg = esc(denied); render(); return; }
    st.fixBusy = true; st.fixMsg = ''; st.fixProgress = ''; render();
    const updated = [];
    const skipped = [];
    let current = 0;
    const report = (extra) => esc(GGUeFix.resultMessage(extra));
    const txLink = (hash) => /^0x[0-9a-fA-F]{64}$/.test(hash || '')
      ? ` <a href="${esc(C.explorer)}/tx/${hash}" target="_blank" rel="noopener">view ↗</a>` : '';
    try {
      if (!(await ensureChain(pv))) { st.fixMsg = esc(`Switch to ${C.name} to fix metadata.`); return; }
      const [mintedHex, baseURIHex] = await rpcBatch([
        ['eth_call', [{ to: C.address, data: SEL.minted }, 'latest']],
        ['eth_call', [{ to: C.address, data: SEL.imageBaseURI }, 'latest']]
      ]);
      const minted = Number(BigInt(mintedHex));
      const baseURI = decodeString(baseURIHex);
      if (minted === 0) { st.fixMsg = esc('No tokens minted yet.'); return; }

      for (let n = 1; n <= minted; n++) {
        current = n;
        st.fixProgress = `Reading token ${n} of ${minted}…`; render();
        let existing;
        try { existing = await readEffectiveMetadata(n); }
        catch (e) {
          st.fixMsg = report({ updated, skipped, minted, failedAt: n }) + ' ' + esc(e?.message || 'could not read metadata');
          return;
        }
        let decision = GGUeFix.decideToken(existing, baseURI, n);
        if (decision.action === 'need-seed') {
          const seed = Number(BigInt(await call(SEL.seedOf + pad(n))));
          decision = GGUeFix.decideToken(null, baseURI, n, seed);
        }
        if (decision.action === 'skip') {
          skipped.push(n);
          st.fixProgress = `Token ${n} of ${minted} already 2400, skipping…`; render();
          continue;
        }
        const jsonStr = JSON.stringify(decision.metadata);
        const data = GGUeFix.encodeSetDataForTokenId(n, GGUeFix.encodeVerifiableURI(jsonStr, keccak256));
        st.fixProgress = `Updating token ${n} of ${minted}…`; render();
        const tx = { from: acc, to: C.address, value: '0x0', data };
        try { await rpc('eth_call', [tx, 'latest']); }
        catch (e) {
          console.warn('Dry run error:', e);
          st.fixMsg = report({ updated, skipped, minted, failedAt: n }) + ' ' + esc(e?.message || 'contract reverted');
          return;
        }
        let txHash;
        try { txHash = await pv.request({ method: 'eth_sendTransaction', params: [tx] }); }
        catch (e) {
          st.fixMsg = e?.code === 4001
            ? report({ updated, skipped, minted, cancelledAt: n })
            : report({ updated, skipped, minted, failedAt: n });
          return;
        }
        st.fixProgress = `Confirming token ${n} of ${minted}…`; render();
        const rc = await waitReceipt(txHash);
        if (!rc || rc.status !== '0x1') {
          st.fixMsg = report({ updated, skipped, minted, failedAt: n }) + txLink(txHash);
          return;
        }
        updated.push(n);
      }
      st.fixMsg = report({ updated, skipped, minted });
    } catch (e) {
      console.warn(e);
      if (!st.fixMsg) {
        st.fixMsg = current
          ? report({ updated, skipped, failedAt: current }) + ' ' + esc(e?.message || 'unknown error')
          : esc('Fix failed: ' + (e?.message || 'unknown error'));
      }
    } finally {
      st.fixBusy = false;
      st.fixProgress = '';
      render();
    }
  }

  async function readChainId(pv) {
    if (!pv) return 0;
    try {
      if (inGrid && Number(pv.chainId) > 0) return Number(pv.chainId);
      return Number(await pv.request({ method: 'eth_chainId', params: [] }));
    } catch { return 0; }
  }

  // Click path for the approved collection header. The wallet is asked only after
  // the owner, chain, stored metadata, artwork, and a read-only eth_call all pass.
  const headerClick = GGCollectionHeader.createClick({
    account: () => st.account,
    chainId: () => readChainId(st.provider),
    contract: () => C.address,
    readStored: async () => {
      const raw = await call(GGCollectionHeader.getDataCalldata());
      return GGCollectionHeader.storedBytes(raw);
    },
    checkArtwork: () => GGCollectionHeader.checkArtwork(fetch),
    dryRun: (data, account) => rpc('eth_call', [{ from: account, to: GGCollectionHeader.CONTRACT, value: '0x0', data }, 'latest']),
    send: (data, account) => st.provider.request({
      method: 'eth_sendTransaction',
      params: [{ from: account, to: GGCollectionHeader.CONTRACT, value: '0x0', data }],
    }),
  });

  async function setCollectionHeader() {
    if (st.headerBusy) return;
    st.headerBusy = true; st.headerMsg = ''; render();
    const txLink = (hash) => /^0x[0-9a-fA-F]{64}$/.test(hash || '')
      ? ` <a href="${esc(C.explorer)}/tx/${hash}" target="_blank" rel="noopener">view ↗</a>` : '';
    try {
      const result = await headerClick();
      if (result.status !== 'sent') { st.headerMsg = esc(result.message || GGCollectionHeader.MSG.sendFail); return; }
      st.headerMsg = 'Confirming…'; render();
      const rc = await waitReceipt(result.hash);
      if (!rc) { st.headerMsg = 'Waiting for the transaction.' + txLink(result.hash); return; }
      st.headerMsg = rc.status === '0x1'
        ? 'Collection header set.' + txLink(result.hash)
        : 'The header transaction failed.' + txLink(result.hash);
    } catch (e) {
      console.warn(e);
      if (!st.headerMsg) st.headerMsg = esc(GGCollectionHeader.MSG.sendFail);
    } finally {
      st.headerBusy = false;
      render();
    }
  }

  async function connect(picked) {
    if (st.busy) return;
    if (!picked && st.wallets.length > 1 && !st.useUpProvider) { st.msg = ''; render(); showPicker(); return; }
    const pv = st.provider;
    st.busy = true; st.msg = ''; render();
    try {
      if (inGrid && st.useUpProvider) {
        // Mobile UE app (no extension): use up-provider eth_requestAccounts to trigger parent mini-app connect
        const [acc] = (await pv.request({ method: 'eth_requestAccounts', params: [] })) || [];
        st.account = acc || null;
        if (!acc) st.msg = 'Allow this mini-app in Universal Everything, then try Connect again.';
        else if (!(await ensureChain(pv))) st.msg = `${short(acc)} · Grid is on another network.`;
      } else {
        // Desktop browser (extension available) or standalone: use eth_requestAccounts on extension
        const [acc] = (await pv.request({ method: 'eth_requestAccounts', params: [] })) || [];
        st.account = acc || null;
        if (acc && !(await ensureChain(pv))) st.msg = `${short(acc)} · switch to ${C.name} to mint.`;
      }
    } catch (e) {
      console.warn(e);
      st.msg = e && e.code === 4001 ? '' : 'Could not connect.';
    } finally {
      st.busy = false; render();
    }
  }

  // Browser extensions: every EIP-6963 wallet, plus window.lukso / window.ethereum when not announced.
  const WKEY = 'qf.wallet';
  const isUP = (w) => /universal\s*profile|lukso|universaleverything/i.test(`${w.info?.name} ${w.info?.rdns}`);
  function findWallets() {
    return new Promise((done) => {
      const seen = [];
      const add = (info, provider) => { if (provider && !seen.some((w) => w.provider === provider)) seen.push({ info: info || {}, provider }); };
      const on = (e) => e.detail && add(e.detail.info, e.detail.provider);
      window.addEventListener('eip6963:announceProvider', on);
      window.dispatchEvent(new Event('eip6963:requestProvider'));
      setTimeout(() => {
        window.removeEventListener('eip6963:announceProvider', on);
        if (window.lukso && !seen.some(isUP)) add({ name: 'Universal Profile' }, window.lukso);
        if (window.ethereum && !seen.length) add({ name: window.ethereum.isRabby ? 'Rabby' : window.ethereum.isMetaMask ? 'MetaMask' : 'Browser wallet' }, window.ethereum);
        // Universal Profile first, the rest in announce order.
        done(seen.filter(isUP).concat(seen.filter((w) => !isUP(w))));
      }, 400);
    });
  }
  function preferred() {
    let saved = ''; try { saved = localStorage.getItem(WKEY) || ''; } catch (e) {}
    return st.wallets.find((w) => w.info.name === saved) || st.wallets[0] || null;
  }
  const bound = new WeakSet();
  function useWallet(w) {
    st.wallet = w; st.provider = w.provider;
    if (bound.has(w.provider)) return; bound.add(w.provider);
    w.provider.on?.('accountsChanged', (a) => { if (st.provider !== w.provider) return; st.account = (a && a[0]) || null; st.msg = ''; render(); });
    w.provider.on?.('chainChanged', () => { if (st.provider === w.provider) { st.msg = ''; render(); } });
  }
  function hidePicker() { const p = el('ggPick'); if (p) p.remove(); }
  function showPicker() {
    hidePicker();
    const p = document.createElement('div');
    p.id = 'ggPick'; p.className = 'gg-pick'; p.setAttribute('role', 'group'); p.setAttribute('aria-label', 'Choose a wallet');
    const t = document.createElement('span'); t.className = 'gg-pick-t'; t.textContent = 'Connect with'; p.append(t);
    st.wallets.forEach((w) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'gg-pick-w';
      if (w === preferred()) b.classList.add('on');
      if (w.info.icon && /^data:image\//.test(w.info.icon)) { const i = document.createElement('img'); i.src = w.info.icon; i.alt = ''; b.append(i); }
      b.append(document.createTextNode(w.info.name || 'Wallet'));
      b.onclick = () => { hidePicker(); try { localStorage.setItem(WKEY, w.info.name || ''); } catch (e) {} useWallet(w); connect(true); };
      p.append(b);
    });
    const x = document.createElement('button'); x.type = 'button'; x.className = 'gg-pick-x'; x.textContent = 'Cancel';
    x.onclick = () => { hidePicker(); render(); }; p.append(x);
    el('ggMint').closest('.gg-act').after(p);
    p.querySelector('.gg-pick-w').focus();
  }

  async function initProvider() {
    try {
      if (inGrid) {
        // In Grid: detect real EIP-6963 extension (desktop) vs mobile UE app
        // Discover wallets via EIP-6963 (real extensions announce with rdns/name/icon)
        const allWallets = await findWallets();
        const upWallet = allWallets.find(isUP);
        
        // Check if it's a REAL extension: EIP-6963 announced with proper info.rdns
        // Bare window.lukso (no EIP-6963) doesn't have info.rdns and may not work in iframe
        const hasRealExtension = upWallet && upWallet.info && upWallet.info.rdns;
        
        if (hasRealExtension) {
          // Desktop Grid: real UP extension detected via EIP-6963, use it
          st.useUpProvider = false;
          // In Grid, only keep the wallet we actually use; hide picker (connect straight to working extension)
          st.wallets = [upWallet];
          useWallet(upWallet);
          // Check if already connected
          const [acc] = await upWallet.provider.request({ method: 'eth_accounts', params: [] }).catch(() => []);
          st.account = acc || null;
        } else {
          // Mobile UE app: no real extension, use up-provider for mini-app connect flow
          st.useUpProvider = true;
          st.provider = await (window.qfUP || Promise.resolve(null));
          if (st.provider) {
            // Don't call eth_requestAccounts on load; wait for user click on Connect
            const initial = st.provider.accounts || st.provider.allowedAccounts || 
              (await st.provider.request({ method: 'eth_accounts', params: [] }).catch(() => []));
            st.account = (initial && initial[0]) || null;
            st.provider.on?.('accountsChanged', (a) => { st.account = (a && a[0]) || null; st.msg = ''; render(); });
            st.provider.on?.('chainChanged', () => { st.msg = ''; render(); });
          }
        }
      } else {
        // Standalone: find wallets and use preferred
        st.wallets = await findWallets();
        const w = preferred();
        if (!w) { render(); return; }
        useWallet(w);
        // Already connected earlier with the remembered wallet? Then skip the Connect step (no popup).
        let saved = null; try { saved = localStorage.getItem(WKEY); } catch (e) {}
        if (st.wallets.length === 1 || saved === w.info.name) {
          const [acc] = await w.provider.request({ method: 'eth_accounts', params: [] }).catch(() => []);
          st.account = acc || null;
        }
      }
      render();
    } catch (e) { console.warn('Wallet not loaded', e); }
  }

  async function previewFromUrl() {
    const n = Number(new URLSearchParams(location.search).get('gg'));
    if (!Number.isInteger(n) || n < 1) return null;
    const seed = BigInt(await call(SEL.seedOf + pad(n)));
    return seed > 0n || n <= (st.minted || 0) ? seed : null;
  }

  el('ggNote').onclick = (e) => { if (e.target.id === 'ggSwitch' && !st.busy) showPicker(); };
  el('ggNew').onclick = () => draw(randomSeed());
  el('ggMint').onclick = () => (!st.account ? connect() : mint());
  el('ggQty').onclick = (e) => {
    const n = Number(e.target.dataset?.q);
    if (!n || st.busy || n > left()) return;
    st.qty = n; st.msg = ''; render();
  };
  const claimBtn = el('ggClaim');
  if (claimBtn) claimBtn.onclick = () => claimRevenue();
  const fixBtn = el('ggFix');
  if (fixBtn) fixBtn.onclick = () => fixImagesForUE();
  const headerBtn = el('ggHeader');
  if (headerBtn) headerBtn.onclick = () => setCollectionHeader();

  // Nothing of this block loads (no RPC, no p5) until the visitor scrolls near the bottom.
  let started = false;
  function start() {
    if (started) return; started = true;
    Promise.all([loadScript(), previewFromUrl().catch(() => null)]).then(([s, seed]) => {
      st.script = s; draw(seed ?? randomSeed()); box.hidden = false;
    }).catch((e) => console.warn('Script not loaded', e));
    refresh().catch(() => {});
    setInterval(() => { if (!document.hidden && !st.busy) refresh().catch(() => {}); }, 30000);
    initProvider();
    render();
  }
  const sentinel = document.querySelector('.foot') || box;
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { io.disconnect(); start(); } }, { rootMargin: '600px 0px' });
    io.observe(sentinel);
  } else start();
})();
