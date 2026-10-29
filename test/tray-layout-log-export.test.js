'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../lib/trayLayout');
const { buildLogExportFileName, LOG_EXPORT_KINDS } = require('../lib/logExport');
const { normalizeTrayPrefs } = require('../lib/utils');

const C = { x: 100, y: 50, width: 1000, height: 700 };

test('托盤預設位置：右下角留邊距', () => {
  const b = L.computeTrayBounds(C, null, false);
  assert.deepEqual(b, { x: 100 + 1000 - 56 - 16, y: 50 + 700 - 56 - 16, width: 56, height: 56 });
});

test('托盤展開：圓鈕在右下 → 往左上長，且右下角與圓鈕對齊', () => {
  const b = L.computeTrayBounds(C, null, true);
  assert.equal(b.x + b.width, 100 + 1000 - 16);
  assert.equal(b.y + b.height, 50 + 700 - 16);
});

test('托盤展開：圓鈕在左上 → 往右下長', () => {
  const pos = { right: 1000 - 56 - 10, bottom: 700 - 56 - 10 }; // 距左上各 10px
  const b = L.computeTrayBounds(C, pos, true);
  assert.equal(b.x, 110);
  assert.equal(b.y, 60);
});

test('托盤位置會被夾在容器內（主視窗縮小後不會跑到外面）', () => {
  const b = L.computeTrayBounds({ x: 0, y: 0, width: 300, height: 200 }, { right: 5000, bottom: 5000 }, false);
  assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= 300 && b.y + b.height <= 200);
  const e = L.computeTrayBounds({ x: 0, y: 0, width: 300, height: 200 }, null, true);
  assert.ok(e.x >= 0 && e.y >= 0 && e.x + e.width <= 300 && e.y + e.height <= 200);
});

test('positionFromBounds：收起時與 computeTrayBounds 互為反運算', () => {
  for (const pos of [
    { right: 123, bottom: 77 },
    { right: 800, bottom: 500 },
  ]) {
    const b = L.computeTrayBounds(C, pos, false);
    assert.deepEqual(L.positionFromBounds(C, b, false), pos);
  }
});

test('positionFromBounds：展開時反推的位置，重新計算出的面板與原本相同', () => {
  for (const pos of [
    { right: 123, bottom: 77 },
    { right: 800, bottom: 500 },
    { right: 16, bottom: 16 },
    { right: 900, bottom: 20 },
  ]) {
    const b = L.computeTrayBounds(C, pos, true);
    const back = L.positionFromBounds(C, b, true);
    assert.deepEqual(L.computeTrayBounds(C, back, true), b);
  }
});

test('clampBoundsToContainer 與 intersectRects', () => {
  const b = L.clampBoundsToContainer(C, { x: -500, y: 9999, width: 56, height: 56 });
  assert.deepEqual(b, { x: 100, y: 50 + 700 - 56, width: 56, height: 56 });
  assert.equal(L.intersectRects(C, { x: 5000, y: 5000, width: 10, height: 10 }), null);
  assert.deepEqual(L.intersectRects(C, { x: 0, y: 0, width: 200, height: 100 }), {
    x: 100,
    y: 50,
    width: 100,
    height: 50,
  });
});

test('normalizeTrayPrefs 的 position：合法保留、不合法為 null', () => {
  assert.equal(normalizeTrayPrefs({}).position, null);
  assert.equal(normalizeTrayPrefs({ position: { right: 'x', bottom: 1 } }).position, null);
  assert.deepEqual(normalizeTrayPrefs({ position: { right: 10.4, bottom: -3 } }).position, {
    right: 10,
    bottom: 0,
  });
});

test('日誌匯出檔名依類型區隔', () => {
  const d = new Date(2026, 9, 28, 16, 51);
  assert.equal(buildLogExportFileName('errors', d), 'platter-errors-2026-10-28.json');
  assert.equal(buildLogExportFileName('audits', d), 'platter-audits-2026-10-28.json');
  assert.equal(buildLogExportFileName('console', d), 'platter-console-2026-10-28.json');
  assert.equal(buildLogExportFileName('all', d), 'platter-logs-all-2026-10-28.json');
  assert.equal(buildLogExportFileName('bogus', d), 'platter-logs-all-2026-10-28.json');
  assert.deepEqual(LOG_EXPORT_KINDS, ['errors', 'audits', 'console', 'all']);
});
