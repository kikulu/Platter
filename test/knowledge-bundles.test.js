'use strict';

/**
 * test/knowledge-bundles.test.js
 *
 * 測試「分階段提示詞套餐」：
 *   1. lib/utils.js 的純函式 groupStepsByStage() / buildGroupFromDefault()
 *   2. extractors/default-knowledge-base.json 內建分階段套餐範本的資料完整性
 *   3. lib/stores.js 的內建套餐種子邏輯（全新安裝／從 1.26 升級補種／使用者刪除後
 *      不重複補種／舊資料補齊 stage 欄位）
 *
 * lib/stores.js 依賴 electron（經由 lib/dataDir.js、lib/broadcast.js），這裡在載入
 * 前用一個假的 electron 模組換掉，資料目錄指向暫存資料夾，這樣就能在一般 Node.js
 * 環境下直接跑真正的種子程式碼，不需要啟動 Electron。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const { groupStepsByStage, buildGroupFromDefault } = require('../lib/utils');

const DEFAULTS = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '..', 'extractors', 'default-knowledge-base.json'),
    'utf-8'
  )
);

// --- 載入 lib/stores.js（假 electron + 暫存資料目錄） ---------------------------

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'platter-bundles-'));
const fakeElectron = {
  app: { getPath: () => tmpUserData },
  BrowserWindow: { getAllWindows: () => [] },
};
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return fakeElectron;
  return originalLoad.call(this, request, ...rest);
};
const { loadKnowledgeBase } = require('../lib/stores');
Module._load = originalLoad;

const knowledgeFile = path.join(tmpUserData, 'knowledge-base.json');
const seededFile = path.join(tmpUserData, 'seeded-defaults.json');

function resetDataDir() {
  [knowledgeFile, seededFile].forEach((f) => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });
}
function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

test.after(() => {
  fs.rmSync(tmpUserData, { recursive: true, force: true });
});

// --- groupStepsByStage ---------------------------------------------------------

test('groupStepsByStage：完全沒有 stage 的步驟得到單一個 stage 為空字串的區段', () => {
  const runs = groupStepsByStage([{ id: 'a' }, { id: 'b', stage: '' }]);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].stage, '');
  assert.equal(runs[0].steps.length, 2);
});

test('groupStepsByStage：相鄰且 stage 相同的步驟合成一個區段，順序不變', () => {
  const runs = groupStepsByStage([
    { id: '1', stage: 'A' },
    { id: '2', stage: 'A' },
    { id: '3', stage: 'B' },
    { id: '4', stage: 'B' },
    { id: '5', stage: 'B' },
  ]);
  assert.deepEqual(
    runs.map((r) => [r.stage, r.steps.map((s) => s.id)]),
    [
      ['A', ['1', '2']],
      ['B', ['3', '4', '5']],
    ]
  );
});

test('groupStepsByStage：同名但不相鄰的階段是兩個獨立區段（順序永遠由 steps 決定）', () => {
  const runs = groupStepsByStage([
    { id: '1', stage: 'A' },
    { id: '2', stage: 'B' },
    { id: '3', stage: 'A' },
  ]);
  assert.deepEqual(
    runs.map((r) => r.stage),
    ['A', 'B', 'A']
  );
});

test('groupStepsByStage：非陣列輸入回傳空陣列，不會丟錯', () => {
  assert.deepEqual(groupStepsByStage(undefined), []);
  assert.deepEqual(groupStepsByStage(null), []);
});

// --- buildGroupFromDefault -----------------------------------------------------

const sampleDefault = {
  defaultId: 'g1',
  title: '範例套餐',
  description: '說明',
  tags: ['分階段範本'],
  stages: [
    { title: ' 階段 1 ', itemDefaultIds: ['a', 'b'] },
    { title: '階段 2', itemDefaultIds: ['c'] },
  ],
};

test('buildGroupFromDefault：依階段展開成扁平 steps，並帶上（去除頭尾空白的）階段名稱', () => {
  const map = new Map([
    ['a', 'kb_1'],
    ['b', 'kb_2'],
    ['c', 'kb_3'],
  ]);
  const g = buildGroupFromDefault(sampleDefault, map, '2026-01-01T00:00:00.000Z');
  assert.equal(g.defaultId, 'g1');
  assert.equal(g.title, '範例套餐');
  assert.deepEqual(
    g.steps.map((s) => [s.itemId, s.stage, s.checked]),
    [
      ['kb_1', '階段 1', false],
      ['kb_2', '階段 1', false],
      ['kb_3', '階段 2', false],
    ]
  );
  assert.equal(new Set(g.steps.map((s) => s.id)).size, 3, '每個步驟 id 不重複');
  assert.match(g.id, /^grp_/);
});

test('buildGroupFromDefault：找不到對應項目的步驟略過，其餘照常保留', () => {
  const map = new Map([['a', 'kb_1']]);
  const g = buildGroupFromDefault(sampleDefault, map, 'now');
  assert.deepEqual(
    g.steps.map((s) => s.itemId),
    ['kb_1']
  );
});

test('buildGroupFromDefault：所有步驟都對不上時回傳 null', () => {
  assert.equal(buildGroupFromDefault(sampleDefault, new Map(), 'now'), null);
});

// --- 內建範本資料完整性 --------------------------------------------------------

test('內建分階段套餐範本：defaultId 唯一、每組至少 2 個階段、引用的提示詞都存在', () => {
  const groups = DEFAULTS.groups;
  assert.ok(Array.isArray(groups) && groups.length > 0);
  const itemIds = new Set(DEFAULTS.items.map((it) => it.defaultId));
  assert.equal(new Set(groups.map((g) => g.defaultId)).size, groups.length);
  groups.forEach((g) => {
    assert.ok(g.defaultId && g.title && g.description, `${g.defaultId} 缺少必要欄位`);
    assert.ok(g.tags.includes('分階段範本'), `${g.title} 缺少「分階段範本」標籤`);
    assert.ok(g.stages.length >= 2, `${g.title} 至少要有 2 個階段`);
    g.stages.forEach((st) => {
      assert.ok(st.title, `${g.title} 有階段沒有名稱`);
      assert.ok(st.itemDefaultIds.length > 0, `${g.title}/${st.title} 是空階段`);
      st.itemDefaultIds.forEach((id) =>
        assert.ok(itemIds.has(id), `${g.title} 引用了不存在的提示詞 ${id}`)
      );
    });
  });
});

// --- lib/stores.js：種子與升級補種 --------------------------------------------

test('全新安裝：內建提示詞與分階段套餐一起種進去，且套餐步驟引用的 item id 都存在', () => {
  resetDataDir();
  const kb = loadKnowledgeBase();
  assert.equal(kb.items.length, DEFAULTS.items.length);
  assert.equal(kb.groups.length, DEFAULTS.groups.length);

  const itemIds = new Set(kb.items.map((it) => it.id));
  kb.groups.forEach((g) => {
    assert.ok(g.defaultId, '內建套餐要帶 defaultId');
    assert.ok(g.steps.length > 0);
    g.steps.forEach((s) => {
      assert.ok(itemIds.has(s.itemId), `${g.title} 有懸空引用`);
      assert.ok(s.stage, `${g.title} 的步驟都要帶階段名稱`);
      assert.equal(s.checked, false);
    });
    assert.ok(groupStepsByStage(g.steps).length >= 2);
  });

  const record = readJSON(seededFile);
  assert.equal(record.knowledgeGroups.length, DEFAULTS.groups.length);
  assert.equal(record.knowledgeBase.length, DEFAULTS.items.length);
});

test('從 1.26 升級（已有提示詞、沒有 knowledgeGroups 紀錄）：補進內建套餐，使用者自己的套餐不動', () => {
  resetDataDir();
  // 模擬 1.26 的資料：內建提示詞已經在，seeded-defaults.json 只有 knowledgeBase，
  // 使用者自己建了一份沒有 stage 欄位的套餐。
  const items = DEFAULTS.items.map((it, i) => ({
    id: `kb_old_${i}`,
    defaultId: it.defaultId,
    title: it.title,
    content: it.content || '',
    tags: it.tags || [],
    checklist: [],
    roleIds: [],
    systemPrompt: it.systemPrompt || '',
    userPrompt: it.userPrompt || '',
  }));
  const userGroup = {
    id: 'grp_user_1',
    title: '我自己的套餐',
    description: '',
    tags: [],
    steps: [{ id: 'step_u1', itemId: 'kb_old_0', checked: true }],
  };
  fs.writeFileSync(knowledgeFile, JSON.stringify({ items, groups: [userGroup] }));
  fs.writeFileSync(
    seededFile,
    JSON.stringify({ knowledgeBase: DEFAULTS.items.map((it) => it.defaultId) })
  );

  const kb = loadKnowledgeBase();
  assert.equal(kb.items.length, DEFAULTS.items.length, '提示詞不該重複補種');
  assert.equal(kb.groups.length, 1 + DEFAULTS.groups.length);

  // 使用者的套餐原樣保留（只多補一個空字串 stage 欄位），勾選狀態不變
  assert.equal(kb.groups[0].id, 'grp_user_1');
  assert.deepEqual(kb.groups[0].steps, [
    { id: 'step_u1', itemId: 'kb_old_0', checked: true, stage: '' },
  ]);

  // 內建套餐引用的是「使用者既有」的 item id，不是新產生的
  const builtIn = kb.groups.slice(1);
  builtIn.forEach((g) =>
    g.steps.forEach((s) => assert.ok(s.itemId.startsWith('kb_old_'), '應對照既有提示詞'))
  );

  // 補種結果有寫回磁碟，並記錄在 seeded-defaults.json
  assert.equal(readJSON(knowledgeFile).groups.length, 1 + DEFAULTS.groups.length);
  assert.equal(readJSON(seededFile).knowledgeGroups.length, DEFAULTS.groups.length);
});

test('補種過一次之後：再次載入不重複補、使用者刪掉的內建套餐也不會被補回來', () => {
  resetDataDir();
  loadKnowledgeBase(); // 全新安裝，種入全部
  const kb1 = readJSON(knowledgeFile);
  const removed = kb1.groups.pop(); // 使用者刪掉一份內建套餐
  fs.writeFileSync(knowledgeFile, JSON.stringify(kb1));

  const kb2 = loadKnowledgeBase();
  assert.equal(kb2.groups.length, DEFAULTS.groups.length - 1);
  assert.ok(!kb2.groups.some((g) => g.defaultId === removed.defaultId));

  // 再載入一次，數量依然不變
  assert.equal(loadKnowledgeBase().groups.length, DEFAULTS.groups.length - 1);
});

test('升級補種時，使用者已刪除的內建提示詞對應的步驟略過，其餘步驟保留', () => {
  resetDataDir();
  const target = DEFAULTS.groups[0];
  const removedDefaultId = target.stages[0].itemDefaultIds[0];
  const items = DEFAULTS.items
    .filter((it) => it.defaultId !== removedDefaultId)
    .map((it, i) => ({
      id: `kb_old_${i}`,
      defaultId: it.defaultId,
      title: it.title,
      content: it.content || '',
      tags: [],
      checklist: [],
      roleIds: [],
      systemPrompt: '',
      userPrompt: '',
    }));
  fs.writeFileSync(knowledgeFile, JSON.stringify({ items, groups: [] }));
  fs.writeFileSync(
    seededFile,
    JSON.stringify({ knowledgeBase: DEFAULTS.items.map((it) => it.defaultId) })
  );

  const kb = loadKnowledgeBase();
  const seeded = kb.groups.find((g) => g.defaultId === target.defaultId);
  const expectedSteps =
    target.stages.reduce((n, st) => n + st.itemDefaultIds.length, 0) - 1;
  assert.equal(seeded.steps.length, expectedSteps);
});

test('舊資料：套餐沒有 steps 或步驟沒有 stage 欄位時，載入會補齊預設值', () => {
  resetDataDir();
  fs.writeFileSync(
    knowledgeFile,
    JSON.stringify({
      items: [{ id: 'kb_1', title: 't', content: 'c' }],
      groups: [
        { id: 'g_a', title: 'A' },
        { id: 'g_b', title: 'B', steps: [{ id: 's1', itemId: 'kb_1', checked: false }] },
      ],
    })
  );
  // 內容用非內建的 defaultId 都對不上，只驗證正規化
  const kb = loadKnowledgeBase();
  const a = kb.groups.find((g) => g.id === 'g_a');
  const b = kb.groups.find((g) => g.id === 'g_b');
  assert.deepEqual(a.steps, []);
  assert.equal(b.steps[0].stage, '');
});
