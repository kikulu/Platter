'use strict';

/**
 * test/roles-seeding.test.js
 *
 * 測試角色的內建預設補種邏輯（lib/stores.js 的 applyIncrementalDefaultRoleSeeds()，
 * 透過 loadAppState()／saveAppState() 間接觸發）：
 *   1. 全新安裝：8 個內建角色一次種進去
 *   2. 從舊安裝升級（已有部分角色、沒有 seeded-defaults.json 的 roles 紀錄）：
 *      回溯比對，只補「真的缺少」的角色，不重複、不動使用者已刪除的角色
 *   3. 補種過一次之後：再次載入不重複補、使用者刪掉的內建角色不會被補回來
 *   4. 【回歸測試】seeded-defaults.json 是知識庫跟角色共用的同一個檔案，
 *      兩邊各自的 key（knowledgeBase/knowledgeGroups vs roles）不能因為
 *      呼叫順序不同就互相覆蓋掉——這是這次順便修的既有 bug，見
 *      lib/stores.js 的 readSeededDefaultsRecord()／writeSeededDefaultsRecord()。
 *
 * lib/stores.js 依賴 electron（經由 lib/dataDir.js、lib/broadcast.js），這裡在載入
 * 前用一個假的 electron 模組換掉，資料目錄指向暫存資料夾，這樣就能在一般 Node.js
 * 環境下直接跑真正的種子程式碼，不需要啟動 Electron。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const DEFAULT_ROLES = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'extractors', 'default-roles.json'), 'utf-8')
).roles;

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'platter-roles-seed-'));
const fakeElectron = {
  app: { getPath: () => tmpUserData },
  BrowserWindow: { getAllWindows: () => [] },
};
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return fakeElectron;
  return originalLoad.call(this, request, ...rest);
};
const { loadAppState, loadKnowledgeBase } = require('../lib/stores');
const state = require('../lib/state');
Module._load = originalLoad;

const stateFile = path.join(tmpUserData, 'app-state.json');
const seededFile = path.join(tmpUserData, 'seeded-defaults.json');
const knowledgeFile = path.join(tmpUserData, 'knowledge-base.json');

function reset() {
  [stateFile, seededFile, knowledgeFile].forEach((f) => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });
}
function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

test.after(() => {
  fs.rmSync(tmpUserData, { recursive: true, force: true });
});

test('全新安裝：loadAppState() 把全部 8 個內建角色種進 state.appState.roles', () => {
  reset();
  loadAppState();
  assert.equal(state.appState.roles.length, DEFAULT_ROLES.length);
  const ids = state.appState.roles.map((r) => r.id).sort();
  assert.deepEqual(ids, DEFAULT_ROLES.map((r) => r.id).sort());
  // 也要真的寫進磁碟，不是只留在記憶體裡
  assert.equal(readJSON(stateFile).roles.length, DEFAULT_ROLES.length);
});

test('從舊安裝升級：已有 7/8 個內建角色、沒有 seeded-defaults.json 的 roles 紀錄，只補少的那一個', () => {
  reset();
  const missing = DEFAULT_ROLES[DEFAULT_ROLES.length - 1]; // 假裝這是「這次升級才新增」的角色
  const existingRoles = DEFAULT_ROLES.slice(0, -1).map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    color: r.color,
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
  }));
  fs.writeFileSync(stateFile, JSON.stringify({ accounts: [], roles: existingRoles }));
  // 刻意不寫 seeded-defaults.json：模擬「這個機制上線前」的舊安裝

  loadAppState();
  assert.equal(state.appState.roles.length, DEFAULT_ROLES.length);
  assert.ok(state.appState.roles.some((r) => r.id === missing.id));
  // 原本 7 個角色的 createdAt 不會被改掉（沒有被當成「新種」重新覆蓋）
  const untouched = state.appState.roles.find((r) => r.id === existingRoles[0].id);
  assert.equal(untouched.createdAt, '2020-01-01T00:00:00.000Z');
});

test('補種過一次之後：再次載入不重複補、使用者刪掉的內建角色也不會被補回來', () => {
  reset();
  loadAppState(); // 全新安裝，種入全部 8 個
  const stateData = readJSON(stateFile);
  const removed = stateData.roles.pop(); // 使用者刪掉一個內建角色
  fs.writeFileSync(stateFile, JSON.stringify(stateData));

  loadAppState();
  assert.equal(state.appState.roles.length, DEFAULT_ROLES.length - 1);
  assert.ok(!state.appState.roles.some((r) => r.id === removed.id));

  // 再載入一次，數量依然不變（不會被「回溯比對」誤判成又要重補）
  loadAppState();
  assert.equal(state.appState.roles.length, DEFAULT_ROLES.length - 1);
});

test('【回歸】seeded-defaults.json 是共用檔案：先跑知識庫種子、再跑角色種子，兩邊的 key 不會互相蓋掉', () => {
  reset();
  loadKnowledgeBase(); // 先觸發知識庫那邊寫一次 seeded-defaults.json
  let record = readJSON(seededFile);
  assert.ok(Array.isArray(record.knowledgeBase) && record.knowledgeBase.length > 0);
  assert.equal(record.roles, undefined); // 角色還沒跑過

  loadAppState(); // 再觸發角色那邊寫一次
  record = readJSON(seededFile);
  assert.ok(Array.isArray(record.knowledgeBase) && record.knowledgeBase.length > 0); // 沒被蓋掉
  assert.ok(Array.isArray(record.roles) && record.roles.length === DEFAULT_ROLES.length);
});

test('【回歸】反過來的呼叫順序（先角色、再知識庫）結果一樣，兩邊 key 都保留', () => {
  reset();
  loadAppState();
  let record = readJSON(seededFile);
  assert.ok(Array.isArray(record.roles) && record.roles.length === DEFAULT_ROLES.length);
  assert.equal(record.knowledgeBase, undefined);

  loadKnowledgeBase();
  record = readJSON(seededFile);
  assert.ok(Array.isArray(record.roles) && record.roles.length === DEFAULT_ROLES.length);
  assert.ok(Array.isArray(record.knowledgeBase) && record.knowledgeBase.length > 0);
});
