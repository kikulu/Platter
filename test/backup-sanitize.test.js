'use strict';

/**
 * test/backup-sanitize.test.js
 *
 * 備份匯入的資料驗證（M-1）、本地服務網址驗證（M-4）、文件開啟／刪除的第二道防線（M-3）。
 * 前半是純函式測試；後半用假的 electron 直接呼叫真正的 IPC handler，餵一份惡意備份。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const {
  sanitizeBackupAccount,
  sanitizeBackupDocument,
  validRecords,
} = require('../lib/backupSanitize');

const DOCS = path.join(path.sep, 'data', 'documents');

// ---- 純函式 ----

test('sanitizeBackupAccount：一般帳號只留白名單欄位，多餘欄位丟棄', () => {
  const a = sanitizeBackupAccount({
    id: 'acc_1_x',
    platform: 'claude',
    name: ' Work ',
    roleId: 'role_1',
    url: 'file:///etc/passwd', // 一般平台不該有 url
    evil: { a: 1 },
  });
  assert.deepEqual(a, {
    id: 'acc_1_x',
    platform: 'claude',
    name: 'Work',
    roleId: 'role_1',
  });
});

test('sanitizeBackupAccount：未知平台、壞 id、非物件一律回傳 null', () => {
  assert.equal(sanitizeBackupAccount({ id: 'a', platform: 'evil' }), null);
  assert.equal(sanitizeBackupAccount({ id: '../x', platform: 'claude' }), null);
  assert.equal(sanitizeBackupAccount({ id: 'a b', platform: 'claude' }), null);
  assert.equal(sanitizeBackupAccount({ platform: 'claude' }), null);
  assert.equal(sanitizeBackupAccount({ id: 'a', platform: '__proto__' }), null);
  assert.equal(sanitizeBackupAccount(null), null);
  assert.equal(sanitizeBackupAccount([]), null);
  assert.equal(sanitizeBackupAccount('x'), null);
});

test('sanitizeBackupAccount：本地服務網址只接受 http(s)，不合法清空；類型不認得退回 custom', () => {
  const ok = sanitizeBackupAccount({
    id: 'l1',
    platform: 'local',
    name: 'Ollama',
    url: 'http://localhost:11434',
    serviceType: 'llm',
  });
  assert.equal(ok.url, 'http://localhost:11434');
  assert.equal(ok.serviceType, 'llm');

  const bad = sanitizeBackupAccount({
    id: 'l2',
    platform: 'local',
    name: 'x',
    url: 'file:///C:/Users/me/secret.html',
    serviceType: 'toString',
  });
  assert.equal(bad.url, '');
  assert.equal(bad.serviceType, 'custom');
});

test('sanitizeBackupDocument：文件庫資料夾底下的路徑保留，其餘清空並取消 managed', () => {
  const inside = sanitizeBackupDocument(
    { id: 'd1', name: 'a.pdf', filePath: path.join(DOCS, 'a.pdf'), managed: true },
    DOCS
  );
  assert.equal(inside.doc.filePath, path.join(DOCS, 'a.pdf'));
  assert.equal(inside.doc.managed, true);
  assert.equal(inside.pathCleared, false);

  [
    '/etc/passwd',
    path.join(DOCS, '..', 'secret.pdf'),
    'C:\\Windows\\system32\\cmd.exe',
    '../../x',
    DOCS,
  ].forEach((p) => {
    const r = sanitizeBackupDocument(
      { id: 'd2', name: 'x', filePath: p, managed: true },
      DOCS
    );
    assert.equal(r.doc.filePath, '', p);
    assert.equal(r.doc.managed, false, p);
    assert.equal(r.pathCleared, true, p);
  });
});

test('sanitizeBackupDocument：欄位型別修正，壞 id 回傳 null', () => {
  const r = sanitizeBackupDocument(
    { id: 'd3', name: 5, tags: ['a', 1, null], notes: {}, filePath: 7 },
    DOCS
  );
  assert.equal(r.doc.name, '');
  assert.deepEqual(r.doc.tags, ['a']);
  assert.equal(r.doc.notes, '');
  assert.equal(r.doc.filePath, '');
  assert.equal(r.pathCleared, false); // 本來就沒有有效路徑
  assert.equal(sanitizeBackupDocument({ id: '../../x' }, DOCS), null);
  assert.equal(sanitizeBackupDocument(null, DOCS), null);
});

test('validRecords：只留有字串 id 的物件', () => {
  assert.deepEqual(
    validRecords([
      { id: 'a' },
      { id: '' },
      { id: 5 },
      null,
      'x',
      [],
      { name: 'no id' },
      { id: 'b', x: 1 },
    ]),
    [{ id: 'a' }, { id: 'b', x: 1 }]
  );
  assert.deepEqual(validRecords(undefined), []);
  assert.deepEqual(validRecords('nope'), []);
});

// ---- IPC：用假的 electron 呼叫真正的 handler ----

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'platter-backup-'));
const tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'platter-backup-work-'));
const ui = { openPaths: [], opened: [], showItem: [] };
const fakeElectron = {
  app: { getPath: () => tmpUserData, getVersion: () => 'test' },
  BrowserWindow: { getAllWindows: () => [] },
  Notification: class {
    static isSupported() {
      return false;
    }
  },
  shell: {
    openPath: (p) => ui.opened.push(p),
    showItemInFolder: (p) => ui.showItem.push(p),
    openExternal: async () => {},
  },
  session: {},
  net: {},
  dialog: {
    showOpenDialog: async () => ({ canceled: false, filePaths: ui.openPaths }),
    showSaveDialog: async () => ({ canceled: true }),
    showMessageBox: async () => ({ response: 0 }),
    showErrorBox: () => {},
  },
};
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return fakeElectron;
  // 這個環境不一定裝得到這幾個套件；這裡的測試用不到它們
  if (request === 'mammoth' || request === 'docx' || request === 'pdf-lib') return {};
  return originalLoad.call(this, request, ...rest);
};
const { registerSettingsIpc } = require('../lib/ipc/settings');
const { registerDocumentsIpc } = require('../lib/ipc/documents');
const { registerAccountsIpc } = require('../lib/ipc/accounts');
const stores = require('../lib/stores');
const state = require('../lib/state');
const { documentsDir } = require('../lib/dataDir');
const {
  addAccount,
  testLocalServiceConnection,
  updateLocalService,
} = require('../lib/windows');
Module._load = originalLoad;

const handlers = new Map();
const ipc = { handle: (ch, fn) => handlers.set(ch, fn) };
registerSettingsIpc(ipc);
registerDocumentsIpc(ipc);
registerAccountsIpc(ipc);
const invoke = (ch, arg) => handlers.get(ch)({}, arg);
stores.loadAppState();

test.after(() => {
  fs.rmSync(tmpUserData, { recursive: true, force: true });
  fs.rmSync(tmpWork, { recursive: true, force: true });
});

test('settings:importBackup：惡意備份——外部路徑被清空、file:// 網址被清掉、壞帳號與壞資料被丟棄', async () => {
  const insidePath = path.join(documentsDir(), 'ok.pdf');
  const backup = {
    accounts: [
      { id: 'good_1', platform: 'claude', name: 'Good' },
      { id: 'evil_platform', platform: 'evil', name: 'x' },
      { id: '../escape', platform: 'claude', name: 'x' },
      {
        id: 'evil_local',
        platform: 'local',
        name: 'L',
        url: 'file:///etc/passwd',
        serviceType: 'custom',
      },
      {
        id: 'web_local',
        platform: 'local',
        name: 'W',
        url: 'http://localhost:1234',
        serviceType: 'llm',
      },
      'not an object',
    ],
    knowledge: {
      items: [{ id: 'kb_ok', title: 't', content: 'c' }, { title: 'no id' }, null],
      groups: 'nope',
    },
    projects: [{ id: 'p_ok', name: 'P' }, 42],
    documents: [
      { id: 'doc_evil_1', name: 'passwd.pdf', filePath: '/etc/passwd', managed: true },
      {
        id: 'doc_evil_2',
        name: 'cmd',
        filePath: 'C:\\Windows\\system32\\cmd.exe',
        managed: false,
      },
      { id: 'doc_ok', name: 'ok.pdf', filePath: insidePath, managed: true },
    ],
    conversations: [{ id: 'conv_ok', title: 'c', content: 'x' }, { content: 'no id' }],
  };
  const backupFile = path.join(tmpWork, 'evil-backup.json');
  fs.writeFileSync(backupFile, JSON.stringify(backup));
  ui.openPaths = [backupFile];

  const result = await invoke('settings:importBackup');
  assert.equal(result.ok, true);
  assert.equal(result.clearedDocPaths, 2);

  const ids = state.appState.accounts.map((a) => a.id);
  assert.deepEqual(ids.sort(), ['evil_local', 'good_1', 'web_local']);
  assert.equal(state.appState.accounts.find((a) => a.id === 'evil_local').url, '');
  assert.equal(
    state.appState.accounts.find((a) => a.id === 'web_local').url,
    'http://localhost:1234'
  );

  assert.deepEqual(
    stores
      .loadKnowledgeBase()
      .items.map((i) => i.id)
      .filter((i) => i === 'kb_ok'),
    ['kb_ok']
  );
  assert.equal(
    stores.loadKnowledgeBase().items.some((i) => !i.id),
    false
  );
  assert.deepEqual(
    stores.loadProjects().map((p) => p.id),
    ['p_ok']
  );
  assert.deepEqual(
    stores.loadConversations().map((c) => c.id),
    ['conv_ok']
  );

  const docs = stores.loadDocuments();
  const byId = Object.fromEntries(docs.map((d) => [d.id, d]));
  assert.equal(byId.doc_evil_1.filePath, '');
  assert.equal(byId.doc_evil_1.managed, false);
  assert.equal(byId.doc_evil_2.filePath, '');
  assert.equal(byId.doc_ok.filePath, insidePath);
  assert.equal(byId.doc_ok.managed, true);
});

test('settings:importBackup：整份不是物件（陣列、字串）直接當成無效檔案', async () => {
  const f = path.join(tmpWork, 'array-backup.json');
  fs.writeFileSync(f, JSON.stringify([1, 2, 3]));
  ui.openPaths = [f];
  assert.deepEqual(await invoke('settings:importBackup'), {
    ok: false,
    error: 'INVALID_FILE',
  });
});

test('documents:openFile：可執行檔／腳本／網頁／巨集文件被擋，不呼叫 shell.openPath；一般文件照常開', async () => {
  fs.mkdirSync(documentsDir(), { recursive: true });
  const mk = (name) => {
    const p = path.join(documentsDir(), name);
    fs.writeFileSync(p, 'x');
    return p;
  };
  const docs = [
    { id: 'o_exe', name: 'a', filePath: mk('a.exe') },
    { id: 'o_html', name: 'b', filePath: mk('b.html') },
    { id: 'o_pdf', name: 'c', filePath: mk('c.pdf') },
  ];
  stores.saveDocuments([...stores.loadDocuments(), ...docs]);
  ui.opened.length = 0;

  assert.deepEqual(await invoke('documents:openFile', 'o_exe'), {
    ok: false,
    error: 'EXECUTABLE_BLOCKED',
  });
  assert.deepEqual(await invoke('documents:openFile', 'o_html'), {
    ok: false,
    error: 'EXECUTABLE_BLOCKED',
  });
  assert.deepEqual(ui.opened, []);
  assert.deepEqual(await invoke('documents:openFile', 'o_pdf'), { ok: true });
  assert.deepEqual(ui.opened, [docs[2].filePath]);
  // 「在資料夾中顯示」不受影響（只是顯示，不執行）
  assert.deepEqual(await invoke('documents:showInFolder', 'o_exe'), { ok: true });
});

test('documents:delete：alsoDeleteFile 只刪文件庫資料夾底下的已管理檔案，不刪外部檔案', async () => {
  const outside = path.join(tmpWork, 'precious.txt');
  fs.writeFileSync(outside, 'keep me');
  const inside = path.join(documentsDir(), 'managed.txt');
  fs.writeFileSync(inside, 'x');
  stores.saveDocuments([
    ...stores.loadDocuments(),
    { id: 'del_out', name: 'o', filePath: outside, managed: true }, // 中繼資料被竄改：managed 卻指向外部
    { id: 'del_in', name: 'i', filePath: inside, managed: true },
  ]);
  await invoke('documents:delete', { id: 'del_out', alsoDeleteFile: true });
  assert.equal(fs.existsSync(outside), true, '外部檔案不可被刪');
  await invoke('documents:delete', { id: 'del_in', alsoDeleteFile: true });
  assert.equal(fs.existsSync(inside), false);
});

test('addAccount／updateLocalService／testLocalServiceConnection：主程序驗證網址與平台', async () => {
  assert.equal(addAccount('evil', 'x', null, {}), null);
  assert.equal(addAccount('local', 'x', null, { url: 'file:///etc/passwd' }), null);
  assert.equal(addAccount('local', 'x', null, { url: 'javascript:alert(1)' }), null);
  assert.equal(addAccount('local', 'x', null, {}), null);

  const before = state.appState.accounts.length;
  assert.equal(
    await invoke('accounts:add', {
      platform: 'local',
      name: 'x',
      extra: { url: 'file:///x' },
    }),
    null
  );
  assert.equal(state.appState.accounts.length, before);

  // 合法的新增（switchAccount 需要真的視窗，這裡只驗證驗證邏輯：直接改帳號清單後測更新）
  state.appState.accounts.push({
    id: 'ls_1',
    platform: 'local',
    name: 'L',
    url: 'http://localhost:1',
    serviceType: 'llm',
  });
  state.accountViews.set('ls_1', { view: null, platform: 'local', name: 'L' });
  const updated = updateLocalService('ls_1', {
    url: 'file:///etc/passwd',
    name: 'Renamed',
  });
  assert.equal(updated.url, 'http://localhost:1', '不合法網址被忽略');
  assert.equal(updated.name, 'Renamed', '其他欄位照常更新');
  assert.equal(
    updateLocalService('ls_1', { url: 'https://example.com' }).url,
    'https://example.com'
  );

  assert.deepEqual(await testLocalServiceConnection('file:///etc/passwd'), {
    ok: false,
    error: 'INVALID_URL',
  });
  assert.deepEqual(await testLocalServiceConnection('javascript:alert(1)'), {
    ok: false,
    error: 'INVALID_URL',
  });
});
