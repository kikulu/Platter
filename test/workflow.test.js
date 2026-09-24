'use strict';

/**
 * test/workflow.test.js — 專案階段流程（lib/workflow.js）純函式，
 * 以及內建專案範本（extractors/default-project-templates.json）的資料完整性。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  buildWorkflowFromTemplate,
  composeStepPrompt,
  nextCurrentStepId,
  syncStepStatusFromTasks,
  templateFromWorkflow,
  summarizeTemplate,
  normalizeWorkflow,
  stepNumbers,
} = require('../lib/workflow');

const readJSON = (rel) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf-8'));
const TEMPLATES = readJSON('extractors/default-project-templates.json').templates;
const KB = readJSON('extractors/default-knowledge-base.json');

// 只用內建檔的 resolver（跟 lib/stores.js 的 makeKnowledgePromptResolver 在使用者沒改過時等價）
const kbById = new Map(KB.items.map((it) => [it.defaultId, it]));
const resolveItem = (defaultId) => {
  const it = kbById.get(defaultId);
  if (!it) return null;
  return {
    title: it.title,
    prompt: it.content || [it.systemPrompt, it.userPrompt].filter(Boolean).join('\n\n'),
  };
};

const sampleTemplate = {
  id: 'tpl_x',
  name: '範例',
  stages: [
    {
      title: '階段 1',
      steps: [
        { title: '甲', prompt: '請針對 {{topic}} 做甲' },
        { title: '乙', prompt: '做乙 [請填入]' },
      ],
    },
    {
      title: '階段 2',
      steps: [{ itemDefaultId: 'kb-default-025' }, { itemDefaultId: 'not-exist' }],
    },
  ],
};

// --- 內建範本資料完整性 --------------------------------------------------------

test('內建專案範本：id 唯一、至少 4 組、每組至少 2 個階段', () => {
  assert.ok(TEMPLATES.length >= 4);
  assert.equal(new Set(TEMPLATES.map((t) => t.id)).size, TEMPLATES.length);
  TEMPLATES.forEach((t) => {
    assert.ok(t.id && t.name && t.description, `${t.id} 缺少必要欄位`);
    assert.ok(t.stages.length >= 2, `${t.name} 至少要有 2 個階段`);
  });
});

test('內建專案範本：每個步驟都能解析出提示詞（引用的知識庫項目都存在），沒有被略過的步驟', () => {
  TEMPLATES.forEach((t) => {
    const declared = t.stages.reduce((n, st) => n + st.steps.length, 0);
    const built = buildWorkflowFromTemplate(t, '測試主題', resolveItem);
    assert.ok(built, `${t.name} 展開失敗`);
    assert.equal(built.workflow.steps.length, declared, `${t.name} 有步驟解析不出提示詞`);
    built.workflow.steps.forEach((s) => {
      assert.ok(s.prompt.trim().length > 100, `${t.name}/${s.title} 提示詞太短`);
      assert.ok(s.stage, `${t.name}/${s.title} 沒有階段名稱`);
    });
  });
});

test('SDD 專案範本：3 階段 7 步，順序與 SDD 分階段套餐一致', () => {
  const tpl = TEMPLATES.find((t) => t.id === 'proj-tpl-sdd');
  assert.ok(tpl);
  const bundle = KB.groups.find((g) => g.defaultId === 'kb-group-default-006');
  const tplIds = tpl.stages.map((st) => st.steps.map((s) => s.itemDefaultId));
  const bundleIds = bundle.stages.map((st) => st.itemDefaultIds);
  assert.deepEqual(tplIds, bundleIds);
});

// --- buildWorkflowFromTemplate -------------------------------------------------

test('buildWorkflowFromTemplate：展開步驟與任務（一步一任務、狀態同步用的 taskId 互相對應）', () => {
  const built = buildWorkflowFromTemplate(sampleTemplate, '  我的主題  ', resolveItem);
  const { workflow, tasks } = built;
  // 'not-exist' 那步解析不到，被略過
  assert.deepEqual(
    workflow.steps.map((s) => [s.stage, s.title]),
    [
      ['階段 1', '甲'],
      ['階段 1', '乙'],
      ['階段 2', '測試計畫與驗收標準'],
    ]
  );
  assert.equal(workflow.topic, '我的主題');
  assert.equal(workflow.contextMode, 'all');
  assert.equal(workflow.currentStepId, workflow.steps[0].id);
  assert.equal(workflow.templateId, 'tpl_x');
  assert.equal(tasks.length, 3);
  assert.deepEqual(
    tasks.map((t) => t.title),
    ['1-1 甲', '1-2 乙', '2-1 測試計畫與驗收標準']
  );
  workflow.steps.forEach((s, i) => {
    assert.equal(s.taskId, tasks[i].id);
    assert.equal(s.status, 'todo');
    assert.equal(s.output, '');
  });
});

test('buildWorkflowFromTemplate：所有步驟都解析不出來時回傳 null', () => {
  const empty = {
    id: 'e',
    name: 'e',
    stages: [{ title: 's', steps: [{ itemDefaultId: 'nope' }] }],
  };
  assert.equal(buildWorkflowFromTemplate(empty, 't', resolveItem), null);
});

test('stepNumbers：階段序號-階段內序號', () => {
  assert.deepEqual(
    stepNumbers([
      { stage: 'A' },
      { stage: 'A' },
      { stage: 'B' },
      { stage: 'B' },
      { stage: 'B' },
    ]),
    ['1-1', '1-2', '2-1', '2-2', '2-3']
  );
});

// --- composeStepPrompt ---------------------------------------------------------

function makeWorkflow() {
  const { workflow } = buildWorkflowFromTemplate(
    sampleTemplate,
    '線上讀書會平台',
    resolveItem
  );
  workflow.steps[0].output = '甲的產出';
  workflow.steps[1].output = '乙的產出';
  return workflow;
}

test('composeStepPrompt：包含專案主題、目前步驟、前面產出、本步驟提示詞與補充說明，並替換 {{topic}}', () => {
  const wf = makeWorkflow();
  const text = composeStepPrompt(wf, wf.steps[2].id);
  assert.ok(text.startsWith('# 專案主題\n線上讀書會平台'));
  assert.ok(text.includes('階段 2 › 2-1 測試計畫與驗收標準（第 3/3 步）'));
  assert.ok(text.includes('## 1-1 甲\n甲的產出'));
  assert.ok(text.includes('## 1-2 乙\n乙的產出'));
  assert.ok(text.includes('# 本步驟提示詞\n# 測試計畫與驗收標準撰寫'));
  assert.ok(text.includes('# 補充說明'));
  // 段落順序：主題 → 目前步驟 → 前面產出 → 本步驟提示詞 → 補充說明
  const order = [
    '# 專案主題',
    '# 目前步驟',
    '# 前面步驟的產出',
    '# 本步驟提示詞',
    '# 補充說明',
  ];
  const positions = order.map((h) => text.indexOf(h));
  assert.deepEqual(
    positions,
    [...positions].sort((a, b) => a - b)
  );
  assert.ok(positions.every((p) => p >= 0));

  const first = composeStepPrompt(wf, wf.steps[0].id);
  assert.ok(first.includes('請針對 線上讀書會平台 做甲'), '{{topic}} 要被換成主題');
  assert.ok(!first.includes('{{topic}}'));
  assert.ok(!first.includes('# 前面步驟的產出'), '第一步沒有前面產出');
});

test('composeStepPrompt：contextMode 控制帶入哪些前面步驟的產出', () => {
  const wf = makeWorkflow();
  const id = wf.steps[2].id;

  wf.contextMode = 'previous';
  let text = composeStepPrompt(wf, id);
  assert.ok(text.includes('乙的產出') && !text.includes('甲的產出'));

  wf.contextMode = 'none';
  text = composeStepPrompt(wf, id);
  assert.ok(!text.includes('# 前面步驟的產出'));

  wf.contextMode = '亂填'; // 不合法的值退回 all
  text = composeStepPrompt(wf, id);
  assert.ok(text.includes('甲的產出') && text.includes('乙的產出'));
});

test('composeStepPrompt：沒有產出的前面步驟不會出現空段落；主題空白時省略主題段；找不到步驟回傳空字串', () => {
  const wf = makeWorkflow();
  wf.steps[0].output = '   ';
  const text = composeStepPrompt(wf, wf.steps[2].id);
  assert.ok(!text.includes('## 1-1 甲'));
  assert.ok(text.includes('## 1-2 乙'));

  wf.topic = '';
  assert.ok(!composeStepPrompt(wf, wf.steps[2].id).includes('# 專案主題'));
  assert.equal(composeStepPrompt(wf, 'nope'), '');
});

// --- nextCurrentStepId / templateFromWorkflow / summarize / normalize -----------

test('nextCurrentStepId：標成完成時移到下一個還沒完成的步驟，其餘不動', () => {
  const wf = makeWorkflow();
  const [a, b, c] = wf.steps;
  a.status = 'done';
  assert.equal(nextCurrentStepId(wf, a.id, 'done'), b.id);
  b.status = 'done';
  assert.equal(nextCurrentStepId(wf, b.id, 'done'), c.id);
  c.status = 'done';
  assert.equal(nextCurrentStepId(wf, c.id, 'done'), c.id, '最後一步做完就留在原地');
  wf.currentStepId = b.id;
  assert.equal(nextCurrentStepId(wf, a.id, 'doing'), b.id, '非完成狀態不移動');
  // 跳過已完成的步驟
  a.status = 'todo';
  b.status = 'done';
  c.status = 'todo';
  assert.equal(nextCurrentStepId(wf, a.id, 'done'), c.id);
});

test('templateFromWorkflow：保留階段與（可能被使用者改過的）提示詞，不帶產出與狀態，且能再展開', () => {
  const wf = makeWorkflow();
  wf.steps[0].prompt = '我改過的甲';
  const tpl = templateFromWorkflow(wf, { name: ' 我的範本 ', description: '說明' });
  assert.match(tpl.id, /^ptpl_/);
  assert.equal(tpl.name, '我的範本');
  assert.deepEqual(
    tpl.stages.map((st) => [st.title, st.steps.map((s) => s.title)]),
    [
      ['階段 1', ['甲', '乙']],
      ['階段 2', ['測試計畫與驗收標準']],
    ]
  );
  assert.equal(tpl.stages[0].steps[0].prompt, '我改過的甲');
  assert.ok(!JSON.stringify(tpl).includes('甲的產出'));

  const rebuilt = buildWorkflowFromTemplate(tpl, '新主題', resolveItem);
  assert.equal(rebuilt.workflow.steps.length, 3);
  assert.equal(rebuilt.workflow.steps[0].prompt, '我改過的甲');
  assert.equal(templateFromWorkflow(wf, {}).name, '範例', '沒填名稱就沿用來源範本名稱');
});

test('summarizeTemplate：只回傳階段與步驟標題，解析不到的步驟略過', () => {
  const s = summarizeTemplate(sampleTemplate, true, resolveItem);
  assert.equal(s.builtIn, true);
  assert.deepEqual(
    s.stages.map((st) => [st.title, st.steps.map((x) => x.title)]),
    [
      ['階段 1', ['甲', '乙']],
      ['階段 2', ['測試計畫與驗收標準']],
    ]
  );
  assert.ok(!JSON.stringify(s).includes('請針對'), '摘要不含提示詞內容');
});

test('normalizeWorkflow：補齊缺少的欄位、修正不合法的值；結構壞掉回傳 null', () => {
  const wf = normalizeWorkflow({
    steps: [{ id: 's1' }, { id: 's2', status: '亂', stage: 5 }],
    contextMode: 'x',
    currentStepId: 'gone',
  });
  assert.equal(wf.topic, '');
  assert.equal(wf.contextMode, 'all');
  assert.equal(wf.currentStepId, 's1');
  assert.deepEqual(
    wf.steps.map((s) => [s.stage, s.output, s.prompt, s.status, s.taskId]),
    [
      ['', '', '', 'todo', null],
      ['', '', '', 'todo', null],
    ]
  );
  assert.equal(normalizeWorkflow(null), null);
  assert.equal(normalizeWorkflow({ steps: 'x' }), null);
});

test('syncStepStatusFromTasks：只同步「狀態不同、任務還在」的步驟，回傳是否有改動', () => {
  const wf = makeWorkflow();
  const tasks = wf.steps.map((s) => ({ id: s.taskId, status: 'todo' }));
  assert.equal(syncStepStatusFromTasks(wf, tasks), false);

  tasks[0].status = 'done';
  tasks[1].status = '亂填'; // 不合法的狀態不同步
  assert.equal(syncStepStatusFromTasks(wf, tasks), true);
  assert.deepEqual(
    wf.steps.map((s) => s.status),
    ['done', 'todo', 'todo']
  );

  wf.steps[2].status = 'doing'; // 對應任務已被刪掉：維持原狀
  assert.equal(syncStepStatusFromTasks(wf, tasks.slice(0, 2)), false);
  assert.equal(wf.steps[2].status, 'doing');
});
