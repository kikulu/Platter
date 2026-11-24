'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PLATFORM_URLS } = require('../lib/constants');

const root = path.join(__dirname, '..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf-8'));

test('Copilot：固定網址、預設選擇器、備用選擇器都存在', () => {
  assert.equal(PLATFORM_URLS.copilot, 'https://copilot.microsoft.com');
  const sel = readJson('extractors/default-selectors.json');
  assert.ok(sel.copilot && sel.copilot.turn && sel.copilot.userHint);
  const fb = readJson('extractors/capture-fallbacks.json');
  assert.ok(Array.isArray(fb.copilot) && fb.copilot.length >= 1);
  fb.copilot.forEach((c) => assert.ok(c.turn && typeof c.turn === 'string'));
});

test('NotebookLM：固定網址、預設選擇器、備用選擇器、雜訊過濾都存在', () => {
  assert.equal(PLATFORM_URLS.notebooklm, 'https://notebooklm.google.com');
  const sel = readJson('extractors/default-selectors.json');
  assert.ok(sel.notebooklm && sel.notebooklm.turn && sel.notebooklm.userHint);
  assert.match(sel.notebooklm.turn, /\.to-user-container/);
  const fb = readJson('extractors/capture-fallbacks.json');
  assert.ok(Array.isArray(fb.notebooklm) && fb.notebooklm.length >= 1);
  fb.notebooklm.forEach((c) => assert.ok(c.turn && typeof c.turn === 'string'));
  const capture = fs.readFileSync(path.join(root, 'extractors/domCapture.js'), 'utf-8');
  assert.match(capture, /NotebookLM can be inaccurate/);
});

test('NotebookLM 在各視窗的平台標籤都有對應', () => {
  ['renderer.js', 'conversation.js', 'documents.js', 'team.js'].forEach((f) => {
    const src = fs.readFileSync(path.join(root, 'renderer', f), 'utf-8');
    assert.ok(src.includes("notebooklm: 'NotebookLM'"), `${f} 缺 NotebookLM 標籤`);
  });
});

test('每個平台都有預設選擇器，且帳號新增／選擇器設定的 UI 都列出它', () => {
  const sel = readJson('extractors/default-selectors.json');
  const accountHtml = fs.readFileSync(path.join(root, 'renderer/account.html'), 'utf-8');
  const settingsHtml = fs.readFileSync(path.join(root, 'renderer/settings.html'), 'utf-8');
  Object.keys(PLATFORM_URLS).forEach((p) => {
    assert.ok(sel[p], `default-selectors 缺 ${p}`);
    assert.ok(accountHtml.includes(`value="${p}"`), `account.html 缺 ${p}`);
    assert.ok(settingsHtml.includes(`data-platform="${p}"`), `settings.html 缺 ${p}`);
  });
});

test('Download all／Outputs 面板邏輯只對 Claude 執行', () => {
  const src = fs.readFileSync(path.join(root, 'lib/conversationCapture.js'), 'utf-8');
  assert.match(src, /const isClaude = entry\.platform === 'claude'/);
  assert.match(src, /if \(isClaude && triggers\.length > 0\)/);
  assert.match(src, /if \(isClaude && missed\.length > 0\)/);
});
