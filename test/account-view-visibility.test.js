'use strict';

/**
 * test/account-view-visibility.test.js
 *
 * 測試 lib/windows.js 的 setActiveAccountViewVisible()：index.html 自己的
 * 全螢幕遮罩（匯出對話框、命令面板）開啟前要呼叫它暫時隱藏目前帳號的
 * WebContentsView，不然遮罩會被蓋住、看起來像「點了沒反應」（1.37.0
 * 修正的 bug）。這裡只驗證「找對目前作用中的帳號、呼叫它 view 的
 * setVisible()」這段邏輯本身，不需要真正的 WebContentsView，用一個
 * 帶 spy 的假 view 物件就能驗證。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'platter-view-visibility-'));
const fakeElectron = {
  app: { getPath: () => tmpUserData },
  BrowserWindow: { getAllWindows: () => [] },
};
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return fakeElectron;
  return originalLoad.call(this, request, ...rest);
};
const {
  setActiveAccountViewVisible,
  switchAccount,
  getAccountStatusSnapshot,
  continueWaitingAccount,
} = require('../lib/windows');
const state = require('../lib/state');
Module._load = originalLoad;

function fakeView(status = 'ready') {
  const calls = [];
  return { view: { setVisible: (v) => calls.push(v) }, status, calls };
}

test.after(() => {
  fs.rmSync(tmpUserData, { recursive: true, force: true });
  state.accountViews.clear();
  state.activeAccountId = null;
  setActiveAccountViewVisible(true);
});

test('setActiveAccountViewVisible：遮罩開啟時隱藏目前帳號，關閉後恢復；其他帳號永遠是隱藏的', () => {
  state.accountViews.clear();
  const a = fakeView();
  const b = fakeView();
  state.accountViews.set('acc_a', a);
  state.accountViews.set('acc_b', b);
  state.activeAccountId = 'acc_a';

  setActiveAccountViewVisible(false);
  assert.equal(a.calls.at(-1), false);
  assert.equal(b.calls.at(-1), false); // 不是目前作用中的帳號，不該顯示

  setActiveAccountViewVisible(true);
  assert.equal(a.calls.at(-1), true);
  assert.equal(b.calls.at(-1), false);
});

test('帳號頁面不是 ready（載入中／崩潰／無回應…）時，遮罩關閉後也不會把 view 亮出來', () => {
  for (const status of ['loading', 'unloaded', 'crashed', 'unresponsive', 'failed']) {
    state.accountViews.clear();
    const a = fakeView(status);
    state.accountViews.set('acc_a', a);
    state.activeAccountId = 'acc_a';
    setActiveAccountViewVisible(true);
    assert.equal(a.calls.at(-1), false, status);
  }
});

test('setActiveAccountViewVisible：沒有任何帳號在用時（activeAccountId 是 null）安全地什麼都不做', () => {
  state.accountViews.clear();
  state.activeAccountId = null;
  assert.doesNotThrow(() => setActiveAccountViewVisible(false));
  assert.doesNotThrow(() => setActiveAccountViewVisible(true));
});

test('setActiveAccountViewVisible：activeAccountId 指到一個已經被移除的帳號時不丟例外', () => {
  state.accountViews.clear();
  state.activeAccountId = 'acc_gone';
  assert.doesNotThrow(() => setActiveAccountViewVisible(false));
});

test('switchAccount(deferLoad)：開機延後載入時只切成目前帳號，不建立 view，狀態是 unloaded', () => {
  state.accountViews.clear();
  state.appState = { accounts: [], ui: { lastActiveAccountId: null }, extensions: [], roles: [] };
  state.accountViews.set('acc_a', { view: null, platform: 'claude', name: 'A', status: 'unloaded' });
  assert.equal(switchAccount('acc_a', { deferLoad: true }), true);
  assert.equal(state.activeAccountId, 'acc_a');
  assert.equal(state.accountViews.get('acc_a').view, null);
  const snap = getAccountStatusSnapshot();
  assert.equal(snap.activeAccountId, 'acc_a');
  assert.equal(snap.statuses.acc_a.status, 'unloaded');
  assert.equal(switchAccount('acc_missing', { deferLoad: true }), false);
});

test('continueWaitingAccount：無回應時選擇繼續等待，會把 view 亮出來', () => {
  state.accountViews.clear();
  const a = fakeView('unresponsive');
  state.accountViews.set('acc_a', { ...a, platform: 'claude', name: 'A' });
  state.activeAccountId = 'acc_a';
  setActiveAccountViewVisible(true);
  assert.equal(a.calls.at(-1), false);
  assert.equal(continueWaitingAccount('acc_a'), true);
  assert.equal(a.calls.at(-1), true);
  assert.equal(continueWaitingAccount('acc_none'), false);
});
