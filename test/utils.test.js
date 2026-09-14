'use strict';

/**
 * test/utils.test.js
 *
 * 對 lib/utils.js 的純函式做單元測試。使用 Node.js 內建的 `node:test` +
 * `node:assert`（Node 18+ 自帶，不需要額外安裝測試框架），對應
 * `package.json` 的 `npm test`（`node --test test/`）。
 *
 * 這些函式刻意抽出 main.js、不依賴 Electron runtime，所以可以直接在
 * 一般 Node.js 環境下測試，不需要啟動 Electron。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  genId,
  ensureUniqueFilePath,
  toMarkdown,
  escapeCssIdentifier,
  deriveSelectorFromSamples,
  markdownToHtml,
} = require('../lib/utils');

test('genId() 產生非空字串，且連續呼叫兩次不會撞號', () => {
  const a = genId();
  const b = genId();
  assert.equal(typeof a, 'string');
  assert.ok(a.length > 0);
  assert.notEqual(a, b);
});

test('genId(prefix) 會用指定的前綴', () => {
  const id = genId('role');
  assert.match(id, /^role_/);
});

test('ensureUniqueFilePath：檔名不衝突時直接回傳 name.ext', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'platter-test-'));
  try {
    const result = ensureUniqueFilePath(dir, 'conversation', 'md');
    assert.equal(result, path.join(dir, 'conversation.md'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ensureUniqueFilePath：檔名衝突時依序試 (2)、(3)...', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'platter-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'conversation.md'), 'x');
    fs.writeFileSync(path.join(dir, 'conversation (2).md'), 'x');
    const result = ensureUniqueFilePath(dir, 'conversation', 'md');
    assert.equal(result, path.join(dir, 'conversation (3).md'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('toMarkdown：沒有標題時使用預設標題「對話紀錄」', () => {
  const md = toMarkdown({ messages: [] });
  assert.match(md, /^# 對話紀錄/);
});

test('toMarkdown：使用者與 AI 訊息分別對應正確的標題 emoji', () => {
  const md = toMarkdown({
    title: '測試對話',
    messages: [
      { role: 'user', text: '你好' },
      { role: 'assistant', text: '你好，有什麼可以幫忙的？' },
    ],
  });
  assert.match(md, /^# 測試對話/);
  assert.match(md, /### 🧑 使用者[\s\S]*你好/);
  assert.match(md, /### 🤖 AI[\s\S]*你好，有什麼可以幫忙的？/);
});

test('escapeCssIdentifier：跳脫特殊字元，不依賴瀏覽器的 CSS.escape', () => {
  assert.equal(escapeCssIdentifier('foo:bar'), 'foo\\:bar');
  assert.equal(escapeCssIdentifier('foo.bar'), 'foo\\.bar');
  assert.equal(escapeCssIdentifier('safe-name_1'), 'safe-name_1');
});

test('deriveSelectorFromSamples：兩個樣本都有 data-message-author-role 時，用該屬性當 turn selector', () => {
  const userSample = { attrs: { 'data-message-author-role': 'user' } };
  const aiSample = { attrs: { 'data-message-author-role': 'assistant' } };
  const { turn, userHint } = deriveSelectorFromSamples(userSample, aiSample);
  assert.equal(turn, '[data-message-author-role]');
  assert.equal(userHint, 'user');
});

test('deriveSelectorFromSamples：用 id 當樣本不會丟出 ReferenceError（回歸測試：CSS.escape 修正）', () => {
  const userSample = { id: 'msg-1', className: 'msg msg-user' };
  const aiSample = { id: 'msg-2', className: 'msg msg-ai' };
  assert.doesNotThrow(() => deriveSelectorFromSamples(userSample, aiSample));
  const { turn } = deriveSelectorFromSamples(userSample, aiSample);
  assert.equal(turn, '#msg-1, #msg-2');
});

test('deriveSelectorFromSamples：沒有 data-message-author-role 時，比對 class list 找出使用者專屬的 class', () => {
  const userSample = { className: 'msg msg-user shared' };
  const aiSample = { className: 'msg msg-ai shared' };
  const { turn, userHint } = deriveSelectorFromSamples(userSample, aiSample);
  assert.equal(turn, '.msg');
  assert.equal(userHint, 'msg-user');
});

test('deriveSelectorFromSamples：兩個樣本 selector 相同時，turn 不重複用逗號連接', () => {
  const userSample = { className: 'msg shared' };
  const aiSample = { className: 'msg shared' };
  const { turn } = deriveSelectorFromSamples(userSample, aiSample);
  assert.equal(turn, '.msg');
});

test('deriveSelectorFromSamples：完全沒有可用資訊時，userHint 回傳空字串而不是丟錯', () => {
  const userSample = { className: 'shared' };
  const aiSample = { className: 'shared' };
  const { userHint } = deriveSelectorFromSamples(userSample, aiSample);
  assert.equal(userHint, '');
});

test('markdownToHtml：標題、粗體、斜體、行內程式碼', () => {
  const html = markdownToHtml('# 標題\n\n**粗體** *斜體* `code`');
  assert.equal(
    html,
    '<h1>標題</h1>\n<p><strong>粗體</strong> <em>斜體</em> <code>code</code></p>'
  );
});

test('markdownToHtml：fenced code block 保留原始內容、不解析裡面的語法', () => {
  const html = markdownToHtml('```js\nconst a = 1;\n**not bold**\n```');
  assert.equal(html, '<pre><code>const a = 1;\n**not bold**</code></pre>');
});

test('markdownToHtml：無序清單跟有序清單各自包在 ul/ol 裡', () => {
  const html = markdownToHtml('- a\n- b\n\n1. one\n2. two');
  assert.equal(
    html,
    '<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n<ol>\n<li>one</li>\n<li>two</li>\n</ol>'
  );
});

test('markdownToHtml：引言、分隔線、連結', () => {
  const html = markdownToHtml('> 引言文字\n\n---\n\n[連結](https://example.com)');
  assert.equal(
    html,
    '<blockquote><p>引言文字</p></blockquote>\n<hr>\n<p><a href="https://example.com">連結</a></p>'
  );
});

test('markdownToHtml：安全性——來源文字裡的 <script> 會被跳脫成純文字，不會變成真的標籤', () => {
  const html = markdownToHtml('<script>alert(1)</script>');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('markdownToHtml：安全性——javascript: 連結會被擋掉換成 #', () => {
  const html = markdownToHtml('[click me](javascript:alert(1))');
  assert.ok(html.includes('href="#"'));
  assert.ok(!html.includes('javascript:'));
});

test('markdownToHtml：安全性——data: 連結也會被擋掉', () => {
  const html = markdownToHtml('![x](data:text/html;base64,PHNjcmlwdD4=)');
  assert.ok(html.includes('src="#"'));
});

test('markdownToHtml：相對路徑連結（沒有 scheme）原樣保留', () => {
  const html = markdownToHtml('[説明](./readme.md)');
  assert.ok(html.includes('href="./readme.md"'));
});

test('markdownToHtml：空字串輸入不會丟錯，回傳空字串', () => {
  assert.equal(markdownToHtml(''), '');
  assert.equal(markdownToHtml(undefined), '');
});
