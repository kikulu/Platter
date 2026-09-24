'use strict';

/**
 * test/knowledge-bundles-ipc.test.js
 *
 * 測試套餐（分階段提示詞組合）在 IPC 層的行為：儲存時保留／清理 stage、Markdown 匯出
 * 依階段分段、JSON 匯入保留 stage、跨模組搜尋能比對階段名稱。
 *
 * 跟 test/knowledge-bundles.test.js 一樣，用假的 electron 模組（ipcMain 只負責把
 * handler 收集起來、dialog 回傳預先指定的檔案路徑）在一般 Node.js 環境下直接呼叫
 * 真正的 handler，資料目錄指向暫存資料夾。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'platter-bundles-ipc-'));
const dialogState = { savePath: null, openPaths: [] };
const fakeElectron = {
  app: { getPath: () => tmpUserData },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {
    showSaveDialog: async () => ({ canceled: false, filePath: dialogState.savePath }),
    showOpenDialog: async () => ({ canceled: false, filePaths: dialogState.openPaths }),
  },
};
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return fakeElectron;
  return originalLoad.call(this, request, ...rest);
};
const { registerKnowledgeIpc } = require('../lib/ipc/knowledge');
const { searchGlobal } = require('../lib/ipc/search');
const { loadKnowledgeBase } = require('../lib/stores');
Module._load = originalLoad;

const handlers = new Map();
registerKnowledgeIpc({ handle: (channel, fn) => handlers.set(channel, fn) });
const invoke = (channel, arg) => handlers.get(channel)({}, arg);

const knowledgeFile = path.join(tmpUserData, 'knowledge-base.json');
const seededFile = path.join(tmpUserData, 'seeded-defaults.json');

// 每個測試都從「空的知識庫」開始，避免被內建範本干擾數量判斷
function resetToEmptyKnowledgeBase(data) {
  fs.writeFileSync(knowledgeFile, JSON.stringify(data || { items: [], groups: [] }));
  // 標記內建範本都已種過，這樣 loadKnowledgeBase() 不會又把內建範本補進來
  const defaults = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '..', 'extractors', 'default-knowledge-base.json'),
      'utf-8'
    )
  );
  fs.writeFileSync(
    seededFile,
    JSON.stringify({
      knowledgeBase: defaults.items.map((it) => it.defaultId),
      knowledgeGroups: defaults.groups.map((g) => g.defaultId),
    })
  );
}

function makeItems() {
  return ['A', 'B', 'C'].map((t) => ({
    id: `kb_${t}`,
    title: `提示詞${t}`,
    content: `內容${t}`,
    tags: [],
    checklist: [],
    roleIds: [],
    systemPrompt: '',
    userPrompt: '',
  }));
}

test.after(() => {
  fs.rmSync(tmpUserData, { recursive: true, force: true });
});

test('knowledge:group:save：儲存時保留階段名稱（去頭尾空白），沒有 stage 的步驟存成空字串', async () => {
  resetToEmptyKnowledgeBase({ items: makeItems(), groups: [] });
  const kb = await invoke('knowledge:group:save', {
    title: '分階段套餐',
    steps: [
      { id: 's1', itemId: 'kb_A', checked: false, stage: '  階段 1：規劃 ' },
      { id: 's2', itemId: 'kb_B', checked: true, stage: '階段 2：執行' },
      { id: 's3', itemId: 'kb_C', checked: false },
    ],
  });
  const g = kb.groups[0];
  assert.deepEqual(
    g.steps.map((s) => [s.id, s.stage, s.checked]),
    [
      ['s1', '階段 1：規劃', false],
      ['s2', '階段 2：執行', true],
      ['s3', '', false],
    ]
  );
  // 有寫回磁碟
  assert.equal(
    JSON.parse(fs.readFileSync(knowledgeFile, 'utf-8')).groups[0].steps[0].stage,
    '階段 1：規劃'
  );
});

test('knowledge:group:save：更新既有套餐時保留來源 defaultId，並可改掉階段名稱', async () => {
  resetToEmptyKnowledgeBase({
    items: makeItems(),
    groups: [
      {
        id: 'grp_1',
        defaultId: 'kb-group-default-001',
        title: '內建套餐',
        description: '',
        tags: [],
        steps: [{ id: 's1', itemId: 'kb_A', checked: false, stage: '舊階段' }],
      },
    ],
  });
  // 渲染端送出的套餐物件不帶 defaultId
  const kb = await invoke('knowledge:group:save', {
    id: 'grp_1',
    title: '內建套餐（已改）',
    tags: [],
    description: '',
    steps: [{ id: 's1', itemId: 'kb_A', checked: false, stage: '新階段' }],
  });
  assert.equal(kb.groups[0].defaultId, 'kb-group-default-001');
  assert.equal(kb.groups[0].steps[0].stage, '新階段');
});

test('knowledge:exportAll（Markdown）：分階段套餐依階段分段、編號跨階段連續；沒分階段的維持純條列', async () => {
  resetToEmptyKnowledgeBase({
    items: makeItems(),
    groups: [
      {
        id: 'g1',
        title: '有階段',
        description: '說明',
        tags: ['分階段範本'],
        steps: [
          { id: 's1', itemId: 'kb_A', checked: true, stage: '階段 1' },
          { id: 's2', itemId: 'kb_B', checked: false, stage: '階段 1' },
          { id: 's3', itemId: 'kb_C', checked: false, stage: '階段 2' },
        ],
      },
      {
        id: 'g2',
        title: '沒階段',
        description: '',
        tags: [],
        steps: [{ id: 's4', itemId: 'kb_A', checked: false, stage: '' }],
      },
    ],
  });
  dialogState.savePath = path.join(tmpUserData, 'export.md');
  const result = await invoke('knowledge:exportAll', 'md');
  assert.equal(result.ok, true);
  const md = fs.readFileSync(dialogState.savePath, 'utf-8');

  const staged = md.slice(
    md.indexOf('## 📦 套餐：有階段'),
    md.indexOf('## 📦 套餐：沒階段')
  );
  assert.ok(staged.includes('### 階段 1\n\n1. [x] 提示詞A\n2. [ ] 提示詞B'));
  assert.ok(staged.includes('### 階段 2\n\n3. [ ] 提示詞C'));

  const plain = md.slice(md.indexOf('## 📦 套餐：沒階段'));
  assert.ok(plain.includes('1. [ ] 提示詞A'));
  assert.ok(!plain.includes('###'), '沒有分階段的套餐不該出現階段標題');
});

test('knowledge:import：匯入含階段的 JSON 時保留 stage，步驟引用轉成新 item id', async () => {
  resetToEmptyKnowledgeBase();
  const importFile = path.join(tmpUserData, 'import.json');
  fs.writeFileSync(
    importFile,
    JSON.stringify({
      items: [
        { id: 'old_1', title: '甲', content: 'x' },
        { id: 'old_2', title: '乙', content: 'y' },
      ],
      groups: [
        {
          title: '匯入的套餐',
          steps: [
            { itemId: 'old_1', stage: '階段 1' },
            { itemId: 'old_2', stage: ' 階段 2 ' },
            { itemId: 'old_2' },
            { itemId: 'not_exist', stage: '階段 2' },
          ],
        },
      ],
    })
  );
  dialogState.openPaths = [importFile];
  const kb = await invoke('knowledge:import');
  assert.equal(kb.groups.length, 1);
  const steps = kb.groups[0].steps;
  assert.deepEqual(
    steps.map((s) => s.stage),
    ['階段 1', '階段 2', '']
  );
  const ids = new Set(kb.items.map((i) => i.id));
  steps.forEach((s) => assert.ok(ids.has(s.itemId)));
  assert.ok(!ids.has('old_1'), '匯入的項目要重新產生 id');
});

test('searchGlobal：搜尋能比對到套餐的階段名稱', () => {
  resetToEmptyKnowledgeBase({
    items: makeItems(),
    groups: [
      {
        id: 'g1',
        title: '論文套餐',
        description: '',
        tags: [],
        steps: [
          { id: 's1', itemId: 'kb_A', checked: false, stage: '階段 3：潤色與投稿' },
        ],
      },
    ],
  });
  loadKnowledgeBase(); // 確認資料可正常載入
  const hits = searchGlobal('潤色與投稿').filter((r) => r.kind === 'knowledge-group');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'g1');
});
