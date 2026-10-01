'use strict';

/**
 * test/selectors-seeding.test.js
 *
 * 測試 lib/stores.js 的 loadSelectors()：跟角色、知識庫同一類「覆蓋安裝補種」
 * 問題——原本只有 selectors.json 完全不存在時才套用 default-selectors.json，
 * 一旦存過檔，往後升級新增的平台或某個平台新補的選擇器欄位，既有使用者永遠
 * 拿不到。這裡驗證補上之後：缺的平台/欄位會補、使用者已經存在的值（包含
 * 空字串）一律不碰。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const DEFAULT_SELECTORS = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '..', 'extractors', 'default-selectors.json'),
    'utf-8'
  )
);

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'platter-selectors-seed-'));
const fakeElectron = {
  app: { getPath: () => tmpUserData },
  BrowserWindow: { getAllWindows: () => [] },
};
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return fakeElectron;
  return originalLoad.call(this, request, ...rest);
};
const { loadSelectors } = require('../lib/stores');
Module._load = originalLoad;

const selectorsFile = path.join(tmpUserData, 'selectors.json');
function reset() {
  if (fs.existsSync(selectorsFile)) fs.unlinkSync(selectorsFile);
}
function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

test.after(() => {
  fs.rmSync(tmpUserData, { recursive: true, force: true });
});

test('全新安裝：loadSelectors() 把所有平台的所有欄位都種進去', () => {
  reset();
  const selectors = loadSelectors();
  Object.keys(DEFAULT_SELECTORS).forEach((platform) => {
    Object.keys(DEFAULT_SELECTORS[platform]).forEach((key) => {
      assert.equal(selectors[platform][key], DEFAULT_SELECTORS[platform][key]);
    });
  });
});

test('升級補種：既有檔案缺一個平台、缺某個平台裡的一個欄位，載入後都會補上，其餘不動', () => {
  reset();
  const platforms = Object.keys(DEFAULT_SELECTORS);
  const missingPlatform = platforms[platforms.length - 1];
  const partialPlatform = platforms[0];
  const partialKeys = Object.keys(DEFAULT_SELECTORS[partialPlatform]);

  const existing = {};
  platforms.slice(0, -1).forEach((p) => {
    existing[p] = { ...DEFAULT_SELECTORS[p] };
  });
  // partialPlatform 故意漏一個欄位、且把其中一個欄位改成使用者自訂的值
  delete existing[partialPlatform][partialKeys[0]];
  existing[partialPlatform][partialKeys[1]] = 'MY-CUSTOM-SELECTOR';
  fs.writeFileSync(selectorsFile, JSON.stringify(existing));

  const selectors = loadSelectors();
  // 缺的平台整組補上
  assert.deepEqual(selectors[missingPlatform], DEFAULT_SELECTORS[missingPlatform]);
  // 缺的欄位補上
  assert.equal(
    selectors[partialPlatform][partialKeys[0]],
    DEFAULT_SELECTORS[partialPlatform][partialKeys[0]]
  );
  // 使用者自訂的值完全不動，不會被預設值蓋掉
  assert.equal(selectors[partialPlatform][partialKeys[1]], 'MY-CUSTOM-SELECTOR');

  const onDisk = readJSON(selectorsFile);
  assert.equal(onDisk[partialPlatform][partialKeys[1]], 'MY-CUSTOM-SELECTOR');
});

test('使用者刻意把某個欄位清空成空字串：不會被當成「缺少」而補回預設值', () => {
  reset();
  const platform = Object.keys(DEFAULT_SELECTORS)[0];
  const key = Object.keys(DEFAULT_SELECTORS[platform])[0];
  const existing = { [platform]: { ...DEFAULT_SELECTORS[platform], [key]: '' } };
  fs.writeFileSync(selectorsFile, JSON.stringify(existing));

  const selectors = loadSelectors();
  assert.equal(selectors[platform][key], '');
});

test('已經補好之後，重複載入結果穩定（不會每次又重新判斷成缺漏）', () => {
  reset();
  loadSelectors(); // 先種好一份完整的
  const selectors1 = loadSelectors();
  const selectors2 = loadSelectors();
  assert.deepEqual(selectors1, selectors2);
  Object.keys(DEFAULT_SELECTORS).forEach((platform) => {
    assert.deepEqual(selectors2[platform], DEFAULT_SELECTORS[platform]);
  });
});
