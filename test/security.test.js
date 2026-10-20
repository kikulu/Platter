'use strict';

/**
 * test/security.test.js
 *
 * lib/security.js：網址／路徑／副檔名判斷、視窗加固、IPC 來源檢查、擴充功能權限摘要、
 * .bak 清除。不啟動 Electron，用假的 webContents／ipcMain 驗證。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const {
  isHttpUrl,
  isSafeExternalUrl,
  normalizeServiceUrl,
  isPathInside,
  isExecutableFile,
  isTrustedAppUrl,
  isTrustedSender,
  hardenAppWebContents,
  hardenAccountWebContents,
  guardIpc,
  summarizeExtensionPermissions,
  formatExtensionPermissionSummary,
  removeBackupFor,
  removeAllBackupFiles,
} = require('../lib/security');

const RENDERER = path.join(path.sep, 'app', 'renderer');
// 用 pathToFileURL 產生網址，Windows（含磁碟機代號）與 POSIX 都能通過
const fileUrl = (rel) => pathToFileURL(path.join(RENDERER, rel)).href;
const appFileUrl = (...parts) => pathToFileURL(path.join(path.sep, 'app', ...parts)).href;

// ---- 網址 ----

test('isSafeExternalUrl：只接受 http、https、mailto', () => {
  assert.equal(isSafeExternalUrl('https://example.com/a?b=1'), true);
  assert.equal(isSafeExternalUrl('http://localhost:11434'), true);
  assert.equal(isSafeExternalUrl('mailto:a@example.com'), true);
  [
    'javascript:alert(1)',
    'file:///etc/passwd',
    'data:text/html,hi',
    'ftp://x',
    '',
    null,
    undefined,
    42,
    'not a url',
  ].forEach((u) => assert.equal(isSafeExternalUrl(u), false, String(u)));
});

test('normalizeServiceUrl：只接受 http(s)，合法時回傳原字串（去頭尾空白）', () => {
  assert.equal(
    normalizeServiceUrl('  http://localhost:11434 '),
    'http://localhost:11434'
  );
  assert.equal(normalizeServiceUrl('https://example.com/ui'), 'https://example.com/ui');
  assert.equal(normalizeServiceUrl('file:///C:/secret.html'), null);
  assert.equal(normalizeServiceUrl('javascript:alert(1)'), null);
  assert.equal(normalizeServiceUrl('mailto:a@b.c'), null);
  assert.equal(normalizeServiceUrl(''), null);
  assert.equal(isHttpUrl('x'.repeat(3000)), false); // 過長
});

// ---- 路徑 ----

test('isPathInside：只認真正在資料夾底下的路徑，擋 ..、相同路徑、同名前綴', () => {
  const dir = path.join(path.sep, 'data', 'documents');
  assert.equal(isPathInside(path.join(dir, 'a.pdf'), dir), true);
  assert.equal(isPathInside(path.join(dir, 'sub', 'a.pdf'), dir), true);
  assert.equal(isPathInside(path.join(dir, '..', 'secret.pdf'), dir), false);
  assert.equal(isPathInside(path.join(dir, '..', 'documents-evil', 'a.pdf'), dir), false);
  assert.equal(isPathInside(dir, dir), false);
  assert.equal(isPathInside('', dir), false);
  assert.equal(isPathInside(null, dir), false);
});

// ---- 副檔名 ----

test('isExecutableFile：程式、腳本、網頁、巨集文件都擋；一般文件不擋', () => {
  [
    'a.exe',
    'A.EXE',
    'run.bat',
    'x.ps1',
    'x.sh',
    'a.lnk',
    'a.jar',
    'p.html',
    'p.svg',
    'm.docm',
    'x.AppImage',
    'invoice.pdf.exe',
    'a.exe ',
    'a.exe.',
  ].forEach((n) => assert.equal(isExecutableFile(n), true, n));
  ['a.pdf', 'a.docx', 'a.md', 'a.txt', 'a.png', 'noext', ''].forEach((n) =>
    assert.equal(isExecutableFile(n), false, n)
  );
  assert.equal(isExecutableFile(null), false);
});

// ---- 視窗加固 ----

function fakeWebContents() {
  const handlers = {};
  return {
    handlers,
    openHandler: null,
    on(name, fn) {
      handlers[name] = fn;
    },
    setWindowOpenHandler(fn) {
      this.openHandler = fn;
    },
  };
}
function fakeNavEvent(url) {
  return {
    url,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
}

test('isTrustedAppUrl：只認 renderer/ 底下的 file:// 頁面（含查詢字串）', () => {
  assert.equal(isTrustedAppUrl(fileUrl('index.html'), RENDERER), true);
  assert.equal(
    isTrustedAppUrl(fileUrl('project.html') + '?select=abc#x', RENDERER),
    true
  );
  assert.equal(isTrustedAppUrl(appFileUrl('main.js'), RENDERER), false);
  assert.equal(isTrustedAppUrl(appFileUrl('other', 'index.html'), RENDERER), false);
  assert.equal(
    isTrustedAppUrl('https://evil.example/app/renderer/index.html', RENDERER),
    false
  );
  assert.equal(isTrustedAppUrl('data:text/html,hi', RENDERER), false);
  assert.equal(isTrustedAppUrl('', RENDERER), false);
  assert.equal(isTrustedAppUrl(undefined, RENDERER), false);
});

test('hardenAppWebContents：導向外部網站被擋、導向自己的頁面放行、開新視窗一律拒絕', () => {
  const wc = fakeWebContents();
  const blocked = [];
  hardenAppWebContents(wc, {
    rendererDir: RENDERER,
    onBlock: (k, u) => blocked.push([k, u]),
  });

  const evil = fakeNavEvent('https://evil.example/steal');
  wc.handlers['will-navigate'](evil, evil.url);
  assert.equal(evil.prevented, true);

  const redirect = fakeNavEvent('https://evil.example/r');
  wc.handlers['will-redirect'](redirect, redirect.url);
  assert.equal(redirect.prevented, true);

  const own = fakeNavEvent(fileUrl('settings.html'));
  wc.handlers['will-navigate'](own, own.url);
  assert.equal(own.prevented, false);

  // 新版 Electron 的事件物件自帶 url、不一定有第二個參數
  const evt = fakeNavEvent('file:///etc/passwd');
  wc.handlers['will-navigate'](evt);
  assert.equal(evt.prevented, true);

  assert.deepEqual(wc.openHandler({ url: 'https://evil.example' }), { action: 'deny' });
  assert.deepEqual(wc.openHandler({ url: fileUrl('index.html') }), { action: 'deny' });
  assert.ok(blocked.length >= 4);
  assert.equal(
    blocked.some(([k]) => k === 'open'),
    true
  );
});

test('hardenAccountWebContents：擋 file: 等非網頁協定，http(s) 導覽與彈窗放行（OAuth 登入需要）', () => {
  const wc = fakeWebContents();
  hardenAccountWebContents(wc, {});
  const file = fakeNavEvent('file:///etc/passwd');
  wc.handlers['will-navigate'](file, file.url);
  assert.equal(file.prevented, true);
  const web = fakeNavEvent('https://accounts.google.com/o/oauth2/auth');
  wc.handlers['will-navigate'](web, web.url);
  assert.equal(web.prevented, false);
  assert.deepEqual(wc.openHandler({ url: 'https://accounts.google.com/popup' }), {
    action: 'allow',
  });
  assert.deepEqual(wc.openHandler({ url: 'about:blank' }), { action: 'allow' });
  assert.deepEqual(wc.openHandler({ url: 'file:///etc/passwd' }), { action: 'deny' });
  assert.deepEqual(wc.openHandler({ url: 'chrome://settings' }), { action: 'deny' });
});

// ---- IPC 來源檢查 ----

test('isTrustedSender：沒有 senderFrame、網址不是自己頁面都不信任', () => {
  assert.equal(
    isTrustedSender({ senderFrame: { url: fileUrl('index.html') } }, RENDERER),
    true
  );
  assert.equal(
    isTrustedSender({ senderFrame: { url: 'https://evil.example/' } }, RENDERER),
    false
  );
  assert.equal(isTrustedSender({ senderFrame: null }, RENDERER), false);
  assert.equal(isTrustedSender({}, RENDERER), false);
  assert.equal(isTrustedSender(null, RENDERER), false);
});

test('guardIpc：可信來源照常執行並傳遞參數，不可信來源拒絕、通報、不執行 handler', async () => {
  const registered = {};
  const fakeIpc = { handle: (ch, fn) => (registered[ch] = fn) };
  const rejected = [];
  const ipc = guardIpc(fakeIpc, {
    rendererDir: RENDERER,
    onReject: (channel) => rejected.push(channel),
  });
  let ran = 0;
  ipc.handle('demo:echo', (e, a, b) => {
    ran += 1;
    return a + b;
  });

  const good = { senderFrame: { url: fileUrl('knowledge.html') } };
  assert.equal(await registered['demo:echo'](good, 2, 3), 5);
  assert.equal(ran, 1);

  const bad = { senderFrame: { url: 'https://evil.example/' } };
  assert.throws(() => registered['demo:echo'](bad, 2, 3), /UNTRUSTED_SENDER/);
  assert.equal(ran, 1);
  assert.deepEqual(rejected, ['demo:echo']);
});

// ---- 擴充功能權限摘要 ----

test('summarizeExtensionPermissions：分出一般權限與網站權限，偵測範圍過大', () => {
  const s = summarizeExtensionPermissions({
    permissions: ['tabs', 'storage', '<all_urls>'],
    host_permissions: ['https://a.example/*'],
  });
  assert.deepEqual(s.permissions, ['tabs', 'storage']);
  assert.deepEqual(s.hostPermissions, ['https://a.example/*', '<all_urls>']);
  assert.equal(s.broad, true);

  const narrow = summarizeExtensionPermissions({
    host_permissions: ['https://a.example/*'],
  });
  assert.equal(narrow.broad, false);
  assert.deepEqual(summarizeExtensionPermissions(null), {
    permissions: [],
    hostPermissions: [],
    broad: false,
  });
  assert.deepEqual(
    summarizeExtensionPermissions({ permissions: 'x', host_permissions: [1, null] }),
    {
      permissions: [],
      hostPermissions: [],
      broad: false,
    }
  );
});

test('formatExtensionPermissionSummary：範圍過大時有警告字樣', () => {
  const broad = formatExtensionPermissionSummary({
    permissions: [],
    hostPermissions: ['<all_urls>'],
    broad: true,
  });
  assert.match(broad, /所有網站/);
  const none = formatExtensionPermissionSummary({
    permissions: [],
    hostPermissions: [],
    broad: false,
  });
  assert.match(none, /沒有宣告/);
});

// ---- .bak 清除 ----

test('removeBackupFor／removeAllBackupFiles：只刪 .json.bak，不動主檔與其他檔案', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'platter-bak-'));
  try {
    [
      'conversations.json',
      'conversations.json.bak',
      'app-state.json',
      'app-state.json.bak',
      'note.txt.bak',
      'keep.md',
    ].forEach((n) => fs.writeFileSync(path.join(dir, n), 'x'));
    assert.equal(removeBackupFor(path.join(dir, 'conversations.json')), true);
    assert.equal(fs.existsSync(path.join(dir, 'conversations.json.bak')), false);
    assert.equal(fs.existsSync(path.join(dir, 'conversations.json')), true);
    assert.equal(removeBackupFor(path.join(dir, 'missing.json')), true); // 不存在視為成功

    assert.equal(removeAllBackupFiles(dir), 1); // 只剩 app-state.json.bak
    assert.equal(fs.existsSync(path.join(dir, 'app-state.json.bak')), false);
    assert.equal(fs.existsSync(path.join(dir, 'note.txt.bak')), true);
    assert.equal(fs.existsSync(path.join(dir, 'app-state.json')), true);
    assert.equal(removeAllBackupFiles(path.join(dir, 'no-such-dir')), 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
