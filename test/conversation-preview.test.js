'use strict';

/**
 * test/conversation-preview.test.js
 *
 * 功能 A：對話擷取預覽與重複儲存提示。
 *   - lib/utils.js 的正規化、雜湊、預覽摘要、重複偵測（含舊資料沒有 contentHash）
 *   - IPC：conversations:checkDuplicate／save 會寫入 contentHash／captureCurrent 的預覽欄位
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const {
  normalizeConversationText,
  hashConversationContent,
  buildConversationPreview,
  findDuplicateConversation,
} = require('../lib/utils');

test('hashConversationContent：只差空白與換行的內容雜湊相同，內容不同則不同', () => {
  const a = hashConversationContent('# 標題\r\n\r\n### 🧑 使用者\n\n你好  世界\n');
  const b = hashConversationContent('# 標題\n### 🧑 使用者\n你好 世界');
  const c = hashConversationContent('# 標題\n### 🧑 使用者\n你好 宇宙');
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(hashConversationContent('   \n  '), '');
  assert.equal(normalizeConversationText(null), '');
});

test('buildConversationPreview：則數、前 N 則摘要、重複訊息計數', () => {
  const long = 'x'.repeat(200);
  const messages = [
    { role: 'user', text: '問題一' },
    { role: 'assistant', text: long },
    { role: 'user', text: '問題一' }, // 與第 1 則同角色同文字 → 重複
    { role: 'assistant', text: '回答  二' },
    { role: 'user', text: '問題三' },
    { role: 'assistant', text: '回答四' },
  ];
  const p = buildConversationPreview(messages);
  assert.equal(p.total, 6);
  assert.equal(p.userCount, 3);
  assert.equal(p.assistantCount, 3);
  assert.equal(p.repeatedCount, 1);
  assert.equal(p.snippets.length, 5);
  assert.equal(p.snippets[1].text.length, 81); // 80 字 + 省略號
  assert.ok(p.snippets[1].text.endsWith('…'));
  assert.equal(p.snippets[3].text, '回答 二');

  const empty = buildConversationPreview(undefined);
  assert.deepEqual(empty, {
    total: 0,
    userCount: 0,
    assistantCount: 0,
    repeatedCount: 0,
    snippets: [],
  });
});

test('findDuplicateConversation：排除自己、舊資料沒有 contentHash 也能比對', () => {
  const content = '# A\n\n### 🧑 使用者\n\nhi';
  const hash = hashConversationContent(content);
  const list = [
    { id: 'old', title: '舊的', content }, // 舊資料：沒有 contentHash
    { id: 'new', title: '新的', content: 'other', contentHash: hashConversationContent('other') },
  ];
  assert.equal(findDuplicateConversation(list, hash, null).id, 'old');
  assert.equal(findDuplicateConversation(list, hash, 'old'), null);
  assert.equal(findDuplicateConversation(list, '', null), null);
  assert.equal(findDuplicateConversation(undefined, hash, null), null);
});

// ----- IPC -----
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'platter-conv-preview-'));
const fakeElectron = {
  app: { getPath: () => tmpUserData },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {},
  shell: {},
  Notification: class {
    static isSupported() {
      return false;
    }
  },
};
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return fakeElectron;
  return originalLoad.call(this, request, ...rest);
};
const { registerConversationsIpc } = require('../lib/ipc/conversations');
Module._load = originalLoad;

const handlers = new Map();
registerConversationsIpc({ handle: (channel, fn) => handlers.set(channel, fn) });
const invoke = (channel, arg) => handlers.get(channel)({}, arg);

test('conversations:save 會寫入 contentHash；checkDuplicate 偵測重複並可排除自己', async () => {
  const content = '# 對話\n\n### 🧑 使用者\n\n哈囉';
  const after = await invoke('conversations:save', { title: 'T1', content, tags: [] });
  assert.equal(after.length, 1);
  assert.equal(after[0].contentHash, hashConversationContent(content));

  const dup = await invoke('conversations:checkDuplicate', { content: `${content}\n\n` });
  assert.equal(dup.duplicate.id, after[0].id);
  assert.equal(dup.duplicate.title, 'T1');

  const self = await invoke('conversations:checkDuplicate', {
    content,
    excludeId: after[0].id,
  });
  assert.equal(self.duplicate, null);

  const none = await invoke('conversations:checkDuplicate', { content: '完全不同' });
  assert.equal(none.duplicate, null);
  const emptyCheck = await invoke('conversations:checkDuplicate', {});
  assert.equal(emptyCheck.duplicate, null);

  // 編輯既有對話：雜湊跟著新內容更新
  const edited = await invoke('conversations:save', {
    id: after[0].id,
    title: 'T1',
    content: '改過了',
    tags: [],
  });
  assert.equal(edited[0].contentHash, hashConversationContent('改過了'));
});
