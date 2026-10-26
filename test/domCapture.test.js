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

// ---- 1.51.0：自我修復（備用選擇器、放寬外殼排除、has: 提示、Gemini .query-text） ----

function userNode(text, extra = {}) {
  return makeNode(text, [], { getAttribute: (n) => (n === 'data-who' ? 'user' : null), ...extra });
}

test('設定的選擇器只抓到使用者訊息時，改用備用選擇器取得 AI 回覆', async () => {
  const u1 = userNode('問題一');
  const u2 = userNode('問題二');
  const a1 = makeNode('回答一');
  const a2 = makeNode('回答二');
  const byTurn = {
    '.u': [u1, u2],
    '.u, .a': [u1, a1, u2, a2],
  };
  const result = await runCapture([], {
    cfg: { turn: '.u', userHint: 'data-who=user', fallbacks: [{ turn: '.u, .a', userHint: 'data-who=user' }] },
    doc: { querySelectorAll: (sel) => byTurn[sel] || [] },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert.equal(result.debug.selectorUsed, '.u, .a');
  assert.ok(result.debug.candidatesTried.length >= 2);
});

test('useFallbacks:false 時不試備用選擇器', async () => {
  const u1 = userNode('問題一');
  const a1 = makeNode('回答一');
  const result = await runCapture([], {
    cfg: { turn: '.u', userHint: 'data-who=user', fallbacks: [{ turn: '.u, .a', userHint: 'data-who=user' }] },
    options: { loadAll: false, useFallbacks: false },
    doc: { querySelectorAll: (sel) => (sel === '.u' ? [u1] : sel === '.u, .a' ? [u1, a1] : []) },
  });
  assert.equal(result.messages.length, 1);
});

test('訊息包在 header／footer 內時不再被當成頁面外殼排除', async () => {
  const msg = makeNode('包在 header 裡的訊息', [], {
    closest: (sel) => (/header|footer/.test(sel) && !/button/.test(sel) ? makeNode("") : null),
  });
  const result = await runCapture([msg]);
  assert.equal(result.ok, true);
  assert.equal(result.messages.length, 1);
});

test('排除外殼後一個都不剩時，退回不排除', async () => {
  const shell = makeNode('只有外殼裡的文字');
  const nav = makeNode('', [shell]);
  shell.closest = (sel) => (/nav/.test(sel) ? nav : null);
  const result = await runCapture([shell]);
  assert.equal(result.ok, true);
  assert.equal(result.messages.length, 1);
});

test('userHint 的 has:<selector>：內含符合子元素的節點判為使用者訊息', async () => {
  const inner = makeNode('裡面的使用者標記');
  const userTurn = makeNode('使用者說的話', [], {
    querySelector: (sel) => (sel === '[data-role="u"]' ? inner : null),
  });
  const aiTurn = makeNode('AI 說的話', [], { querySelector: () => null });
  const result = await runCapture([userTurn, aiTurn], {
    cfg: { turn: '.t', userHint: 'has:[data-role="u"]' },
  });
  assert.deepEqual(result.messages.map((m) => m.role), ['user', 'assistant']);
});

test('Gemini：user-query 優先讀 .query-text，不帶隱藏的 You said 前綴', async () => {
  const line = makeNode('真正的問題');
  const q = makeNode('You said 真正的問題', [], {
    tagName: 'USER-QUERY',
    querySelector: (sel) => (sel === '.query-text' ? line : null),
  });
  const a = makeNode('Gemini 的回答');
  const result = await runCapture([q, a], {
    cfg: { turn: 'user-query, model-response', userHint: 'user-query' },
  });
  assert.equal(result.messages[0].text, '真正的問題');
  assert.equal(result.messages[0].role, 'user');
});

test('capture-fallbacks.json 格式正確：每個平台都有 turn 與 userHint', () => {
  const data = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'extractors', 'capture-fallbacks.json'), 'utf-8')
  );
  for (const key of ['claude', 'chatgpt', 'gemini', 'generic']) {
    assert.ok(Array.isArray(data[key]) && data[key].length > 0, key);
    for (const c of data[key]) {
      assert.equal(typeof c.turn, 'string');
      assert.ok(c.turn.trim());
      assert.equal(typeof c.userHint, 'string');
    }
  }
});

test('domDiagnose.js 可載入並匯出 diagnosePage', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'extractors', 'domDiagnose.js'), 'utf-8');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  assert.equal(vm.runInContext('typeof diagnosePage', sandbox), 'function');
});

// ---- 1.51.1 ----

test('innerText 為空（視圖未渲染）時改讀 textContent，不會整頁 EMPTY_RESULT', async () => {
  const hidden = makeNode('', [], { textContent: '隱藏視圖裡的訊息' });
  const result = await runCapture([hidden]);
  assert.equal(result.ok, true);
  assert.equal(result.messages[0].text, '隱藏視圖裡的訊息');
});

test('去掉 Grok／Gemini 的角色標籤與運作時間前綴', async () => {
  const u = makeNode('您\n分析');
  const a = makeNode('Grok\n運作了5s\n\n以下是分析結果');
  const g = makeNode('你說了 替簡報寫備忘稿');
  const result = await runCapture([u, a, g], { cfg: { turn: 'x', userHint: '' } });
  assert.deepEqual(result.messages.map((m) => m.text), ['分析', '以下是分析結果', '替簡報寫備忘稿']);
});

test('相鄰同角色且只差短前綴的重複訊息只留乾淨那則', async () => {
  const withPrefix = makeNode('Gemini 說明 問題內容');
  const clean = makeNode('問題內容');
  const result = await runCapture([withPrefix, clean]);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].text, '問題內容');
});

test('按鈕／表單／輸入框裡的節點不算訊息', async () => {
  const btn = makeNode('Share', [], { closest: (sel) => (/button/.test(sel) ? makeNode('') : null) });
  const real = makeNode('真正的訊息');
  const result = await runCapture([btn, real]);
  assert.deepEqual(result.messages.map((m) => m.text), ['真正的訊息']);
});

// ---- 1.51.2 ----

test('備用選擇器抓到明顯更多文字（≥1.3 倍）時，即使設定的選擇器兩種角色都有也改用它', async () => {
  const u1 = userNode('問題');
  const step = makeNode('Ran 3 commands');
  const prose = makeNode('這是 AI 真正的回覆正文，內容比較長，比步驟標題多很多字。');
  const byTurn = {
    '.u, .step': [u1, step],
    '.u, .prose': [u1, prose],
  };
  const result = await runCapture([], {
    cfg: { turn: '.u, .step', userHint: 'data-who=user', fallbacks: [{ turn: '.u, .prose', userHint: 'data-who=user' }] },
    doc: { querySelectorAll: (sel) => byTurn[sel] || [] },
  });
  assert.equal(result.debug.selectorUsed, '.u, .prose');
  assert.match(result.messages[1].text, /真正的回覆正文/);
});

test('文字差不多時沿用設定的選擇器（不亂換）', async () => {
  const u1 = userNode('問題');
  const a1 = makeNode('回答甲乙丙');
  const a2 = makeNode('回答甲乙丙丁');
  const byTurn = { '.u, .a': [u1, a1], '.u, .b': [u1, a2] };
  const result = await runCapture([], {
    cfg: { turn: '.u, .a', userHint: 'data-who=user', fallbacks: [{ turn: '.u, .b', userHint: 'data-who=user' }] },
    doc: { querySelectorAll: (sel) => byTurn[sel] || [] },
  });
  assert.equal(result.debug.selectorUsed, '.u, .a');
});

test('零寬字元與「9 minutes ago」「Claude is AI and can make mistakes」這類雜訊不算訊息', async () => {
  const result = await runCapture([
    makeNode('​​'),
    makeNode('9 minutes ago'),
    makeNode('Claude is AI and can make mistakes. Please double-check responses.'),
    makeNode('真正的內容'),
  ]);
  assert.deepEqual(result.messages.map((m) => m.text), ['真正的內容']);
});

test('擷取結果帶 pageProbe，EMPTY_RESULT 時可判斷頁面狀況', async () => {
  const result = await runCapture([]);
  assert.equal(result.error, 'EMPTY_RESULT');
  assert.ok(result.debug.pageProbe && 'bodyTextLength' in result.debug.pageProbe);
});

// ---- 1.51.5：ChatGPT 新版 DOM（沒有 data-message-author-role／article／conversation-turn，改用 class） ----

test('ChatGPT 新版：用 group/user-message 與 MarkdownRoot 備用候選抓到使用者與 AI', async () => {
  const user = makeNode('請幫我整理重點', [], { classList: { contains: (c) => c === 'group/user-message' } });
  const ai = makeNode('以下是重點整理：第一點、第二點。');
  const fb = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'extractors', 'capture-fallbacks.json'), 'utf-8')
  ).chatgpt[0];
  const result = await runCapture([], {
    cfg: { turn: '[data-message-author-role]', userHint: 'user', fallbacks: [fb] },
    doc: { querySelectorAll: (sel) => (sel === fb.turn ? [user, ai] : []) },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.messages.map((m) => m.role), ['user', 'assistant']);
  assert.equal(result.debug.selectorUsed, fb.turn);
});

test('ChatGPT 新版：group/user-message 的最內層節點沒有文字時，改用 text-user-message 候選', async () => {
  const fbs = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'extractors', 'capture-fallbacks.json'), 'utf-8')
  ).chatgpt;
  const [a, b] = fbs;
  const emptyInner = makeNode('', [], { classList: { contains: (c) => c === 'group/user-message' } });
  const text = makeNode('使用者的問題', [], { classList: { contains: (c) => c === 'text-user-message' } });
  const ai = makeNode('AI 的回答內容');
  const byTurn = { [a.turn]: [emptyInner, ai], [b.turn]: [text, ai] };
  const result = await runCapture([], {
    cfg: { turn: '[data-message-author-role]', userHint: 'user', fallbacks: fbs },
    doc: { querySelectorAll: (sel) => byTurn[sel] || [] },
  });
  assert.deepEqual(result.messages.map((m) => m.role), ['user', 'assistant']);
  assert.equal(result.debug.selectorUsed, b.turn);
});
