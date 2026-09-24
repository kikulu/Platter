'use strict';

/**
 * test/openspec.test.js — OpenSpec 整合（lib/openspec.js）：路徑檢查、解析 AI 產出裡的檔案標記、
 * 匯出計畫、寫檔（含路徑穿越防護）、匯入現有規格，以及內建 OpenSpec 範本／套餐的資料完整性。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  sanitizeRelativePath,
  isValidChangeId,
  slugifyChangeId,
  extractSuggestedChangeId,
  stripOuterFence,
  parseArtifactFiles,
  buildOpenSpecExportPlan,
  findExistingFiles,
  writeExportFiles,
  buildBaseContext,
  readOpenSpecSpecs,
} = require('../lib/openspec');
const {
  buildWorkflowFromTemplate,
  composeStepPrompt,
  templateFromWorkflow,
  normalizeWorkflow,
} = require('../lib/workflow');

const readJSON = (rel) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf-8'));
const KB = readJSON('extractors/default-knowledge-base.json');
const TEMPLATES = readJSON('extractors/default-project-templates.json').templates;
const kbById = new Map(KB.items.map((it) => [it.defaultId, it]));
const resolveItem = (id) => {
  const it = kbById.get(id);
  return it ? { title: it.title, prompt: it.content } : null;
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'platter-openspec-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// --- 路徑與名稱 ----------------------------------------------------------------

test('sanitizeRelativePath：只接受安全的相對 .md 路徑', () => {
  assert.equal(sanitizeRelativePath('proposal.md'), 'proposal.md');
  assert.equal(sanitizeRelativePath(' specs/auth/spec.md '), 'specs/auth/spec.md');
  assert.equal(sanitizeRelativePath('specs\\auth\\spec.md'), 'specs/auth/spec.md');
  [
    '../evil.md',
    'specs/../../evil.md',
    '/etc/passwd.md',
    'C:/x.md',
    'specs/./a.md',
    '.hidden.md',
    'specs/.git/a.md',
    'a.txt',
    'a.sh',
    'no-extension',
    '',
    '   ',
    'a b/c.md',
    'specs/中文/spec.md',
    'a/b/c/d/e/f.md', // 太深
    'x'.repeat(130) + '.md',
    'a\u0000b.md',
  ].forEach((p) => assert.equal(sanitizeRelativePath(p), null, JSON.stringify(p)));
  assert.equal(sanitizeRelativePath(null), null);
  assert.equal(sanitizeRelativePath(42), null);
});

test('isValidChangeId / slugifyChangeId', () => {
  assert.ok(isValidChangeId('add-dark-mode'));
  assert.ok(isValidChangeId('v2'));
  [
    'Add-Dark',
    'add_dark',
    '-a',
    'a-',
    'a--b',
    '',
    '中文',
    'a/b',
    '..',
    'x'.repeat(61),
  ].forEach((id) => assert.equal(isValidChangeId(id), false, id));
  assert.equal(isValidChangeId(undefined), false);

  const d = new Date(2026, 8, 24);
  assert.equal(slugifyChangeId('Add Dark Mode!', d), 'add-dark-mode');
  assert.equal(slugifyChangeId('  Café  Ordering / v2 ', d), 'cafe-ordering-v2');
  assert.equal(
    slugifyChangeId('線上讀書會平台', d),
    'change-20260924',
    '全中文退回日期名稱'
  );
  assert.equal(slugifyChangeId('', d), 'change-20260924');
  assert.equal(slugifyChangeId('a'.repeat(80), d).length, 50);
  assert.ok(isValidChangeId(slugifyChangeId('讀書會 book club 2026', d)));
});

test('extractSuggestedChangeId：從提案產出找「建議變更名稱」，不合法的名稱忽略', () => {
  assert.equal(
    extractSuggestedChangeId([
      { output: '# Proposal\n...\n\n建議變更名稱：add-reading-club' },
    ]),
    'add-reading-club'
  );
  assert.equal(
    extractSuggestedChangeId([{ output: '建議變更名稱: `fix-login`' }]),
    'fix-login'
  );
  assert.equal(extractSuggestedChangeId([{ output: '建議變更名稱：Bad Name' }]), null);
  assert.equal(extractSuggestedChangeId([{ output: '沒有' }, {}]), null);
  assert.equal(extractSuggestedChangeId(undefined), null);
});

test('stripOuterFence：只拿掉包住整份內容的最外層程式碼圍欄', () => {
  assert.equal(stripOuterFence('```markdown\n# A\n\ntext\n```'), '# A\n\ntext');
  assert.equal(stripOuterFence('```\n# A\n```\n'), '# A');
  assert.equal(
    stripOuterFence('# A\n\n```js\ncode\n```'),
    '# A\n\n```js\ncode\n```',
    '文中的區塊不動'
  );
  assert.equal(stripOuterFence('  # A  '), '# A');
});

// --- parseArtifactFiles --------------------------------------------------------

test('parseArtifactFiles：沒有標記時整份寫到預設路徑', () => {
  const r = parseArtifactFiles('# Proposal: X\n\n## Intent\nhi', 'proposal.md');
  assert.deepEqual(r.files, [
    { path: 'proposal.md', content: '# Proposal: X\n\n## Intent\nhi' },
  ]);
  assert.equal(r.usedDefault, true);
  assert.deepEqual(r.rejected, []);
});

test('parseArtifactFiles：有 FILE 標記時每個標記一份檔案，前言忽略，圍欄拿掉', () => {
  const out = [
    '好的，以下是差異規格：',
    '',
    '=== FILE: specs/auth/spec.md ===',
    '# Delta for Auth',
    '',
    '## ADDED Requirements',
    '### Requirement: 2FA',
    '',
    '=== FILE: specs/ui/spec.md ===',
    '```markdown',
    '# Delta for UI',
    '```',
  ].join('\n');
  const r = parseArtifactFiles(out, 'specs/general/spec.md');
  assert.equal(r.usedDefault, false);
  assert.deepEqual(
    r.files.map((f) => f.path),
    ['specs/auth/spec.md', 'specs/ui/spec.md']
  );
  assert.ok(r.files[0].content.startsWith('# Delta for Auth'));
  assert.ok(r.files[0].content.includes('### Requirement: 2FA'));
  assert.equal(r.files[1].content, '# Delta for UI');
  assert.ok(!r.files.some((f) => f.content.includes('好的')));
});

test('parseArtifactFiles：不安全的標記路徑被拒絕，其他檔案照常', () => {
  const out = [
    '=== FILE: ../../etc/cron.d/evil.md ===',
    'pwn',
    '=== FILE: /abs/path.md ===',
    'pwn',
    '=== FILE: specs/a/spec.md ===',
    'ok',
    '=== FILE: run.sh ===',
    'pwn',
  ].join('\n');
  const r = parseArtifactFiles(out, 'x.md');
  assert.deepEqual(r.files, [{ path: 'specs/a/spec.md', content: 'ok' }]);
  assert.equal(r.rejected.length, 3);
});

test('parseArtifactFiles：空內容與不合法預設路徑', () => {
  assert.deepEqual(parseArtifactFiles('   ', 'a.md').files, []);
  assert.deepEqual(parseArtifactFiles('內容', '../a.md').files, []);
  assert.deepEqual(
    parseArtifactFiles('=== FILE: a.md ===\n\n=== FILE: b.md ===\nB', 'x.md').files,
    [{ path: 'b.md', content: 'B' }]
  );
});

// --- buildOpenSpecExportPlan ---------------------------------------------------

function makeWorkflow() {
  const tpl = TEMPLATES.find((t) => t.id === 'proj-tpl-openspec');
  return buildWorkflowFromTemplate(tpl, '線上讀書會平台', resolveItem).workflow;
}
const stepByArtifact = (wf, artifact) => wf.steps.find((s) => s.artifact === artifact);

test('buildOpenSpecExportPlan：依步驟產出組出 proposal／specs／design／tasks，沒產出的步驟列入 skipped', () => {
  const wf = makeWorkflow();
  stepByArtifact(wf, 'proposal.md').output =
    '```markdown\n# Proposal: Reading club\n\n## Intent\nx\n```\n\n建議變更名稱：add-reading-club';
  stepByArtifact(wf, 'specs/general/spec.md').output =
    '=== FILE: specs/membership/spec.md ===\n# Delta for Membership\n=== FILE: specs/events/spec.md ===\n# Delta for Events';
  stepByArtifact(wf, 'tasks.md').output = '# Tasks\n- [ ] 1.1 x';
  // design.md 沒有產出

  const plan = buildOpenSpecExportPlan(wf, 'add-reading-club');
  assert.equal(plan.dirRelative, 'openspec/changes/add-reading-club');
  assert.deepEqual(
    plan.files.map((f) => f.path),
    ['proposal.md', 'specs/membership/spec.md', 'specs/events/spec.md', 'tasks.md']
  );
  const proposal = plan.files[0].content;
  assert.ok(proposal.startsWith('# Proposal: Reading club'));
  assert.ok(!proposal.includes('建議變更名稱'), '建議變更名稱那行不屬於檔案內容');
  assert.ok(proposal.endsWith('\n'));
  assert.deepEqual(
    plan.skipped.map((s) => [s.title, s.reason]),
    [['OpenSpec 技術設計（design.md）', 'no-output']]
  );
  assert.deepEqual(plan.warnings, []);
});

test('buildOpenSpecExportPlan：差異規格沒有檔案標記時寫到預設路徑並警告；不帶 artifact 的步驟不匯出', () => {
  const wf = makeWorkflow();
  stepByArtifact(wf, 'specs/general/spec.md').output =
    '# Delta for X\n## ADDED Requirements';
  wf.steps.find((s) => !s.artifact).output = '探索或實作的產出，不該被匯出';
  const plan = buildOpenSpecExportPlan(wf, 'x');
  assert.deepEqual(
    plan.files.map((f) => f.path),
    ['specs/general/spec.md']
  );
  assert.equal(plan.warnings.length, 1);
  assert.equal(plan.warnings[0].code, 'no-file-marker');
  assert.ok(!JSON.stringify(plan.files).includes('不該被匯出'));
});

test('buildOpenSpecExportPlan：不安全路徑進 rejected；同一路徑後面的步驟覆蓋前面的', () => {
  const wf = {
    steps: [
      { id: 'a', title: 'A', artifact: 'design.md', output: '舊版' },
      { id: 'b', title: 'B', artifact: 'design.md', output: '新版' },
      {
        id: 'c',
        title: 'C',
        artifact: 'specs/x/spec.md',
        output: '=== FILE: ../../oops.md ===\nhack',
      },
    ],
  };
  const plan = buildOpenSpecExportPlan(wf, 'x');
  assert.deepEqual(plan.files, [
    { path: 'design.md', content: '新版\n', stepId: 'b', stepTitle: 'B' },
  ]);
  assert.equal(plan.rejected.length, 1);
  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.skipped[0].reason, 'no-valid-file');
});

// --- 寫檔 ----------------------------------------------------------------------

test('writeExportFiles / findExistingFiles：寫到 openspec/changes/<id>/ 底下，並能偵測既有檔案', () => {
  const root = fs.mkdtempSync(path.join(tmp, 'proj-'));
  const plan = {
    changeId: 'add-x',
    dirRelative: 'openspec/changes/add-x',
    files: [
      { path: 'proposal.md', content: '# P\n' },
      { path: 'specs/auth/spec.md', content: '# Delta\n' },
    ],
  };
  assert.deepEqual(findExistingFiles(root, plan), []);
  const written = writeExportFiles(root, plan);
  assert.deepEqual(written, [
    'openspec/changes/add-x/proposal.md',
    'openspec/changes/add-x/specs/auth/spec.md',
  ]);
  assert.equal(
    fs.readFileSync(
      path.join(root, 'openspec/changes/add-x/specs/auth/spec.md'),
      'utf-8'
    ),
    '# Delta\n'
  );
  assert.deepEqual(findExistingFiles(root, plan), ['proposal.md', 'specs/auth/spec.md']);
});

test('writeExportFiles：縱深防禦——即使計畫裡混進穿越路徑也拒絕寫出變更資料夾之外', () => {
  const root = fs.mkdtempSync(path.join(tmp, 'proj-'));
  const plan = {
    changeId: 'x',
    dirRelative: 'openspec/changes/x',
    files: [{ path: '../../../../escape.md', content: 'x' }],
  };
  assert.throws(() => writeExportFiles(root, plan), /拒絕寫出/);
  assert.ok(!fs.existsSync(path.join(root, '..', 'escape.md')));
});

// --- 匯入既有規格 --------------------------------------------------------------

function makeOpenSpecProject(base) {
  const root = fs.mkdtempSync(path.join(tmp, base));
  const specs = path.join(root, 'openspec', 'specs');
  fs.mkdirSync(path.join(specs, 'auth'), { recursive: true });
  fs.mkdirSync(path.join(specs, 'payments'), { recursive: true });
  fs.mkdirSync(path.join(specs, 'empty-dir'), { recursive: true });
  fs.writeFileSync(
    path.join(specs, 'auth', 'spec.md'),
    '# Auth\n### Requirement: Login\n'
  );
  fs.writeFileSync(path.join(specs, 'payments', 'spec.md'), '# Payments\n');
  fs.writeFileSync(path.join(specs, 'README.md'), 'not a capability');
  return { root, specs };
}

test('readOpenSpecSpecs：可選專案根目錄、openspec 資料夾或 specs 資料夾；忽略沒有 spec.md 的子資料夾', () => {
  const { root, specs } = makeOpenSpecProject('p1-');
  [root, path.join(root, 'openspec'), specs].forEach((dir) => {
    const found = readOpenSpecSpecs(dir);
    assert.ok(found, dir);
    assert.deepEqual(
      found.entries.map((e) => e.capability),
      ['auth', 'payments']
    );
  });
  assert.equal(readOpenSpecSpecs(fs.mkdtempSync(path.join(tmp, 'none-'))), null);
});

test('readOpenSpecSpecs：過大的單一 spec.md 略過並回報', () => {
  const { root, specs } = makeOpenSpecProject('p2-');
  fs.writeFileSync(path.join(specs, 'auth', 'spec.md'), 'x'.repeat(201 * 1024));
  const found = readOpenSpecSpecs(root);
  assert.deepEqual(found.skippedLarge, ['auth']);
  assert.deepEqual(
    found.entries.map((e) => e.capability),
    ['payments']
  );
});

test('buildBaseContext：依 capability 排序組成文字；超過上限時記錄哪些沒帶入', () => {
  const entries = [
    { capability: 'payments', content: 'P'.repeat(30) },
    { capability: 'auth', content: 'A'.repeat(30) },
    { capability: 'ui', content: 'U'.repeat(30) },
  ];
  const full = buildBaseContext(entries);
  assert.ok(
    full.text.indexOf('Capability: auth') < full.text.indexOf('Capability: payments')
  );
  assert.equal(full.capabilityCount, 3);
  assert.deepEqual(full.truncated, []);

  const limited = buildBaseContext(entries, { maxChars: 80 });
  assert.equal(limited.includedCount, 1);
  assert.deepEqual(limited.truncated, ['payments', 'ui']);
  assert.ok(limited.text.includes('未帶入：payments、ui'));

  const huge = buildBaseContext([{ capability: 'big', content: 'x'.repeat(500) }], {
    maxChars: 100,
  });
  assert.deepEqual(huge.truncated, ['big']);
  assert.ok(huge.text.includes('已截斷'));
});

// --- 與 workflow 的整合 --------------------------------------------------------

test('composeStepPrompt：標了 useBaseContext 的步驟帶入既有規格，其他步驟不帶', () => {
  const wf = makeWorkflow();
  wf.baseContext = {
    source: '/x',
    text: '## Capability: auth\n\n### Requirement: Login',
    capabilityCount: 1,
  };
  const specStep = stepByArtifact(wf, 'specs/general/spec.md');
  const withBase = composeStepPrompt(wf, specStep.id);
  assert.ok(
    withBase.includes('# 既有規格（專案 openspec/specs 目前的內容）\n## Capability: auth')
  );
  // 順序：目前步驟 → 既有規格 → 本步驟提示詞
  assert.ok(withBase.indexOf('# 目前步驟') < withBase.indexOf('# 既有規格'));
  assert.ok(withBase.indexOf('# 既有規格') < withBase.indexOf('# 本步驟提示詞'));

  const proposalStep = stepByArtifact(wf, 'proposal.md');
  assert.ok(!composeStepPrompt(wf, proposalStep.id).includes('# 既有規格'));

  delete wf.baseContext;
  assert.ok(!composeStepPrompt(wf, specStep.id).includes('# 既有規格'));
});

test('OpenSpec 範本：3 個帶 artifact 的檔案步驟＋提案，useBaseContext 只在差異規格與封存預演', () => {
  const wf = makeWorkflow();
  assert.equal(wf.steps.length, 8);
  assert.deepEqual(
    wf.steps.filter((s) => s.artifact).map((s) => s.artifact),
    ['proposal.md', 'specs/general/spec.md', 'design.md', 'tasks.md']
  );
  assert.deepEqual(
    wf.steps.filter((s) => s.useBaseContext).map((s) => s.title),
    ['OpenSpec 差異規格（Delta Specs）', 'OpenSpec 封存前預演（Archive）']
  );
  wf.steps
    .filter((s) => s.artifact)
    .forEach((s) => assert.ok(sanitizeRelativePath(s.artifact)));
});

test('templateFromWorkflow：另存範本時保留 artifact／useBaseContext，再展開仍能匯出', () => {
  const wf = makeWorkflow();
  const tpl = templateFromWorkflow(wf, { name: '我的 OpenSpec' });
  const rebuilt = buildWorkflowFromTemplate(tpl, '主題', resolveItem).workflow;
  assert.deepEqual(
    rebuilt.steps.map((s) => [s.artifact, s.useBaseContext]),
    wf.steps.map((s) => [s.artifact, s.useBaseContext])
  );
});

test('normalizeWorkflow：補齊 artifact／useBaseContext，壞掉的 baseContext 丟掉', () => {
  const wf = normalizeWorkflow({
    steps: [
      { id: 's1', artifact: 5 },
      { id: 's2', artifact: 'a.md', useBaseContext: true },
    ],
    baseContext: { text: '   ' },
  });
  assert.deepEqual(
    wf.steps.map((s) => [s.artifact, s.useBaseContext]),
    [
      [null, false],
      ['a.md', true],
    ]
  );
  assert.equal(wf.baseContext, undefined);
  const ok = normalizeWorkflow({ steps: [{ id: 's' }], baseContext: { text: 'abc' } });
  assert.equal(ok.baseContext.chars, 3);
});

// --- 內建 OpenSpec 提示詞／套餐 ------------------------------------------------

test('內建 OpenSpec 提示詞與套餐：8 組提示詞、4 階段套餐、順序符合 OpenSpec 流程', () => {
  const items = KB.items.filter((it) => (it.tags || []).includes('OpenSpec'));
  assert.equal(items.length, 8);
  items.forEach((it) => assert.ok(it.content.length > 300, it.title));

  const bundle = KB.groups.find((g) => g.defaultId === 'kb-group-default-007');
  assert.ok(bundle.tags.includes('分階段範本') && bundle.tags.includes('OpenSpec'));
  const titles = bundle.stages.flatMap((st) =>
    st.itemDefaultIds.map((id) => kbById.get(id).title.replace(/^OpenSpec /, ''))
  );
  assert.deepEqual(titles, [
    '探索想法（Explore）',
    '變更提案（proposal.md）',
    '差異規格（Delta Specs）',
    '技術設計（design.md）',
    '任務清單（tasks.md）',
    '依任務實作（Apply）',
    '實作驗證（Verify）',
    '封存前預演（Archive）',
  ]);
  // 專案範本與套餐引用的提示詞順序一致
  const tpl = TEMPLATES.find((t) => t.id === 'proj-tpl-openspec');
  assert.deepEqual(
    tpl.stages.map((st) => st.steps.map((s) => s.itemDefaultId)),
    bundle.stages.map((st) => st.itemDefaultIds)
  );
});

test('差異規格提示詞明確要求 OpenSpec 格式與檔案標記（匯出功能依賴它）', () => {
  const deltaPrompt = KB.items.find((it) => it.defaultId === 'kb-default-051').content;
  [
    '## ADDED Requirements',
    '## MODIFIED Requirements',
    '## REMOVED Requirements',
    '### Requirement:',
    '#### Scenario:',
    '=== FILE: specs/<capability>/spec.md ===',
  ].forEach((needle) => assert.ok(deltaPrompt.includes(needle), needle));
  assert.ok(
    KB.items
      .find((it) => it.defaultId === 'kb-default-050')
      .content.includes('建議變更名稱')
  );
});
