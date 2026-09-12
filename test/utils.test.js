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
