// Pixel checks for the collection header, plus an independent ABI check.
//   npm install --no-save --no-package-lock pngjs@7.0.0 ethers@6.13.5
//   node --test scripts/collection-header.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { Interface, id, keccak256 } from 'ethers';
import {
  PANELS, PANEL_PX, HEADER_WIDTH, HEADER_HEIGHT, LSP4_METADATA_KEY, SET_DATA_SELECTOR,
  headerMetadataJson, encodeVerifiableURI, encodeSetData, predictSquare,
} from './collection-header-data.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function rgb(png, x, y) {
  const i = (png.width * y + x) << 2;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
}

function parseHex(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function luminance(rgb) {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function squareWidth(png, panelIndex) {
  const origin = panelIndex * PANEL_PX;
  const cy = Math.floor(PANEL_PX / 2);
  const cx = origin + cy;
  const paper = rgb(png, origin + 8, 8);
  const away = (x) => {
    const p = rgb(png, x, cy);
    return Math.abs(p[0] - paper[0]) + Math.abs(p[1] - paper[1]) + Math.abs(p[2] - paper[2]) > 80;
  };
  let left = cx;
  let right = cx;
  while (left > origin && away(left - 1)) left--;
  while (right < origin + PANEL_PX - 1 && away(right + 1)) right++;
  return right - left + 1;
}

test('planned seeds are large, medium, small with three backgrounds and three colors', () => {
  const predicted = PANELS.map((panel) => predictSquare(panel.seed));
  assert.deepEqual(predicted.map((item) => item.background), ['#fcfaf6', '#faf8f2', '#f7f3ea']);
  assert.deepEqual(predicted.map((item) => item.square), ['#9b7980', '#9b8d80', '#9b9980']);
  assert.ok(predicted[0].fraction > predicted[1].fraction);
  assert.ok(predicted[1].fraction > predicted[2].fraction);
  const lum = predicted.map((item) => luminance(parseHex(item.background)));
  assert.ok(lum[0] > lum[1] && lum[1] > lum[2]);
});

test('header is three equal panels with descending squares and three papers', async () => {
  const png = PNG.sync.read(await readFile(join(root, 'collection', 'generative-square-header.png')));
  assert.equal(png.width, HEADER_WIDTH);
  assert.equal(png.height, HEADER_HEIGHT);
  const widths = PANELS.map((_, index) => squareWidth(png, index));
  assert.ok(widths[0] > widths[1] + 80, `large square should be clearly bigger (${widths})`);
  assert.ok(widths[1] > widths[2] + 80, `medium square should be clearly bigger (${widths})`);
  PANELS.forEach((panel, index) => {
    const predicted = predictSquare(panel.seed);
    const paper = rgb(png, index * PANEL_PX + 8, 8);
    assert.deepEqual(paper, parseHex(panel.background));
    assert.ok(Math.abs(widths[index] / PANEL_PX - predicted.fraction) < 0.012);
    const center = rgb(png, index * PANEL_PX + PANEL_PX / 2, PANEL_PX / 2);
    const nearest = ['#9b9980', '#9b8d80', '#9b7980'].map(parseHex).sort((a, b) => {
      const da = Math.abs(a[0] - center[0]) + Math.abs(a[1] - center[1]) + Math.abs(a[2] - center[2]);
      const db = Math.abs(b[0] - center[0]) + Math.abs(b[1] - center[1]) + Math.abs(b[2] - center[2]);
      return da - db;
    })[0];
    assert.deepEqual(nearest, parseHex(panel.square));
  });
  // Sharp join: the two pixels on either side of a seam are the two papers, not a border.
  for (const seam of [PANEL_PX, PANEL_PX * 2]) {
    assert.deepEqual(rgb(png, seam - 1, 8), parseHex(PANELS[seam / PANEL_PX - 1].background));
    assert.deepEqual(rgb(png, seam, 8), parseHex(PANELS[seam / PANEL_PX].background));
  }
});

test('the smaller file is the same triptych at 1800 by 600', async () => {
  const png = PNG.sync.read(await readFile(join(root, 'collection', 'generative-square-header-1800.png')));
  assert.equal(png.width, 1800);
  assert.equal(png.height, 600);
  assert.deepEqual(rgb(png, 8, 8), parseHex('#fcfaf6'));
  assert.deepEqual(rgb(png, 600 + 8, 8), parseHex('#faf8f2'));
  assert.deepEqual(rgb(png, 1200 + 8, 8), parseHex('#f7f3ea'));
});

test('metadata points icon and images at the wide banner and calldata matches ethers', async () => {
  const json = headerMetadataJson();
  const stored = (await readFile(join(root, 'collection', 'lsp4-metadata.json'), 'utf8')).replace(/\n$/, '');
  assert.equal(stored, json);
  const parsed = JSON.parse(json);
  const sizes = parsed.LSP4Metadata.images[0];
  assert.deepEqual(parsed.LSP4Metadata.icon, sizes);
  assert.deepEqual(sizes.map((item) => [item.width, item.height]), [[7200, 2400], [1800, 600]]);
  assert.ok(sizes.every((item) => item.url.includes('generative-square-header')));
  assert.equal(parsed.LSP4Metadata.attributes.length, 0);
  assert.equal(id('setData(bytes32,bytes)').slice(0, 10), SET_DATA_SELECTOR);
  assert.equal(id('LSP4Metadata'), LSP4_METADATA_KEY);
  const value = encodeVerifiableURI(json, (bytes) => keccak256(bytes));
  const hand = encodeSetData(value);
  const iface = new Interface(['function setData(bytes32 dataKey, bytes dataValue)']);
  const ethersCall = iface.encodeFunctionData('setData', [LSP4_METADATA_KEY, value]);
  assert.equal(hand, ethersCall);
  const committed = (await readFile(join(root, 'collection', 'setdata-calldata.txt'), 'utf8')).trim();
  assert.equal(committed, ethersCall);
  const committedValue = (await readFile(join(root, 'collection', 'setdata-value.txt'), 'utf8')).trim();
  assert.equal(committedValue, value);
  assert.equal(committed.slice(0, 10), SET_DATA_SELECTOR);
  assert.ok(!json.includes('-600.png'));
});
