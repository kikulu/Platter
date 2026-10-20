'use strict';

/**
 * test/project-template-import.test.js
 *
 * 專案範本檔匯入（1.46.0，格式見 docs/PROJECT_TEMPLATE_FORMAT.md）：
 *   - sanitizeImportedTemplates：三種最上層格式、白名單欄位、上限、壞資料略過、一律新 id
 *   - projectTemplates:import IPC：取消、壞檔、成功後能用匯入的範本建立專案（{{topic}} 會被代換）
 *   - docs/project-templates/*.json 的範本檔本身都必須能完整匯入（零略過、無被丟掉的步驟）
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const { sanitizeImportedTemplates, IMPORT_LIMITS } = require('../lib/workflow');

const step = (title = 'S', prompt = 'P {{topic}}') => ({ title, prompt });
const tpl = (over = {}) => ({
  name: 'T',
  description: 'D',
  stages: [{ title: '階段 1', steps: [step('a'), step('b')] }],
  ...over,
});

test('sanitize：三種最上層格式（含 format 標記、陣列、單一範本）', () => {
  const a = sanitizeImportedTemplates({ format: 'platter-project-templates', formatVersion: 1, templates: [tpl()] });
  const b = sanitizeImportedTemplates([tpl(), tpl({ name: 'U' })]);
  const c = sanitizeImportedTemplates(tpl());
  assert.deepEqual([a.templates.length, b.templates.length, c.templates.length], [1, 2, 1]);
  assert.equal(a.skipped.length + b.skipped.length + c.skipped.length, 0);
});

test('sanitize：最上層格式不對、format 標記不符 → INVALID_FORMAT', () => {
  [null, 'x', 3, {}, { templates: 'no' }, { format: 'other', templates: [tpl()] }].forEach((raw) => {
    assert.equal(sanitizeImportedTemplates(raw).error, 'INVALID_FORMAT');
  });
});

test('sanitize：一律產生新 id 與 createdAt，忽略檔案裡的 id／createdAt／未知欄位', () => {
  const { templates } = sanitizeImportedTemplates(
    [tpl({ id: 'proj-tpl-sdd', createdAt: 'x', evil: { a: 1 } })],
    { now: '2026-01-01T00:00:00.000Z' }
  );
  assert.match(templates[0].id, /^ptpl_/);
  assert.notEqual(templates[0].id, 'proj-tpl-sdd');
  assert.equal(templates[0].createdAt, '2026-01-01T00:00:00.000Z');
  assert.equal('evil' in templates[0], false);
});

test('sanitize：步驟需要標題＋提示詞，或 itemDefaultId；壞步驟與空階段被丟掉', () => {
  const { templates, skipped } = sanitizeImportedTemplates([
    tpl({
      stages: [
        {
          title: 'A',
          steps: [
            step('ok'),
            { title: '', prompt: 'no title' },
            { title: 'no prompt', prompt: '   ' },
            { itemDefaultId: 'kb-default-001' },
            { itemDefaultId: '../bad id' },
            'str',
            null,
          ],
        },
        { title: 'empty', steps: [{ title: 'x' }] },
        'junk',
      ],
    }),
  ]);
  assert.equal(skipped.length, 0);
  assert.equal(templates[0].stages.length, 1);
  assert.deepEqual(
    templates[0].stages[0].steps.map((s) => s.title || s.itemDefaultId),
    ['ok', 'kb-default-001']
  );
});

test('sanitize：沒有名稱／沒有有效階段的範本整份略過並回報原因', () => {
  const { templates, skipped } = sanitizeImportedTemplates([
    tpl({ name: '  ' }),
    tpl({ name: 'noStages', stages: [] }),
    'x',
    tpl({ name: 'good' }),
  ]);
  assert.deepEqual(templates.map((t) => t.name), ['good']);
  assert.deepEqual(skipped.map((s) => s.reason), ['no-name', 'no-steps', 'not-object']);
});

test('sanitize：artifact 只接受安全的 .md 相對路徑；useBaseContext 只接受 true', () => {
  const mk = (artifact, useBaseContext) => ({
    ...step('x'),
    artifact,
    useBaseContext,
  });
  const { templates } = sanitizeImportedTemplates([
    tpl({
      stages: [
        {
          title: 's',
          steps: [
            mk('proposal.md', true),
            mk('specs/general/spec.md', 'yes'),
            mk('../../etc/passwd.md'),
            mk('/abs/x.md'),
            mk('a/../b.md'),
            mk('run.sh'),
            mk('x'.repeat(200) + '.md'),
          ],
        },
      ],
    }),
  ]);
  const steps = templates[0].stages[0].steps;
  assert.deepEqual(steps.map((s) => s.artifact), ['proposal.md', 'specs/general/spec.md', undefined, undefined, undefined, undefined, undefined]);
  assert.deepEqual(steps.map((s) => s.useBaseContext), [true, undefined, undefined, undefined, undefined, undefined, undefined]);
});

test('sanitize：relatedPrompts 只留 { title, prompt | itemDefaultId }；數量與長度上限', () => {
  const big = 'x'.repeat(IMPORT_LIMITS.prompt + 100);
  const manyStages = Array.from({ length: IMPORT_LIMITS.stages + 5 }, (_, i) => ({
    title: `s${i}`,
    steps: [step('a', big)],
    relatedPrompts: [
      { title: 'r', prompt: 'p', extra: 1 },
      { itemDefaultId: 'kb-default-002' },
      { title: 'bad' },
    ],
  }));
  const { templates } = sanitizeImportedTemplates([tpl({ name: 'N'.repeat(500), stages: manyStages })]);
  const t = templates[0];
  assert.equal(t.name.length, IMPORT_LIMITS.name);
  assert.equal(t.stages.length, IMPORT_LIMITS.stages);
  assert.equal(t.stages[0].steps[0].prompt.length, IMPORT_LIMITS.prompt);
  assert.deepEqual(t.stages[0].relatedPrompts, [
    { title: 'r', prompt: 'p' },
    { title: '', itemDefaultId: 'kb-default-002' },
  ]);
  const tooMany = sanitizeImportedTemplates(Array.from({ length: IMPORT_LIMITS.templates + 3 }, () => tpl()));
  assert.equal(tooMany.templates.length, IMPORT_LIMITS.templates);
  assert.equal(tooMany.skipped.length, 3);
  assert.equal(tooMany.skipped[0].reason, 'too-many');
});

// ---------------------------------------------------------------------------
// IPC（假 electron）
// ---------------------------------------------------------------------------

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'platter-tpl-import-'));
const ui = { canceled: false, filePaths: [] };
const fakeElectron = {
  app: { getPath: () => tmpUserData },
  BrowserWindow: { getAllWindows: () => [] },
  Notification: class {
    static isSupported() {
      return false;
    }
  },
  clipboard: { writeText() {} },
  dialog: { showOpenDialog: async () => ({ canceled: ui.canceled, filePaths: ui.filePaths }) },
};
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return fakeElectron;
  return originalLoad.call(this, request, ...rest);
};
const { registerProjectsIpc } = require('../lib/ipc/projects');
const stores = require('../lib/stores');
Module._load = originalLoad;

const handlers = new Map();
registerProjectsIpc({ handle: (channel, fn) => handlers.set(channel, fn) });
const invoke = (channel, arg) => handlers.get(channel)({}, arg);

test.after(() => fs.rmSync(tmpUserData, { recursive: true, force: true }));

const writeTmp = (name, content) => {
  const f = path.join(tmpUserData, name);
  fs.writeFileSync(f, typeof content === 'string' ? content : JSON.stringify(content));
  return f;
};

test('projectTemplates:import：取消、壞 JSON、格式不對、沒有有效範本', async () => {
  ui.canceled = true;
  assert.equal((await invoke('projectTemplates:import')).error, 'canceled');
  ui.canceled = false;
  ui.filePaths = [writeTmp('broken.json', '{not json')];
  assert.equal((await invoke('projectTemplates:import')).error, 'invalid-file');
  ui.filePaths = [writeTmp('wrong.json', { hello: 1 })];
  assert.equal((await invoke('projectTemplates:import')).error, 'invalid-file');
  ui.filePaths = [writeTmp('none.json', { templates: [{ name: 'x', stages: [] }] })];
  const res = await invoke('projectTemplates:import');
  assert.equal(res.error, 'no-valid-template');
  assert.equal(res.skipped.length, 1);
  assert.equal(stores.loadProjectTemplates().length, 0, '失敗時不寫入任何範本');
});

test('projectTemplates:import：成功匯入（含 BOM）→ 出現在清單為自訂範本 → 能建立專案且 {{topic}} 被代換', async () => {
  const body = JSON.stringify({
    format: 'platter-project-templates',
    templates: [tpl({ name: '匯入測試範本' }), { name: 'bad' }],
  });
  ui.filePaths = [writeTmp('good.json', '﻿' + body)];
  const res = await invoke('projectTemplates:import');
  assert.equal(res.ok, true);
  assert.equal(res.imported, 1);
  assert.equal(res.skipped.length, 1);

  const list = await invoke('projectTemplates:list');
  const imported = list.find((t) => t.id === res.firstId);
  assert.equal(imported.builtIn, false);
  assert.equal(imported.name, '匯入測試範本');
  assert.equal(imported.stages[0].steps.length, 2);

  const created = await invoke('projects:createFromTemplate', {
    templateId: res.firstId,
    topic: '我的主題',
  });
  assert.equal(created.ok, true);
  const project = stores.loadProjects().find((p) => p.id === created.projectId);
  const composed = await invoke('projects:workflow:compose', {
    projectId: project.id,
    stepId: project.workflow.steps[0].id,
  });
  assert.match(composed, /P 我的主題/);
  assert.doesNotMatch(composed, /\{\{topic\}\}/);

  // 再匯入同一個檔案 → 新 id、不覆蓋
  const again = await invoke('projectTemplates:import');
  assert.equal(again.ok, true);
  assert.notEqual(again.firstId, res.firstId);
  assert.equal(stores.loadProjectTemplates().length, 2);
});

// ---------------------------------------------------------------------------
// 範本檔本身
// ---------------------------------------------------------------------------

const SAMPLES_DIR = path.join(__dirname, '..', 'docs', 'project-templates');
const sampleFiles = fs.existsSync(SAMPLES_DIR)
  ? fs.readdirSync(SAMPLES_DIR).filter((f) => f.endsWith('.json'))
  : [];

test('docs/project-templates/ 的範本檔：完整匯入、零略過、步驟數不變、提示詞含必要區塊', () => {
  assert.ok(sampleFiles.length >= 6, '至少 6 個範本檔');
  const names = new Set();
  sampleFiles.forEach((f) => {
    const raw = JSON.parse(fs.readFileSync(path.join(SAMPLES_DIR, f), 'utf8'));
    const { templates, skipped, error } = sanitizeImportedTemplates(raw);
    assert.equal(error, undefined, f);
    assert.deepEqual(skipped, [], f);
    assert.equal(templates.length, raw.templates.length, f);
    templates.forEach((t, i) => {
      assert.ok(!names.has(t.name), `範本名稱重複：${t.name}`);
      names.add(t.name);
      const rawSteps = raw.templates[i].stages.reduce((n, s) => n + s.steps.length, 0);
      const gotSteps = t.stages.reduce((n, s) => n + s.steps.length, 0);
      assert.equal(gotSteps, rawSteps, `${f}: ${t.name} 有步驟被丟掉`);
      assert.ok(t.stages.length >= 3, `${t.name} 至少 3 個階段`);
      t.stages.forEach((st) =>
        st.steps.forEach((s) => {
          ['角色與目標', '輸入資訊', '輸出要求', '補充'].forEach((h) =>
            assert.ok(s.prompt.includes(h), `${t.name}／${s.title} 缺「${h}」`)
          );
        })
      );
      assert.ok(t.stages.some((st) => st.steps.some((s) => s.prompt.includes('{{topic}}'))), `${t.name} 至少一步帶入 {{topic}}`);
    });
  });
});
