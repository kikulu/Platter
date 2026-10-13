'use strict';

/**
 * test/tray-project-mode.test.js
 *
 * 功能 B：托盤「專案任務與階段提示詞」區塊的顯示範圍可設定。
 *   - buildTrayProjectGroups(projects, accounts, mode)：assigned（預設）／current
 *   - trayProjectEmptyReason()：區塊為空時的原因
 *   - normalizeTrayPrefs()：舊設定沒有欄位、欄位壞掉時走預設
 *   - IPC：tray:projectPrompts 回傳 { groups, mode, emptyReason }；settings:setTrayPrefs 只收白名單欄位
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const { buildTrayProjectGroups, trayProjectEmptyReason } = require('../lib/workflow');
const { normalizeTrayPrefs } = require('../lib/utils');

function makeProject(overrides = {}) {
  return {
    id: 'p1',
    name: '專案一',
    status: 'planning',
    tasks: [
      { id: 't1', title: '1-1 企劃', status: 'done', assigneeId: 'acc1' },
      { id: 't2', title: '1-2 撰寫', status: 'todo', assigneeId: null },
      { id: 't3', title: '2-1 發佈', status: 'todo', assigneeId: 'acc1' },
    ],
    workflow: {
      currentStepId: 's2',
      steps: [
        { id: 's1', stage: 'A', title: '企劃', status: 'done', taskId: 't1' },
        { id: 's2', stage: 'A', title: '撰寫', status: 'todo', taskId: 't2' },
        { id: 's3', stage: 'B', title: '發佈', status: 'todo', taskId: 't3' },
      ],
      stagePrompts: [{ id: 'sp1', stage: 'A', title: '檢查表', prompt: '請檢查' }],
    },
    ...overrides,
  };
}
const accounts = [{ id: 'acc1', name: '小明' }];

test('assigned（預設）：只列已指派且未完成的任務，行為與 1.40.0 相同', () => {
  const groups = buildTrayProjectGroups([makeProject()], accounts);
  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0].stages.map((s) => [s.stage, s.tasks.map((t) => t.taskId)]),
    [['B', ['t3']]]
  );
  // 明確指定 'assigned' 結果相同；未知模式視同預設
  assert.deepEqual(buildTrayProjectGroups([makeProject()], accounts, 'assigned'), groups);
  assert.deepEqual(buildTrayProjectGroups([makeProject()], accounts, 'weird'), groups);
});

test('current：列出目前步驟的任務，不論有沒有指派，並附該階段提示詞', () => {
  const groups = buildTrayProjectGroups([makeProject()], accounts, 'current');
  assert.equal(groups.length, 1);
  const stage = groups[0].stages[0];
  assert.equal(stage.stage, 'A');
  assert.deepEqual(
    stage.tasks.map((t) => [t.taskId, t.assigneeId, t.assigneeName]),
    [['t2', null, '']]
  );
  assert.deepEqual(
    stage.prompts.map((p) => p.id),
    ['sp1']
  );
});

test('current：目前步驟已完成時改取第一個未完成的；全部完成或專案完成則不出現', () => {
  const p = makeProject();
  p.workflow.currentStepId = 's1'; // 指到已完成的步驟
  const g = buildTrayProjectGroups([p], accounts, 'current');
  assert.equal(g[0].stages[0].tasks[0].taskId, 't2');

  const allDone = makeProject();
  allDone.workflow.steps.forEach((s) => (s.status = 'done'));
  assert.deepEqual(buildTrayProjectGroups([allDone], accounts, 'current'), []);

  assert.deepEqual(
    buildTrayProjectGroups([makeProject({ status: 'done' })], accounts, 'current'),
    []
  );
  // 沒有 workflow 的專案略過
  assert.deepEqual(
    buildTrayProjectGroups([{ id: 'x', status: 'planning', tasks: [] }], accounts, 'current'),
    []
  );
});

test('trayProjectEmptyReason：依模式說明為什麼是空的', () => {
  const unassigned = makeProject();
  unassigned.tasks.forEach((t) => (t.assigneeId = null)); // 模擬從範本建立、任務都沒指派
  assert.deepEqual(buildTrayProjectGroups([unassigned], accounts, 'assigned'), []);
  assert.equal(trayProjectEmptyReason([unassigned], 'assigned'), 'unassigned');
  // 同一份資料換成 current 模式就有內容，所以不需要說明
  assert.equal(buildTrayProjectGroups([unassigned], accounts, 'current').length, 1);
  assert.equal(trayProjectEmptyReason([unassigned], 'current'), null);

  const allDone = makeProject();
  allDone.workflow.steps.forEach((s) => (s.status = 'done'));
  assert.equal(trayProjectEmptyReason([allDone], 'assigned'), 'allDone');
  assert.equal(trayProjectEmptyReason([allDone], 'current'), 'allDone');

  assert.equal(trayProjectEmptyReason([], 'assigned'), null);
  assert.equal(trayProjectEmptyReason([makeProject({ status: 'done' })], 'assigned'), null);
});

test('normalizeTrayPrefs：缺欄位、型別錯、超出範圍都退回預設', () => {
  assert.deepEqual(normalizeTrayPrefs(undefined), {
    projectMode: 'assigned',
    hotkeyEnabled: false,
    hotkey: 'CommandOrControl+Shift+P',
    recentLimit: 5,
    recent: [],
  });
  const bad = normalizeTrayPrefs({
    projectMode: 'x',
    hotkeyEnabled: 'yes',
    hotkey: '  ',
    recentLimit: 999,
    recent: ['a', 'a', 3, '', 'b'],
  });
  assert.equal(bad.projectMode, 'assigned');
  assert.equal(bad.hotkeyEnabled, false);
  assert.equal(bad.hotkey, 'CommandOrControl+Shift+P');
  assert.equal(bad.recentLimit, 20);
  assert.deepEqual(bad.recent, ['a', 'b']);
  assert.equal(normalizeTrayPrefs({ recentLimit: -3 }).recentLimit, 0);
  assert.equal(normalizeTrayPrefs({ projectMode: 'current' }).projectMode, 'current');
});

// ----- IPC -----
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'platter-tray-mode-'));
const fakeElectron = {
  app: { getPath: () => tmpUserData },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {},
  session: {},
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
const { registerProjectsIpc } = require('../lib/ipc/projects');
const { registerSettingsIpc } = require('../lib/ipc/settings');
const { loadAppState } = require('../lib/stores');
Module._load = originalLoad;

const handlers = new Map();
const ipc = { handle: (channel, fn) => handlers.set(channel, fn) };
registerProjectsIpc(ipc);
registerSettingsIpc(ipc);
const invoke = (channel, arg) => handlers.get(channel)({}, arg);

test.after(() => {
  fs.rmSync(tmpUserData, { recursive: true, force: true });
});

test('IPC：從範本新建的專案（任務未指派）在兩種模式下的托盤資料與設定儲存', async () => {
  loadAppState();
  assert.equal((await invoke('settings:getTrayPrefs')).projectMode, 'assigned');

  const created = await invoke('projects:createFromTemplate', {
    templateId: 'proj-tpl-sdd',
    topic: '測試',
  });
  assert.equal(created.ok, true);

  const assigned = await invoke('tray:projectPrompts');
  assert.deepEqual(assigned.groups, []);
  assert.equal(assigned.mode, 'assigned');
  assert.equal(assigned.emptyReason, 'unassigned');

  const prefs = await invoke('settings:setTrayPrefs', {
    projectMode: 'current',
    evil: 'ignored',
  });
  assert.equal(prefs.projectMode, 'current');
  assert.equal(prefs.evil, undefined);
  assert.equal((await invoke('settings:getTrayPrefs')).projectMode, 'current');

  const current = await invoke('tray:projectPrompts');
  assert.equal(current.mode, 'current');
  assert.equal(current.emptyReason, null);
  assert.equal(current.groups.length, 1);
  assert.equal(current.groups[0].stages[0].tasks.length, 1);
  assert.equal(current.groups[0].stages[0].tasks[0].assigneeId, null);

  // 壞值被正規化回預設
  const fixed = await invoke('settings:setTrayPrefs', { projectMode: 'nonsense' });
  assert.equal(fixed.projectMode, 'assigned');
});
