'use strict';

/**
 * test/workflow-handoff.test.js — 跨對話交接（1.57.0）與 1.57.0 新增的開發類內建範本。
 *   - composeHandoffPrompt／composeHandoffRequestPrompt 的組合內容
 *   - step.handoffNote 的建立與正規化
 *   - 新範本：結構、三語系展開、沒有殘留的產生器標記
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  buildWorkflowFromTemplate,
  composeHandoffPrompt,
  composeHandoffRequestPrompt,
  normalizeWorkflow,
} = require('../lib/workflow');
const builtin = require('../lib/builtinContent');
const { schemas } = require('../lib/ipc/schemas');
const { validateArgs } = require('../lib/ipcValidate');

const sample = {
  id: 'tpl',
  name: 'T',
  stages: [
    {
      title: '階段 1：規劃',
      steps: [
        { title: '甲', prompt: '做甲：{{topic}}' },
        { title: '乙', prompt: '做乙' },
      ],
    },
    { title: '階段 2：實作', steps: [{ title: '丙', prompt: '做丙' }] },
  ],
};

function makeWorkflow() {
  const { workflow } = buildWorkflowFromTemplate(sample, '記帳 App', () => null);
  workflow.steps[0].status = 'done';
  workflow.steps[0].output = '甲的產出';
  workflow.steps[1].status = 'doing';
  return workflow;
}

test('buildWorkflowFromTemplate／normalizeWorkflow：每一步都有 handoffNote 字串', () => {
  const wf = makeWorkflow();
  assert.ok(wf.steps.every((s) => s.handoffNote === ''));
  delete wf.steps[0].handoffNote;
  wf.steps[1].handoffNote = 42;
  normalizeWorkflow(wf);
  assert.equal(wf.steps[0].handoffNote, '');
  assert.equal(wf.steps[1].handoffNote, '');
  wf.steps[2].handoffNote = '做到一半';
  normalizeWorkflow(wf);
  assert.equal(wf.steps[2].handoffNote, '做到一半');
});

test('composeHandoffPrompt：流程總覽標出每一步狀態與目前步驟，帶入前面產出與本步驟提示詞', () => {
  const wf = makeWorkflow();
  const text = composeHandoffPrompt(wf, wf.steps[1].id);
  assert.match(text, /記帳 App/);
  assert.match(text, /- ✓ 1-1 甲/);
  assert.match(text, /- ▶ 1-2 乙 ←/);
  assert.match(text, /- ○ 2-1 丙/);
  assert.match(text, /## 階段 2：實作/);
  assert.match(text, /甲的產出/);
  assert.match(text, /做乙/);
  // 只有目前步驟有標記
  assert.equal(text.split('←').length - 1, 1);
  // 沒有交接筆記時不出現筆記區塊
  assert.doesNotMatch(text, /交接筆記/);
});

test('composeHandoffPrompt：有交接筆記時帶入筆記，並改用「從未完成處接續」的接手方式', () => {
  const wf = makeWorkflow();
  const plain = composeHandoffPrompt(wf, wf.steps[1].id);
  wf.steps[1].handoffNote = '已完成 A，剩下 B';
  const resumed = composeHandoffPrompt(wf, wf.steps[1].id);
  assert.match(resumed, /已完成 A，剩下 B/);
  assert.notEqual(resumed, plain);
  assert.match(resumed, /不要從頭重來/);
});

test('composeHandoffPrompt：依 contextMode 帶入前面產出；none 時改提示需要再索取', () => {
  const wf = makeWorkflow();
  wf.steps[1].output = '乙的產出';
  const target = wf.steps[2].id;
  wf.contextMode = 'previous';
  let text = composeHandoffPrompt(wf, target);
  assert.match(text, /乙的產出/);
  assert.doesNotMatch(text, /甲的產出/);
  wf.contextMode = 'none';
  text = composeHandoffPrompt(wf, target);
  assert.doesNotMatch(text, /甲的產出|乙的產出/);
  assert.match(text, /向我索取/);
  // 第一步沒有前面步驟，不需要「未附上」說明
  assert.doesNotMatch(composeHandoffPrompt(wf, wf.steps[0].id), /向我索取/);
});

test('composeHandoffPrompt／composeHandoffRequestPrompt：找不到步驟回傳空字串', () => {
  const wf = makeWorkflow();
  assert.equal(composeHandoffPrompt(wf, 'nope'), '');
  assert.equal(composeHandoffRequestPrompt(wf, 'nope'), '');
  assert.equal(composeHandoffPrompt(null, 'x'), '');
});

test('composeHandoffRequestPrompt：含專案主題與目前步驟（階段與編號），要求固定格式', () => {
  const wf = makeWorkflow();
  const text = composeHandoffRequestPrompt(wf, wf.steps[1].id);
  assert.match(text, /記帳 App/);
  assert.match(text, /階段 1：規劃 › 1-2 乙/);
  assert.match(text, /下一個動作/);
  wf.topic = '';
  assert.match(composeHandoffRequestPrompt(wf, wf.steps[1].id), /（未填）/);
});

test('IPC 規格：交接頻道與派發的 mode 參數', () => {
  const ok = (ch, args) => validateArgs(schemas[ch], args) === true;
  assert.ok(ok('projects:workflow:composeHandoff', [{ projectId: 'p1', stepId: 's1' }]));
  assert.ok(
    ok('projects:workflow:composeHandoffRequest', [{ projectId: 'p1', stepId: 's1' }])
  );
  assert.ok(
    !ok('projects:workflow:composeHandoff', [{ projectId: '../x', stepId: 's1' }])
  );
  assert.ok(
    ok('projects:workflow:dispatch', [
      { projectId: 'p1', stepId: 's1', accountId: 'a1', mode: 'handoff' },
    ])
  );
  assert.ok(
    ok('projects:workflow:dispatch', [{ projectId: 'p1', stepId: 's1', accountId: 'a1' }])
  );
  assert.ok(!ok('projects:workflow:dispatch', [{ projectId: 'p1', stepId: 's1' }]));
});

// ---- 1.57.0 新增的開發類範本 ----

const NEW_IDS = [
  'proj-tpl-mobile-app',
  'proj-tpl-web-app',
  'proj-tpl-desktop-app',
  'proj-tpl-backend-api',
  'proj-tpl-browser-extension',
  'proj-tpl-llm-app',
];
const KB = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '..', 'extractors', 'default-knowledge-base.json'),
    'utf-8'
  )
);
const kbById = new Map(KB.items.map((it) => [it.defaultId, it]));
const resolveItem = (id) => {
  const it = kbById.get(id);
  return it ? { title: it.title, prompt: it.content || '' } : null;
};

for (const lang of builtin.SUPPORTED_LANGUAGES) {
  test(`新範本（${lang}）：細分階段、可展開成流程、沒有殘留的產生器標記`, () => {
    const all = builtin.localizedDefaultProjectTemplates(lang);
    NEW_IDS.forEach((id) => {
      const tpl = all.find((t) => t.id === id);
      assert.ok(tpl, `${id} 不存在`);
      assert.ok(tpl.stages.length >= 8, `${id} 階段太少`);
      tpl.stages.forEach((st) => {
        assert.ok(st.steps.length >= 2, `${id}/${st.title} 步驟太少`);
        st.steps.forEach((s) => {
          if (s.itemDefaultId) return;
          assert.ok(s.title && s.prompt, `${id}/${st.title} 步驟缺標題或提示詞`);
          assert.doesNotMatch(
            s.prompt,
            /@F|@P|@N|\{(SCOPE|CI|MON)\}/,
            `${id} 有殘留標記`
          );
          assert.equal(
            (s.prompt.match(/^## /gm) || []).length,
            4,
            `${id}/${s.title} 骨架`
          );
        });
      });
      const built = buildWorkflowFromTemplate(tpl, '主題', resolveItem);
      const expected = tpl.stages.reduce((n, st) => n + st.steps.length, 0);
      assert.equal(built.workflow.steps.length, expected, `${id} 有步驟解析不出來`);
      // 第一個步驟帶入專案主題
      assert.match(tpl.stages[0].steps[0].prompt, /\{\{topic\}\}/);
    });
  });
}
