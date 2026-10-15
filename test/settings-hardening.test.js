'use strict';

/**
 * test/settings-hardening.test.js
 *
 * 1.42.0 設定相關的加固（M-5、L-1、L-4）：新增擴充功能前的權限確認、
 * 清除 .bak、第三方頁面 console 擷取開關。用假的 electron 直接呼叫真正的 IPC handler。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'platter-hard-'));
const tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'platter-hard-work-'));
const ui = { folder: null, boxes: [], response: 0 };
const fakeElectron = {
  app: { getPath: () => tmpUserData, getVersion: () => 'test' },
  BrowserWindow: { getAllWindows: () => [] },
  Notification: class {
    static isSupported() {
      return false;
    }
  },
  shell: {},
  session: { defaultSession: { clearCache: async () => {} } },
  net: {},
  dialog: {
    showOpenDialog: async () => ({ canceled: false, filePaths: [ui.folder] }),
    showMessageBox: async (win, opts) => {
      ui.boxes.push(opts);
      return { response: ui.response };
    },
    showErrorBox: () => {},
  },
};
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return fakeElectron;
  return originalLoad.call(this, request, ...rest);
};
const { registerSettingsIpc } = require('../lib/ipc/settings');
const stores = require('../lib/stores');
const state = require('../lib/state');
Module._load = originalLoad;

const handlers = new Map();
registerSettingsIpc({ handle: (ch, fn) => handlers.set(ch, fn) });
const invoke = (ch, arg) => handlers.get(ch)({}, arg);
stores.loadAppState();

test.after(() => {
  fs.rmSync(tmpUserData, { recursive: true, force: true });
  fs.rmSync(tmpWork, { recursive: true, force: true });
});

function makeExtension(manifest) {
  const dir = fs.mkdtempSync(path.join(tmpWork, 'ext-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  return dir;
}

test('settings:addExtension：先顯示權限摘要，使用者取消就不新增', async () => {
  ui.folder = makeExtension({ name: 'Greedy', version: '1', permissions: ['tabs'], host_permissions: ['<all_urls>'] });
  ui.response = 1; // 取消
  ui.boxes.length = 0;
  const before = state.appState.extensions.length;
  await invoke('settings:addExtension');
  assert.equal(state.appState.extensions.length, before);
  assert.equal(ui.boxes.length, 1);
  assert.equal(ui.boxes[0].type, 'warning', '可存取所有網站要用警告樣式');
  assert.match(ui.boxes[0].detail, /tabs/);
  assert.match(ui.boxes[0].detail, /<all_urls>/);
  assert.match(ui.boxes[0].detail, /所有網站/);
});

test('settings:addExtension：使用者確認後才新增；窄權限不顯示警告樣式', async () => {
  ui.folder = makeExtension({ name: 'Narrow', version: '2', permissions: ['storage'], host_permissions: ['https://example.com/*'] });
  ui.response = 0;
  ui.boxes.length = 0;
  const before = state.appState.extensions.length;
  await invoke('settings:addExtension');
  assert.equal(state.appState.extensions.length, before + 1);
  assert.equal(ui.boxes[0].type, 'question');
  assert.equal(state.appState.extensions.at(-1).name, 'Narrow');
});

test('settings:clearBackupFiles：只刪資料資料夾第一層的 *.json.bak', async () => {
  const { getDataDir } = require('../lib/dataDir');
  const dir = getDataDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'conversations.json.bak'), 'old');
  fs.writeFileSync(path.join(dir, 'documents.json.bak'), 'old');
  fs.writeFileSync(path.join(dir, 'keep.json'), 'keep');
  const result = await invoke('settings:clearBackupFiles');
  assert.equal(result.ok, true);
  assert.ok(result.count >= 2); // 先前的存檔也可能已留下 .bak
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.bak')), []);
  assert.equal(fs.existsSync(path.join(dir, 'conversations.json.bak')), false);
  assert.equal(fs.existsSync(path.join(dir, 'keep.json')), true);
});

test('settings:getPageConsole／setPageConsole：預設關閉，只有 true 才開啟', async () => {
  assert.equal(await invoke('settings:getPageConsole'), false);
  assert.equal(await invoke('settings:setPageConsole', true), true);
  assert.equal(await invoke('settings:getPageConsole'), true);
  assert.equal(await invoke('settings:setPageConsole', 'yes'), false, '非布林 true 一律視為關閉');
  assert.equal(await invoke('settings:getPageConsole'), false);
});

test('原始碼：loadExtension 一律 allowFileAccess:false；頁面 console 擷取受開關控制', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  [read('lib/windows.js'), read('lib/ipc/settings.js')].forEach((src) => {
    assert.ok(!/allowFileAccess:\s*true/.test(src));
  });
  assert.match(read('lib/windows.js'), /capturePageConsole === true/);
});
