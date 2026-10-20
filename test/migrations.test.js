'use strict';

/**
 * test/migrations.test.js
 *
 * 資料檔 schema 版本號與集中式 migration（1.45.0，見 lib/migrations.js）：
 *   - 純函式部分：版本表、連號、舊形狀 → 新形狀、冪等、降版不動資料
 *   - 整合（假 electron）：舊檔升級後寫回並留 .v0.bak、新檔不重寫、selectors 版本鍵不外洩、
 *     各種 save 都蓋上版本、備份匯入舊備份會補齊欄位、清除備份檔也清掉升級前備份
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const { MIGRATIONS, SCHEMA_VERSIONS, migrate, stamp, readVersion } = require('../lib/migrations');

test('每種資料檔的 migration 步驟 to 從 1 開始連號，SCHEMA_VERSIONS 等於最後一步', () => {
  const kinds = Object.keys(MIGRATIONS);
  assert.deepEqual(kinds.sort(), [
    'conversations',
    'documents',
    'knowledge',
    'projectTemplates',
    'projects',
    'seededDefaults',
    'selectors',
    'state',
  ]);
  kinds.forEach((kind) => {
    MIGRATIONS[kind].forEach((step, i) => assert.equal(step.to, i + 1, `${kind} 第 ${i} 步`));
    assert.equal(SCHEMA_VERSIONS[kind], MIGRATIONS[kind].length);
  });
});

test('readVersion：沒有、非整數、負數都視為 0', () => {
  assert.equal(readVersion({}), 0);
  assert.equal(readVersion(null), 0);
  assert.equal(readVersion({ schemaVersion: '1' }), 0);
  assert.equal(readVersion({ schemaVersion: -1 }), 0);
  assert.equal(readVersion({ schemaVersion: 1.5 }), 0);
  assert.equal(readVersion({ schemaVersion: 3 }), 3);
});

test('migrate(projects)：舊專案補齊 tasks／issues／linkedDocumentIds／timeEntries，壞掉的 workflow 被丟掉', () => {
  const raw = {
    projects: [
      { id: 'p1', name: 'A', tasks: [{ id: 't1' }] },
      { id: 'p2', name: 'B', workflow: 'garbage' },
      'not-an-object',
    ],
  };
  const res = migrate('projects', raw);
  assert.equal(res.from, 0);
  assert.equal(res.to, SCHEMA_VERSIONS.projects);
  assert.equal(res.changed, true);
  assert.equal(res.data.schemaVersion, SCHEMA_VERSIONS.projects);
  assert.equal(res.data.projects.length, 2);
  const [p1, p2] = res.data.projects;
  assert.deepEqual(p1.issues, []);
  assert.deepEqual(p1.linkedDocumentIds, []);
  assert.deepEqual(p1.tasks[0].timeEntries, []);
  assert.deepEqual(p2.tasks, []);
  assert.equal('workflow' in p2, false);
  assert.equal('schemaVersion' in raw, false, '不改動傳進來的物件');
});

test('migrate(knowledge)：補 checklist／roleIds／systemPrompt／userPrompt 與 step.stage', () => {
  const res = migrate('knowledge', {
    items: [{ id: 'k1', title: 'T', content: 'C' }],
    groups: [{ id: 'g1', steps: [{ id: 's1', itemId: 'k1' }] }, { id: 'g2' }],
  });
  const it = res.data.items[0];
  assert.deepEqual([it.checklist, it.roleIds, it.systemPrompt, it.userPrompt], [[], [], '', '']);
  assert.equal(it.content, 'C');
  assert.equal(res.data.groups[0].steps[0].stage, '');
  assert.deepEqual(res.data.groups[1].steps, []);
});

test('migrate：conversations／documents／projectTemplates／state 的舊形狀', () => {
  const c = migrate('conversations', { conversations: [{ id: 'c1' }] }).data;
  assert.deepEqual([c.conversations[0].tags, c.conversations[0].linkedDocumentIds], [[], []]);
  assert.deepEqual(migrate('documents', {}).data.documents, []);
  assert.deepEqual(migrate('projectTemplates', { templates: 5 }).data.templates, []);
  const s = migrate('state', { accounts: [{ id: 'a' }], ui: 'x' }).data;
  assert.deepEqual([s.accounts.length, s.ui, s.extensions, s.roles], [1, {}, [], []]);
});

test('migrate 是冪等的：已經是最新形狀再跑一次內容不變，且 changed 為 false', () => {
  Object.keys(SCHEMA_VERSIONS).forEach((kind) => {
    const once = migrate(kind, { projects: [{ id: 'p' }], items: [{ id: 'i' }] });
    const twice = migrate(kind, once.data);
    assert.deepEqual(twice.data, once.data, kind);
    assert.equal(twice.changed, false, kind);
    // 強制從 0 重跑（備份匯入、寫檔前的做法）結果也一樣
    assert.deepEqual(migrate(kind, once.data, 0).data, once.data, kind);
  });
});

test('migrate：壞掉的輸入（null、陣列、字串）當成空檔', () => {
  [null, [], 'x', 3].forEach((raw) => {
    const res = migrate('projects', raw);
    assert.deepEqual(res.data.projects, []);
    assert.equal(res.from, 0);
  });
});

test('migrate：檔案版本比程式新（降版）時原樣回傳、不升級、標記 newer', () => {
  const raw = { schemaVersion: 99, projects: [{ id: 'p', futureField: 1 }] };
  const res = migrate('projects', raw);
  assert.equal(res.newer, true);
  assert.equal(res.changed, false);
  assert.equal(res.data, raw);
});

test('migrate 不認得的資料種類丟例外；stamp 把 schemaVersion 放最前面且覆蓋舊值', () => {
  assert.throws(() => migrate('nope', {}));
  assert.throws(() => stamp('nope', {}));
  const s = stamp('projects', { schemaVersion: 0, projects: [] });
  assert.deepEqual(Object.keys(s), ['schemaVersion', 'projects']);
  assert.equal(s.schemaVersion, SCHEMA_VERSIONS.projects);
});

// ---------------------------------------------------------------------------
// 整合：lib/stores.js 的讀寫（假 electron，同 projects-workflow-ipc.test.js）
// ---------------------------------------------------------------------------

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'platter-migrations-'));
const fakeElectron = {
  app: { getPath: () => tmpUserData },
  BrowserWindow: { getAllWindows: () => [] },
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
const stores = require('../lib/stores');
const { removeAllBackupFiles } = require('../lib/security');
Module._load = originalLoad;

test.after(() => {
  fs.rmSync(tmpUserData, { recursive: true, force: true });
});

const file = (name) => path.join(tmpUserData, name);
const readJson = (name) => JSON.parse(fs.readFileSync(file(name), 'utf8'));
const clean = () =>
  fs.readdirSync(tmpUserData).forEach((f) => fs.rmSync(file(f), { recursive: true, force: true }));

test('loadProjects：舊檔（沒有 schemaVersion）升級後寫回、補欄位，並留下 .v0.bak 原貌', () => {
  clean();
  const legacy = { projects: [{ id: 'p1', name: 'A', tasks: [{ id: 't1' }] }] };
  fs.writeFileSync(file('projects.json'), JSON.stringify(legacy));
  const projects = stores.loadProjects();
  assert.deepEqual(projects[0].linkedDocumentIds, []);
  assert.deepEqual(projects[0].tasks[0].timeEntries, []);
  const onDisk = readJson('projects.json');
  assert.equal(onDisk.schemaVersion, SCHEMA_VERSIONS.projects);
  assert.deepEqual(onDisk.projects[0].issues, []);
  assert.deepEqual(readJson('projects.json.v0.bak'), legacy);
});

test('loadProjects：已是最新版的檔案不重寫（內容與修改時間不變）', () => {
  clean();
  stores.saveProjects([{ id: 'p1', name: 'A' }]);
  const before = fs.statSync(file('projects.json')).mtimeMs;
  const text = fs.readFileSync(file('projects.json'), 'utf8');
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(file('projects.json'), old, old);
  stores.loadProjects();
  stores.loadProjects();
  assert.equal(fs.readFileSync(file('projects.json'), 'utf8'), text);
  assert.ok(fs.statSync(file('projects.json')).mtimeMs <= before - 50000, '沒有被重寫');
  assert.equal(fs.existsSync(file('projects.json.v0.bak')), false);
});

test('loadProjects：檔案版本比程式新時不改檔、資料原樣讀出', () => {
  clean();
  const future = { schemaVersion: 99, projects: [{ id: 'p', futureField: true }] };
  fs.writeFileSync(file('projects.json'), JSON.stringify(future));
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(stores.loadProjects()[0].futureField, true);
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(readJson('projects.json'), future);
});

test('各種 save 都蓋上 schemaVersion，且新紀錄缺的欄位在寫檔時補齊', () => {
  clean();
  stores.saveProjects([{ id: 'p1' }]);
  assert.deepEqual(
    [readJson('projects.json').schemaVersion, readJson('projects.json').projects[0].tasks],
    [SCHEMA_VERSIONS.projects, []]
  );
  stores.saveConversations([{ id: 'c1' }]);
  assert.deepEqual(readJson('conversations.json').conversations[0].tags, []);
  stores.saveDocuments([{ id: 'd1' }]);
  assert.equal(readJson('documents.json').schemaVersion, SCHEMA_VERSIONS.documents);
  stores.saveProjectTemplates([{ id: 'tp1' }]);
  assert.equal(readJson('project-templates.json').schemaVersion, SCHEMA_VERSIONS.projectTemplates);
  stores.saveKnowledgeBase({ items: [{ id: 'k1' }], groups: [] });
  assert.equal(readJson('knowledge-base.json').items[0].systemPrompt, '');
  assert.equal(readJson('knowledge-base.json').schemaVersion, SCHEMA_VERSIONS.knowledge);
});

test('selectors：版本鍵不會外洩給呼叫端，寫回時有版本；舊檔升級', () => {
  clean();
  fs.writeFileSync(file('selectors.json'), JSON.stringify({ claude: { input: 'x' } }));
  const sel = stores.loadSelectors();
  assert.equal('schemaVersion' in sel, false);
  assert.equal(sel.claude.input, 'x');
  assert.equal(readJson('selectors.json').schemaVersion, SCHEMA_VERSIONS.selectors);
  sel.claude.input = 'y';
  stores.saveSelectors(sel);
  assert.equal(readJson('selectors.json').claude.input, 'y');
  assert.equal('schemaVersion' in stores.loadSelectors(), false);
});

test('app-state.json：舊檔升級，deep merge 的 ui 預設仍生效；存檔帶版本', () => {
  clean();
  fs.writeFileSync(
    file('app-state.json'),
    JSON.stringify({ accounts: [{ id: 'a1', platform: 'claude', name: 'x' }], ui: {} })
  );
  stores.loadAppState();
  const state = require('../lib/state');
  assert.equal(state.appState.accounts.length, 1);
  assert.equal(typeof state.appState.ui.sidebarGroups, 'object');
  assert.ok(Array.isArray(state.appState.roles) && state.appState.roles.length > 0);
  assert.equal(readJson('app-state.json').schemaVersion, SCHEMA_VERSIONS.state);
  assert.ok(fs.existsSync(file('app-state.json.v0.bak')));
});

test('seeded-defaults.json 也有版本，且讀寫過程不遺失既有 key', () => {
  clean();
  fs.writeFileSync(file('seeded-defaults.json'), JSON.stringify({ roles: ['role_hr'] }));
  stores.loadKnowledgeBase(); // 會讀寫 seeded-defaults
  const rec = readJson('seeded-defaults.json');
  assert.equal(rec.schemaVersion, SCHEMA_VERSIONS.seededDefaults);
  assert.deepEqual(rec.roles, ['role_hr']);
  assert.ok(Array.isArray(rec.knowledgeBase));
});

test('removeAllBackupFiles 也清掉 schema 升級前的 .json.v<N>.bak', () => {
  clean();
  ['a.json.bak', 'b.json.v0.bak', 'c.json.v12.bak', 'keep.json', 'x.txt.bak'].forEach((f) =>
    fs.writeFileSync(file(f), '{}')
  );
  assert.equal(removeAllBackupFiles(tmpUserData), 3);
  assert.deepEqual(fs.readdirSync(tmpUserData).sort(), ['keep.json', 'x.txt.bak']);
});
