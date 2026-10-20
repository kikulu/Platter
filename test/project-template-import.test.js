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

const {
  sanitizeImportedTemplates,
  importTemplateFiles,
  buildTemplateExport,
  IMPORT_LIMITS,
  IMPORT_FILE_LIMITS,
} = require('../lib/workflow');

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
const ui = { canceled: false, filePaths: [], savePath: null };
const fakeElectron = {
  app: { getPath: () => tmpUserData },
  BrowserWindow: { getAllWindows: () => [] },
  Notification: class {
    static isSupported() {
      return false;
    }
  },
  clipboard: { writeText() {} },
  dialog: {
    showOpenDialog: async () => ({ canceled: ui.canceled, filePaths: ui.filePaths }),
    showSaveDialog: async () => ({ canceled: !ui.savePath, filePath: ui.savePath }),
  },
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

// ---------------------------------------------------------------------------
// 批次匯入（1.47.0）：多檔、拖拉內容
// ---------------------------------------------------------------------------

const fileOf = (name, obj) => ({ name, text: typeof obj === 'string' ? obj : JSON.stringify(obj) });

test('importTemplateFiles：多個檔案各自驗證，好檔不受壞檔影響，順序與統計正確', () => {
  const r = importTemplateFiles([
    fileOf('a.json', { templates: [tpl({ name: 'A1' }), tpl({ name: 'A2' }), { name: 'bad' }] }),
    fileOf('broken.json', '{oops'),
    fileOf('wrong.json', { hello: 1 }),
    fileOf('empty.json', { templates: [{ name: 'x', stages: [] }] }),
    fileOf('bom.json', '\uFEFF' + JSON.stringify(tpl({ name: 'B1' }))),
    { name: 'note.txt', error: 'not-json' },
    { name: 'huge.json', error: 'too-large' },
  ]);
  assert.deepEqual(r.templates.map((t) => t.name), ['A1', 'A2', 'B1']);
  assert.equal(new Set(r.templates.map((t) => t.id)).size, 3, 'id 不重複');
  assert.deepEqual(
    r.files.map((f) => [f.name, f.ok, f.imported, f.skipped, f.error]),
    [
      ['a.json', true, 2, 1, undefined],
      ['broken.json', false, 0, 0, 'invalid-file'],
      ['wrong.json', false, 0, 0, 'invalid-file'],
      ['empty.json', false, 0, 1, 'no-valid-template'],
      ['bom.json', true, 1, 0, undefined],
      ['note.txt', false, 0, 0, 'not-json'],
      ['huge.json', false, 0, 0, 'too-large'],
    ]
  );
  assert.deepEqual(r.skipped.map((x) => [x.file, x.reason]), [
    ['a.json', 'no-steps'],
    ['empty.json', 'no-steps'],
  ]);
});

test('importTemplateFiles：非陣列、壞項目、太大的文字、檔案數量上限', () => {
  assert.deepEqual(importTemplateFiles(null), { templates: [], skipped: [], files: [] });
  const r = importTemplateFiles([null, 'x', { name: 'n' }, { name: 'n2', text: 5 }]);
  assert.equal(r.templates.length, 0);
  assert.ok(r.files.every((f) => !f.ok && f.error === 'invalid-file'));
  const big = importTemplateFiles([{ name: 'big.json', text: ' '.repeat(IMPORT_FILE_LIMITS.bytes + 1) }]);
  assert.equal(big.files[0].error, 'too-large');
  const many = importTemplateFiles(
    Array.from({ length: IMPORT_FILE_LIMITS.files + 5 }, (_, i) => fileOf(`f${i}.json`, tpl({ name: `T${i}` })))
  );
  assert.equal(many.files.length, IMPORT_FILE_LIMITS.files);
  assert.equal(many.templates.length, IMPORT_FILE_LIMITS.files);
});

test('projectTemplates:import：對話框一次選多個檔案 → 全部匯入並回報每個檔案結果', async () => {
  const before = stores.loadProjectTemplates().length;
  ui.canceled = false;
  ui.filePaths = [
    writeTmp('m1.json', { templates: [tpl({ name: 'M1' })] }),
    writeTmp('m2.json', [tpl({ name: 'M2' }), tpl({ name: 'M3' })]),
    writeTmp('m3.json', '{broken'),
  ];
  const res = await invoke('projectTemplates:import');
  assert.equal(res.ok, true);
  assert.equal(res.imported, 3);
  assert.deepEqual(res.files.map((f) => [f.name, f.ok]), [['m1.json', true], ['m2.json', true], ['m3.json', false]]);
  assert.equal(stores.loadProjectTemplates().length, before + 3);
  assert.equal(stores.loadProjectTemplates().find((t) => t.id === res.firstId).name, 'M1');
});

test('projectTemplates:importFiles（拖拉）：多檔成功、全部失敗不寫入、輸入不是陣列視為取消', async () => {
  const before = stores.loadProjectTemplates().length;
  const ok = await invoke('projectTemplates:importFiles', [
    fileOf('d1.json', tpl({ name: 'D1' })),
    fileOf('d2.json', { templates: [tpl({ name: 'D2' })] }),
    { name: 'readme.md', error: 'not-json' },
  ]);
  assert.equal(ok.ok, true);
  assert.equal(ok.imported, 2);
  assert.equal(ok.files[2].error, 'not-json');
  assert.equal(stores.loadProjectTemplates().length, before + 2);

  const bad = await invoke('projectTemplates:importFiles', [fileOf('x.json', '{bad'), fileOf('y.json', {})]);
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'no-valid-template');
  assert.equal(bad.files.length, 2);
  const single = await invoke('projectTemplates:importFiles', [fileOf('x.json', '{bad')]);
  assert.equal(single.error, 'invalid-file');
  assert.equal(stores.loadProjectTemplates().length, before + 2, '失敗時不寫入');

  assert.equal((await invoke('projectTemplates:importFiles', 'nope')).error, 'canceled');
  assert.equal((await invoke('projectTemplates:importFiles', [])).error, 'canceled');
  // 惡意形狀（非字串 text／name）不會丟例外，只算壞檔
  const weird = await invoke('projectTemplates:importFiles', [{ name: 1, text: { a: 1 } }, null]);
  assert.equal(weird.ok, false);
});

// ---------------------------------------------------------------------------
// 匯出（1.47.0）
// ---------------------------------------------------------------------------

test('buildTemplateExport：展開知識庫引用、不輸出 id／builtIn、丟掉解析不到的步驟與空階段，且能被匯入讀回', () => {
  const resolve = (id) => (id === 'kb-1' ? { title: '知識庫標題', prompt: '知識庫提示詞' } : null);
  const out = buildTemplateExport(
    [
      {
        id: 'ptpl_x',
        builtIn: true,
        name: '內建式',
        description: 'D',
        createdAt: 'x',
        stages: [
          {
            title: 'S1',
            steps: [
              { title: 'own', prompt: 'P {{topic}}', artifact: 'proposal.md', useBaseContext: true },
              { itemDefaultId: 'kb-1' },
              { itemDefaultId: 'missing' },
            ],
            relatedPrompts: [{ itemDefaultId: 'kb-1' }, { itemDefaultId: 'missing' }],
          },
          { title: 'empty', steps: [{ itemDefaultId: 'missing' }] },
        ],
      },
      { name: '', stages: [{ steps: [{ title: 'a', prompt: 'b' }] }] },
      null,
    ],
    resolve,
    { now: '2026-01-01T00:00:00.000Z' }
  );
  assert.equal(out.format, 'platter-project-templates');
  assert.equal(out.exportedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(out.templates.length, 1);
  const t = out.templates[0];
  assert.equal('id' in t || 'builtIn' in t || 'createdAt' in t, false);
  assert.equal(t.stages.length, 1);
  assert.deepEqual(t.stages[0].steps, [
    { title: 'own', prompt: 'P {{topic}}', artifact: 'proposal.md', useBaseContext: true },
    { title: '知識庫標題', prompt: '知識庫提示詞' },
  ]);
  assert.deepEqual(t.stages[0].relatedPrompts, [{ title: '知識庫標題', prompt: '知識庫提示詞' }]);

  const back = sanitizeImportedTemplates(out);
  assert.equal(back.skipped.length, 0);
  assert.equal(back.templates[0].stages[0].steps.length, 2);
});

test('projectTemplates:export：取消、沒有自訂範本、匯出單一內建範本、匯出全部自訂範本並可再匯入', async () => {
  ui.savePath = null;
  assert.equal((await invoke('projectTemplates:export', null)).ok === false, true);

  const builtIn = (await invoke('projectTemplates:list')).find((t) => t.builtIn);
  assert.ok(builtIn);
  ui.savePath = path.join(tmpUserData, 'one.json');
  const one = await invoke('projectTemplates:export', [builtIn.id]);
  assert.equal(one.ok, true);
  assert.equal(one.exported, 1);
  const file = JSON.parse(fs.readFileSync(ui.savePath, 'utf8'));
  assert.equal(file.templates[0].name, builtIn.name);
  assert.ok(file.templates[0].stages.every((s) => s.steps.every((x) => x.title && x.prompt)));
  const reimported = importTemplateFiles([{ name: 'one.json', text: JSON.stringify(file) }]);
  assert.equal(reimported.templates.length, 1);
  assert.deepEqual(reimported.skipped, []);

  const customCount = stores.loadProjectTemplates().length;
  assert.ok(customCount > 0);
  ui.savePath = path.join(tmpUserData, 'all.json');
  const all = await invoke('projectTemplates:export', null);
  assert.equal(all.exported, customCount);

  // 沒有符合的 id → nothing-to-export
  ui.savePath = path.join(tmpUserData, 'nothing-export.json');
  assert.equal((await invoke('projectTemplates:export', ['no-such-id'])).error, 'nothing-to-export');
  assert.equal(fs.existsSync(ui.savePath), false);
});
