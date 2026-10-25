'use strict';

/**
 * test/attachments.test.js
 *
 * 匯出對話時一起下載檔案（1.50.0）：
 *   - lib/attachments.js：網址安全檢查、檔名清理、下載限制與去重（假 io）
 *   - toMarkdown：附件連結／圖片／只列名稱
 *   - exportCurrentConversation 整合：存檔路徑旁邊的 <檔名>_files 資料夾、md 內的相對連結、關閉下載時不收集
 *   - loadSelectors：舊的 Claude 預設選擇器自動升級，使用者自訂值不碰
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const att = require('../lib/attachments');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'platter-attach-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('isPrivateHost：本機、私有網段、連結本機、IPv6 內網都視為私有；公開主機不是', () => {
  ['localhost', 'a.localhost', 'printer.local', '127.0.0.1', '10.1.2.3', '192.168.0.9', '172.16.0.1', '172.31.255.1',
    '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', 'fd12::1', 'fe80::1', '::ffff:127.0.0.1', ''].forEach((h) =>
    assert.equal(att.isPrivateHost(h), true, h));
  ['cdn.example.com', '8.8.8.8', '172.32.0.1', '192.169.0.1', 'files.oaiusercontent.com'].forEach((h) =>
    assert.equal(att.isPrivateHost(h), false, h));
});

test('classifyUrl：同源與公開 https 可下載；本機／私有／file／javascript 一律擋；blob 只限同源', () => {
  const page = 'https://claude.ai/chat/1';
  assert.equal(att.classifyUrl('https://claude.ai/api/files/1', page), 'http');
  assert.equal(att.classifyUrl('https://cdn.example.com/a.png', page), 'http');
  assert.equal(att.classifyUrl('http://cdn.example.com/a.png', page), null, '跨站的明文 http 不下載');
  assert.equal(att.classifyUrl('https://localhost:8080/x', page), null);
  assert.equal(att.classifyUrl('https://192.168.1.1/x', page), null);
  assert.equal(att.classifyUrl('http://169.254.169.254/latest/meta-data', page), null);
  assert.equal(att.classifyUrl('file:///etc/passwd', page), null);
  assert.equal(att.classifyUrl('javascript:alert(1)', page), null);
  assert.equal(att.classifyUrl('not a url', page), null);
  assert.equal(att.classifyUrl('blob:https://claude.ai/uuid', page), 'inline');
  assert.equal(att.classifyUrl('blob:https://evil.test/uuid', page), null);
  assert.equal(att.classifyUrl('data:text/plain;base64,aGk=', page), 'inline');
  // 本地端 AI 服務：頁面本身在 localhost，同源就允許
  assert.equal(att.classifyUrl('http://localhost:11434/f.png', 'http://localhost:11434/'), 'http');
  assert.equal(att.classifyUrl('http://localhost:9999/f.png', 'http://localhost:11434/'), null);
});

test('sanitizeFileName：去掉路徑、控制字元、保留字與結尾點；過長保留副檔名', () => {
  assert.equal(att.sanitizeFileName('../../etc/passwd'), '_.._etc_passwd');
  assert.equal(att.sanitizeFileName('a\\b:c*d?.pdf'), 'a_b_c_d_.pdf');
  assert.equal(att.sanitizeFileName('  ..hidden. '), 'hidden');
  assert.equal(att.sanitizeFileName('CON'), '_CON');
  assert.equal(att.sanitizeFileName('nul.txt'), '_nul.txt');
  assert.equal(att.sanitizeFileName(''), 'file');
  assert.equal(att.sanitizeFileName('x\u0000y\n.md'), 'xy.md');
  const long = att.sanitizeFileName('名'.repeat(300) + '.docx');
  assert.ok(long.length <= 120 && long.endsWith('.docx'));
});

test('Content-Disposition 與 Content-Type 輔助', () => {
  assert.equal(att.fileNameFromContentDisposition("attachment; filename*=UTF-8''%E5%A0%B1%E5%91%8A.pdf"), '報告.pdf');
  assert.equal(att.fileNameFromContentDisposition('attachment; filename="a b.csv"'), 'a b.csv');
  assert.equal(att.fileNameFromContentDisposition(''), '');
  assert.equal(att.extFromContentType('image/png; charset=x'), '.png');
  assert.equal(att.extFromContentType('application/x-unknown'), '');
});

test('downloadAttachments：存檔、同名去重、缺副檔名補上、同網址只下載一次、名稱-only、封鎖與失敗分類', async () => {
  const dir = path.join(tmp, 'a_files');
  const calls = [];
  const io = {
    pageUrl: 'https://claude.ai/chat/1',
    fetchUrl: async (url, kind) => {
      calls.push([url, kind]);
      if (url.includes('boom')) throw new Error('HTTP 500');
      if (url.includes('huge')) return { buffer: Buffer.alloc(att.LIMITS.fileBytes + 1) };
      if (url.includes('disp')) return { buffer: Buffer.from('D'), contentDisposition: "attachment; filename*=UTF-8''%E5%A0%B1%E5%91%8A.pdf" };
      if (url.includes('noext')) return { buffer: Buffer.from('N'), contentType: 'image/png' };
      return { buffer: Buffer.from('content:' + url) };
    },
  };
  const r = await att.downloadAttachments(
    [
      { url: 'https://claude.ai/f/1', name: 'report.pdf' },
      { url: 'https://claude.ai/f/2', name: 'report.pdf' }, // 同名
      { url: 'https://claude.ai/f/1', name: 'again.pdf' }, // 同網址
      { url: 'https://claude.ai/disp', name: 'ignored' },
      { url: 'https://claude.ai/noext', name: 'picture' },
      { url: 'https://claude.ai/f/../../x', name: '../../evil.txt' },
      { url: null, name: '只有名稱.docx', kind: 'card' },
      { url: 'http://localhost:1/x', name: 'local.txt' },
      { url: 'https://claude.ai/boom', name: 'bad.bin' },
      { url: 'https://claude.ai/huge', name: 'huge.bin' },
      { url: 'data:text/plain;base64,aGVsbG8=', name: 'inline.txt' },
    ],
    dir,
    io
  );
  assert.deepEqual(r.results.map((x) => [x.status, x.localName || x.reason || '']), [
    ['saved', 'report.pdf'],
    ['saved', 'report (2).pdf'],
    ['saved', 'report.pdf'],
    ['saved', '報告.pdf'],
    ['saved', 'picture.png'],
    ['saved', '_.._evil.txt'],
    ['name-only', ''],
    ['skipped', 'blocked-url'],
    ['failed', 'HTTP 500'],
    ['skipped', 'too-large'],
    ['saved', 'inline.txt'],
  ]);
  assert.deepEqual([r.saved, r.failed, r.nameOnly, r.skipped], [6, 1, 1, 2]);
  assert.equal(calls.filter((c) => c[0] === 'https://claude.ai/f/1').length, 1, '同網址只抓一次');
  assert.equal(fs.readFileSync(path.join(dir, 'inline.txt'), 'utf8'), 'hello');
  // 沒有任何檔案跑出資料夾外
  assert.ok(fs.readdirSync(dir).every((n) => !n.includes('/') && !n.includes('\\')));
  assert.equal(fs.existsSync(path.join(tmp, 'evil.txt')), false);
});

test('downloadAttachments：全部失敗或只有名稱時不建立資料夾；超過數量上限的略過', async () => {
  const d1 = path.join(tmp, 'none_files');
  const r1 = await att.downloadAttachments([{ url: null, name: 'x' }, { url: 'https://claude.ai/boom', name: 'y' }], d1, {
    pageUrl: 'https://claude.ai/',
    fetchUrl: async () => {
      throw new Error('nope');
    },
  });
  assert.equal(fs.existsSync(d1), false);
  assert.equal(r1.saved, 0);
  const many = Array.from({ length: att.LIMITS.files + 3 }, (_, i) => ({ url: `https://claude.ai/f/${i}`, name: `f${i}.txt` }));
  const r2 = await att.downloadAttachments(many, path.join(tmp, 'many_files'), {
    pageUrl: 'https://claude.ai/',
    fetchUrl: async () => ({ buffer: Buffer.from('x') }),
  });
  assert.equal(r2.saved, att.LIMITS.files);
  assert.equal(r2.skipped, 3);
});

// ---------------------------------------------------------------------------
// toMarkdown
// ---------------------------------------------------------------------------

const originalLoad = Module._load;
const fake = {
  userData: path.join(tmp, 'userData'),
  docs: path.join(tmp, 'docs'),
  save: null,
};
fs.mkdirSync(fake.userData, { recursive: true });
const fakeElectron = {
  app: { getPath: (k) => (k === 'documents' ? fake.docs : fake.userData) },
  BrowserWindow: { getAllWindows: () => [] },
  Notification: class { static isSupported() { return false; } },
  clipboard: { writeText() {} },
  dialog: { showSaveDialog: async () => ({ canceled: !fake.save, filePath: fake.save }) },
};
Module._load = function (request, ...rest) {
  if (request === 'electron') return fakeElectron;
  return originalLoad.call(this, request, ...rest);
};
const { toMarkdown } = require('../lib/utils');
const state = require('../lib/state');
const { exportCurrentConversation } = require('../lib/conversationCapture');
const { loadSelectors } = require('../lib/stores');
Module._load = originalLoad;

test('toMarkdown：有 linkDir 且已下載 → 連結／圖片；否則只列名稱；只有附件的訊息不會多出空段落', () => {
  const result = {
    title: 'T',
    messages: [
      { role: 'user', text: '', attachments: [{ name: '照片 1.png', kind: 'image', localName: '照片 1.png' }] },
      { role: 'assistant', text: '好的', attachments: [{ name: '報告.pdf', kind: 'link', localName: '報告.pdf' }, { name: '尚未下載.docx', kind: 'card' }] },
    ],
    pageFiles: [{ name: '成品.md', kind: 'card' }],
  };
  const withLinks = toMarkdown(result, { linkDir: 'T_files' });
  assert.match(withLinks, /!\[照片 1\.png\]\(\.\/T_files\/%E7%85%A7%E7%89%87%201\.png\)/);
  assert.match(withLinks, /📎 \[報告\.pdf\]\(\.\/T_files\/%E5%A0%B1%E5%91%8A\.pdf\)/);
  assert.match(withLinks, /📎 尚未下載\.docx/);
  assert.match(withLinks, /📎 成品\.md/);
  const plain = toMarkdown(result);
  assert.doesNotMatch(plain, /\]\(\.\//);
  assert.match(plain, /📎 報告\.pdf/);
});

// ---------------------------------------------------------------------------
// exportCurrentConversation 整合（假的帳號視圖）
// ---------------------------------------------------------------------------

function installFakeView(captureResult) {
  const scripts = [];
  state.activeAccountId = 'acc1';
  state.accountViews.set('acc1', {
    platform: 'claude',
    view: {
      webContents: {
        getURL: () => 'https://claude.ai/chat/1',
        executeJavaScript: async (script) => {
          scripts.push(script);
          return JSON.parse(JSON.stringify(captureResult));
        },
        session: {
          fetch: async (url) => {
            if (url.includes('missing')) return { ok: false, status: 404, headers: new Map() };
            const body = Buffer.from('FILE:' + url);
            let sent = false;
            return {
              ok: true,
              status: 200,
              headers: new Map([['content-type', 'application/pdf']]),
              body: { getReader: () => ({ read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: new Uint8Array(body) })), cancel: async () => {} }) },
            };
          },
        },
      },
    },
  });
  return scripts;
}

const capture = () => ({
  ok: true,
  title: '我的對話',
  messages: [
    { role: 'user', text: '請給我報告' },
    {
      role: 'assistant',
      text: '這是報告',
      attachments: [
        { url: 'https://claude.ai/api/files/1/report', name: 'report', kind: 'link' },
        { url: 'https://claude.ai/api/files/missing', name: 'gone.pdf', kind: 'link' },
        { url: null, name: '雲端文件.docx', kind: 'card' },
      ],
    },
  ],
  pageFiles: [],
  debug: { pageUrl: 'https://claude.ai/chat/1', attachmentCount: 3 },
});

test('匯出：檔案下載到 <檔名>_files，md 內是相對連結，回傳下載統計；失敗與只有名稱的會被回報', async () => {
  state.appState.ui.skipSaveDialog = false;
  state.appState.ui.defaultSavePath = path.join(tmp, 'out');
  const scripts = installFakeView(capture());
  fake.save = path.join(tmp, 'out', '我的對話.md');
  const res = await exportCurrentConversation('md', { downloadFiles: true });
  assert.equal(res.ok, true);
  assert.deepEqual(res.files, { saved: 1, failed: 1, nameOnly: 1, skipped: 0, dir: '我的對話_files' });
  const md = fs.readFileSync(fake.save, 'utf8');
  assert.match(md, /📎 \[report\.pdf\]\(\.\/%E6%88%91%E7%9A%84%E5%B0%8D%E8%A9%B1_files\/report\.pdf\)/);
  assert.match(md, /📎 gone\.pdf/);
  assert.match(md, /📎 雲端文件\.docx/);
  assert.equal(fs.readFileSync(path.join(tmp, 'out', '我的對話_files', 'report.pdf'), 'utf8'), 'FILE:https://claude.ai/api/files/1/report');
  assert.match(scripts[0], /"loadAll":true,"collectFiles":true/);

  // JSON：附件帶 status／localName
  fake.save = path.join(tmp, 'out', '我的對話.json');
  const resJson = await exportCurrentConversation('json', { downloadFiles: true });
  assert.equal(resJson.ok, true);
  const json = JSON.parse(fs.readFileSync(fake.save, 'utf8'));
  assert.deepEqual(json.messages[1].attachments.map((a) => a.status), ['saved', 'failed', 'name-only']);
  // 第二次匯出同一資料夾已有 report.pdf → 新檔名去重
  assert.equal(json.messages[1].attachments[0].localName, 'report (2).pdf');
});

test('匯出：關閉下載 → 不收集、不建資料夾、md 不含附件行', async () => {
  const scripts = installFakeView({ ...capture(), messages: [{ role: 'user', text: '只有文字' }] });
  fake.save = path.join(tmp, 'out2', 'plain.md');
  state.appState.ui.defaultSavePath = path.join(tmp, 'out2');
  const res = await exportCurrentConversation('md', { downloadFiles: false });
  assert.equal(res.ok, true);
  assert.equal(res.files, null);
  assert.match(scripts[0], /"collectFiles":false/);
  assert.equal(fs.existsSync(path.join(tmp, 'out2', 'plain_files')), false);
});

// ---------------------------------------------------------------------------
// 舊預設選擇器升級
// ---------------------------------------------------------------------------

test('loadSelectors：舊的 Claude 預設 turn 升級成新預設；使用者自訂的不碰；補上 fileSelector 欄位', () => {
  const file = path.join(fake.userData, 'selectors.json');
  const defaults = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'extractors', 'default-selectors.json'), 'utf8'));
  const legacy = '[data-testid="user-message"], [data-testid="conversation-turn"]';
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, claude: { turn: legacy, userHint: 'data-testid=user-message' } }));
  const up = loadSelectors();
  assert.equal(up.claude.turn, defaults.claude.turn);
  assert.match(up.claude.turn, /font-claude-response/);
  assert.equal(up.claude.fileSelector, '');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).claude.turn, defaults.claude.turn, '升級後寫回檔案');

  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, claude: { turn: '.my-custom-turn', userHint: 'x' } }));
  assert.equal(loadSelectors().claude.turn, '.my-custom-turn');
});
