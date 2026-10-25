'use strict';

/**
 * test/domCapture.test.js
 *
 * extractors/domCapture.js 是注入瀏覽器執行的腳本，這裡用最小的假 DOM
 * （只實作它用到的 querySelectorAll / contains / innerText / getAttribute）
 * 驗證「巢狀符合的外層容器不會造成內容重複疊加」。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeNode(text, children = [], extra = {}) {
  const node = {
    innerText: text,
    children,
    classList: { contains: () => false },
    tagName: 'DIV',
    getAttribute: () => null,
    hasAttribute: () => false,
    querySelectorAll: () => [],
    contains(other) {
      if (other === node) return true;
      return children.some((c) => c.contains(other));
    },
    ...extra,
  };
  return node;
}

// 1.50.0：domCapture 的函式是 async；呼叫端用 executeJavaScript 會自動等 Promise
async function runCapture(nodes, { cfg = { turn: 'x', userHint: '' }, options = { loadAll: false }, doc = {}, extraSandbox = {} } = {}) {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'extractors', 'domCapture.js'),
    'utf-8'
  );
  const sandbox = {
    document: { title: 't', querySelectorAll: () => nodes, ...doc },
    location: { href: 'https://example.test/chat/1' },
    URL,
    setTimeout,
    ...extraSandbox,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  sandbox.__cfg = JSON.stringify(cfg);
  sandbox.__opts = JSON.stringify(options);
  // 跨 vm realm 的物件原型不同，先 JSON 往返成本 realm 的普通物件再比較
  const json = await vm.runInContext(
    'capturePlatformConversation("claude", JSON.parse(__cfg), JSON.parse(__opts)).then(function (r) { return JSON.stringify(r); })',
    sandbox
  );
  return JSON.parse(json);
}

test('外層容器內含其他符合節點時，只保留最內層，不重複疊加', async () => {
  const a = makeNode('第一則');
  const b = makeNode('第二則');
  const wrapper = makeNode('第一則\n第二則', [a, b]);
  const result = await runCapture([wrapper, a, b]);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.messages.map((m) => m.text),
    ['第一則', '第二則']
  );
});

test('相鄰完全相同的訊息會被合併', async () => {
  const a = makeNode('同一則');
  const b = makeNode('同一則');
  const result = await runCapture([a, b]);
  assert.equal(result.messages.length, 1);
});

test('互不包含的節點照常全部保留', async () => {
  const result = await runCapture([makeNode('甲'), makeNode('乙'), makeNode('甲')]);
  assert.deepEqual(
    result.messages.map((m) => m.text),
    ['甲', '乙', '甲']
  );
});

test('側邊欄／導覽列等頁面外殼裡的符合節點不算訊息（selector 太寬鬆時的保險）', async () => {
  const inNav = makeNode('最近對話 A', [], { closest: () => ({}) });
  const real = makeNode('真正的訊息', [], { closest: () => null });
  const result = await runCapture([inNav, real]);
  assert.deepEqual(result.messages.map((m) => m.text), ['真正的訊息']);
  assert.equal(result.debug.chromeSkipped, 1);
});

test('收集訊息裡的檔案：下載連結、大圖、卡片名稱；小圖示與一般連結略過；只有附件沒有文字的訊息也保留', async () => {
  const a = (href, innerText, attrs = {}) => ({ href, innerText, hasAttribute: (n) => n in attrs, getAttribute: (n) => attrs[n] ?? null });
  const img = (src, w, extra = {}) => ({ src, currentSrc: src, naturalWidth: w, naturalHeight: w, className: '', alt: '', ...extra });
  const withFiles = makeNode('這是報告', [], {
    querySelectorAll: (sel) => {
      if (sel === 'a[href]')
        return [
          a('https://cdn.test/files/abc/report.pdf', '報告.pdf'),
          a('https://example.test/other-page', '一般連結'),
          a('blob:https://example.test/xyz', '表格', { download: 'data.csv' }),
          a('mailto:x@y.z', 'mail'),
        ];
      if (sel === 'img') return [img('https://cdn.test/gen/1.png', 512, { alt: '產生的圖'}), img('https://cdn.test/avatar.png', 32), img('https://cdn.test/emoji.png', 200, { className: 'emoji' })];
      return [];
    },
  });
  const imageOnly = makeNode('', [], { querySelectorAll: (sel) => (sel === 'img' ? [img('https://cdn.test/up/photo.jpg', 800)] : []) });
  const result = await runCapture([withFiles, imageOnly]);
  assert.equal(result.messages.length, 2);
  assert.deepEqual(
    result.messages[0].attachments.map((x) => [x.name, x.kind, x.url]),
    [
      ['報告.pdf', 'link', 'https://cdn.test/files/abc/report.pdf'],
      ['data.csv', 'link', 'blob:https://example.test/xyz'],
      ['產生的圖', 'image', 'https://cdn.test/gen/1.png'],
    ]
  );
  assert.equal(result.messages[1].text, '');
  assert.equal(result.messages[1].attachments.length, 1);
  assert.equal(result.debug.attachmentCount, 4);
});

test('collectFiles:false 不收集檔案；fileSelector 卡片沒有網址時只記名稱', async () => {
  const card = makeNode('企業級課程.docx\nDOCX', [], { matches: () => false, getAttribute: () => null, querySelector: () => null });
  const msg = makeNode('文字', [], { querySelectorAll: (sel) => (sel === '.card' ? [card] : []) });
  const off = await runCapture([msg], { options: { loadAll: false, collectFiles: false }, cfg: { turn: 'x', userHint: '', fileSelector: '.card' } });
  assert.equal(off.messages[0].attachments, undefined);
  const on = await runCapture([msg], {
    cfg: { turn: 'x', userHint: '', fileSelector: '.card' },
    doc: { querySelectorAll: (sel) => (sel === '.card' ? [] : [msg]) },
  });
  assert.deepEqual(on.messages[0].attachments, [{ url: null, name: '企業級課程.docx', kind: 'card' }]);
});

test('loadAll：往上捲動直到訊息數與高度穩定，擷取後還原位置', async () => {
  let loaded = 2;
  const scroller = { scrollTop: 900, scrollHeight: 2000, clientHeight: 500 };
  // 第一個訊息節點的 parentElement 就是 scroller（會被 domCapture 改 scrollTop）
  const first = makeNode('m0', [], { parentElement: scroller });
  scroller.parentElement = null;
  const nodes = () => [first, ...Array.from({ length: loaded - 1 }, (_, i) => makeNode('m' + (i + 1)))];
  Object.defineProperty(scroller, 'scrollTop', {
    get() { return this._t ?? 900; },
    set(v) { this._t = v; if (v === 0 && loaded < 6) { loaded += 2; this.scrollHeight += 1000; } },
  });
  const result = await runCapture(null, {
    options: { loadAll: true },
    doc: { querySelectorAll: () => nodes(), scrollingElement: scroller, documentElement: {} },
    extraSandbox: { getComputedStyle: () => ({ overflowY: 'auto' }) },
  });
  assert.equal(result.messages.length, 6);
  assert.ok(result.debug.scrollRounds >= 3);
  // 原本離底部 2000-900-500=600，載入後 scrollHeight=4000 → 還原到 4000-500-600=2900
  assert.equal(scroller.scrollTop, 2900);
});
