// Collection header for Generative Square.
// Left to right: large, medium, small. Backgrounds go from the lightest
// paper to the darkest paper. Each panel is a real output of the deployed
// script (collection/deployed-art.js), not a flat swatch.

export const CONTRACT = '0x33Dd4D3da812e2cc1B3692456470DFDD99659e62';
export const OWNER = '0x52224e802F722A3F3f1de8b2157597ae7fEfffD1';
export const RPC = 'https://rpc.mainnet.lukso.network';
export const LSP4_METADATA_KEY = '0x9afb95cacc9f95858ec44aa8c3b685511002e30ae54415823f406128b85b238e';
export const SET_DATA_SELECTOR = '0x7f23690c';
export const VERIFIABLE_URI_PREFIX = '00008019f9b10020';

export const BACKGROUNDS = ['#fcfaf6', '#f7f3ea', '#faf8f2'];
export const SQUARE_COLORS = ['#9b9980', '#9b8d80', '#9b7980'];

export const HEADER_URL = 'https://minimalnl.github.io/stille-feed/collection/generative-square-header.png';
export const HEADER_SMALL_URL = 'https://minimalnl.github.io/stille-feed/collection/generative-square-header-1800.png';

// Token 5 is the largest minted square and the lightest background.
// Token 7 is the image Universal Everything shows today, and it sits between
// the other two in both size and background value.
// No minted token is both the smallest square and the darkest background
// (token 3 is the only darkest background, and it is large), so the right
// panel is an unminted seed drawn by the same on-chain script.
export const PANELS = [
  { place: 'left', size: 'large', tokenId: 5, seed: 776970099, background: '#fcfaf6', square: '#9b7980' },
  { place: 'middle', size: 'medium', tokenId: 7, seed: 118881353, background: '#faf8f2', square: '#9b8d80' },
  { place: 'right', size: 'small', tokenId: null, seed: 100000609, background: '#f7f3ea', square: '#9b9980' },
];

export const PANEL_PX = 2400;
export const HEADER_WIDTH = PANEL_PX * PANELS.length;
export const HEADER_HEIGHT = PANEL_PX;

const DESCRIPTION = 'One square, its own seed. Script and seed live on-chain.';

export function headerMetadata() {
  const sizes = [
    { width: HEADER_WIDTH, height: HEADER_HEIGHT, url: HEADER_URL },
    { width: 1800, height: 600, url: HEADER_SMALL_URL },
  ];
  return {
    LSP4Metadata: {
      name: 'Generative Square',
      description: DESCRIPTION,
      links: [],
      icon: sizes.map((size) => ({ ...size })),
      images: [sizes.map((size) => ({ ...size }))],
      assets: [],
      attributes: [],
    },
  };
}

export function headerMetadataJson() {
  return JSON.stringify(headerMetadata());
}

// p5.js 1.9 LCG, matching verify-background-distribution.js and the deployed script.
export function predictSquare(seed) {
  let state = (seed < 4294967296 ? seed : seed % 4294967296) >>> 0;
  const next = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
  next(); // setup() discards the first draw
  const color = SQUARE_COLORS[Math.floor(next() * SQUARE_COLORS.length)];
  const fraction = 0.236 + next() * (0.382 - 0.236);
  const background = BACKGROUNDS[(Math.floor(Number(seed)) >>> 0) % BACKGROUNDS.length];
  return { background, square: color, fraction };
}

export function encodeVerifiableURI(jsonStr, keccak256) {
  const jsonBytes = new TextEncoder().encode(jsonStr);
  const digest = String(keccak256(jsonBytes)).replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error('keccak256 must be 32 bytes');
  const dataUrl = 'data:application/json;base64,' + Buffer.from(jsonStr, 'utf8').toString('base64');
  const urlHex = Buffer.from(dataUrl, 'utf8').toString('hex');
  return '0x' + VERIFIABLE_URI_PREFIX + digest + urlHex;
}

export function encodeSetData(valueHex) {
  const key = LSP4_METADATA_KEY.replace(/^0x/i, '');
  if (key.length !== 64) throw new Error('LSP4Metadata key must be 32 bytes');
  const value = String(valueHex).replace(/^0x/i, '').toLowerCase();
  if (!value || value.length % 2) throw new Error('metadata value must be even hex');
  const valueBytes = value.length / 2;
  const padBytes = (32 - (valueBytes % 32)) % 32;
  const head = SET_DATA_SELECTOR.replace(/^0x/i, '')
    + key
    + '40'.padStart(64, '0')
    + BigInt(valueBytes).toString(16).padStart(64, '0');
  return '0x' + head + value + '0'.repeat(padBytes * 2);
}
