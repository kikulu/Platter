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
const { setActiveAccountViewVisible } = require('../lib/windows');
const state = require('../lib/state');
Module._load = originalLoad;

function fakeView() {
  const calls = [];
  return { view: { setVisible: (v) => calls.push(v) }, calls };
}

test.after(() => {
  fs.rmSync(tmpUserData, { recursive: true, force: true });
  state.accountViews.clear();
  state.activeAccountId = null;
});

test('setActiveAccountViewVisible：只對目前作用中的帳號呼叫 setVisible，不動其他帳號的 view', () => {
  state.accountViews.clear();
  const a = fakeView();
  const b = fakeView();
  state.accountViews.set('acc_a', a);
  state.accountViews.set('acc_b', b);
  state.activeAccountId = 'acc_a';

  setActiveAccountViewVisible(false);
  assert.deepEqual(a.calls, [false]);
  assert.deepEqual(b.calls, []); // 不是目前作用中的帳號，不該被動到

  setActiveAccountViewVisible(true);
  assert.deepEqual(a.calls, [false, true]);
  assert.deepEqual(b.calls, []);
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
