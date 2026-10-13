'use strict';

/**
 * test/stage-prompts-edit.test.js
 *
 * 功能 C：階段提示詞（workflow.stagePrompts）可編輯，並可從知識庫重新整理。
 *   - lib/workflow.js 的純函式：新增／修改／移除／比對／套用
 *   - IPC：projects:workflow:stagePrompt:*；一般 projects:save 不會用過期的 workflow 蓋掉
 *   - 舊專案（stagePrompts 沒有來源欄位）可以正常運作
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const {
  addStagePrompt,
  updateStagePrompt,
  removeStagePrompt,
  diffStagePromptsWithSource,
  applyStagePromptUpdates,
  normalizeWorkflow,
} = require('../lib/workflow');

function makeWorkflow() {
  return {
    steps: [],
    stagePrompts: [
      { id: 'a', stage: 'S1', title: 'A', prompt: 'old A', sourceDefaultId: 'kb-x' },
      { id: 'b', stage: 'S1', title: 'B', prompt: 'custom B' },
      { id: 'c', stage: 'S2', title: 'C', prompt: 'same C', sourceItemId: 'item-c' },
      { id: 'd', stage: 'S2', title: 'D', prompt: 'D', sourceItemId: 'gone' },
    ],
  };
}

const resolver = (sp) => {
  const table = {
    'kb-x': { title: 'A', prompt: 'new A' },
    'item-c': { title: 'C', prompt: 'same C' },
  };
  return table[sp.sourceDefaultId || sp.sourceItemId] || null;
};

test('addStagePrompt／updateStagePrompt／removeStagePrompt', () => {
  const wf = { stagePrompts: [] };
  assert.equal(addStagePrompt(wf, { stage: 'S1', title: 'x', prompt: '  ' }), null);
  const item = addStagePrompt(wf, { stage: 'S1', title: ' 標題 ', prompt: '內容' });
  assert.equal(item.title, '標題');
  assert.equal(item.sourceItemId, null);
  assert.equal(wf.stagePrompts.length, 1);
  assert.equal(addStagePrompt({}, { stage: 'S', prompt: 'p' }).stage, 'S'); // 舊專案沒有陣列也行

  assert.equal(updateStagePrompt(wf, item.id, { title: '新標題', prompt: '新內容' }), true);
  assert.equal(wf.stagePrompts[0].title, '新標題');
  assert.equal(updateStagePrompt(wf, item.id, { prompt: '   ' }), false); // 不接受空內容
  assert.equal(updateStagePrompt(wf, 'nope', { title: 'x' }), false);

  assert.equal(removeStagePrompt(wf, 'nope'), false);
  assert.equal(removeStagePrompt(wf, item.id), true);
  assert.equal(wf.stagePrompts.length, 0);
});

test('diffStagePromptsWithSource／applyStagePromptUpdates：只處理有來源且有差異的項目', () => {
  const wf = makeWorkflow();
  const { changes, missing } = diffStagePromptsWithSource(wf, resolver);
  assert.deepEqual(
    changes.map((c) => c.id),
    ['a']
  );
  assert.equal(changes[0].currentPrompt, 'old A');
  assert.equal(changes[0].sourcePrompt, 'new A');
  assert.deepEqual(
    missing.map((m) => m.id),
    ['d']
  );

  // 只套用被勾選的；自訂項目（沒有來源）即使被指定也不會動
  assert.equal(applyStagePromptUpdates(wf, ['a', 'b'], resolver), 1);
  assert.equal(wf.stagePrompts[0].prompt, 'new A');
  assert.equal(wf.stagePrompts[1].prompt, 'custom B');
  assert.deepEqual(diffStagePromptsWithSource(wf, resolver).changes, []);
});

test('normalizeWorkflow：舊資料沒有來源欄位時補成 null，不壞', () => {
  const wf = normalizeWorkflow({
    steps: [{ id: 's1', stage: 'S1', title: 't', prompt: 'p' }],
    stagePrompts: [{ id: 'x', stage: 'S1', title: 'T', prompt: 'P' }],
  });
  assert.equal(wf.stagePrompts[0].sourceItemId, null);
  assert.equal(wf.stagePrompts[0].sourceDefaultId, null);
});

// ----- IPC -----
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'platter-sp-edit-'));
const fakeElectron = {
  app: { getPath: () => tmpUserData },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {},
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
const { loadProjects, loadKnowledgeBase } = require('../lib/stores');
Module._load = originalLoad;

const handlers = new Map();
registerProjectsIpc({ handle: (channel, fn) => handlers.set(channel, fn) });
const invoke = (channel, arg) => handlers.get(channel)({}, arg);

test.after(() => {
  fs.rmSync(tmpUserData, { recursive: true, force: true });
});

async function createSdd() {
  const res = await invoke('projects:createFromTemplate', {
    templateId: 'proj-tpl-sdd',
    topic: '測試專案',
  });
  assert.equal(res.ok, true);
  return res.projectId;
}
const wfOf = (id) => loadProjects().find((p) => p.id === id).workflow;

test('範本建立的階段提示詞帶有內建來源；自訂新增、從知識庫新增、編輯、移除', async () => {
  const pid = await createSdd();
  const initial = wfOf(pid).stagePrompts;
  assert.ok(initial.length > 0);
  assert.ok(initial.every((p) => p.sourceDefaultId), '範本帶入的都記得內建來源');
  const stage = initial[0].stage;

  await invoke('projects:workflow:stagePrompt:add', {
    projectId: pid,
    stage,
    title: '我的提示詞',
    prompt: '自訂內容',
  });
  let list = wfOf(pid).stagePrompts;
  const custom = list.find((p) => p.title === '我的提示詞');
  assert.equal(custom.sourceItemId, null);
  assert.equal(custom.sourceDefaultId, null);

  // 空內容不新增
  await invoke('projects:workflow:stagePrompt:add', { projectId: pid, stage, prompt: ' ' });
  assert.equal(wfOf(pid).stagePrompts.length, initial.length + 1);

  // 從知識庫挑一個
  const kbItem = loadKnowledgeBase().items.find((it) => it.id);
  await invoke('projects:workflow:stagePrompt:add', {
    projectId: pid,
    stage,
    sourceItemId: kbItem.id,
  });
  list = wfOf(pid).stagePrompts;
  const fromKb = list[list.length - 1];
  assert.equal(fromKb.sourceItemId, kbItem.id);
  assert.equal(fromKb.title, kbItem.title);

  // 不存在的知識庫項目不新增
  const before = wfOf(pid).stagePrompts.length;
  await invoke('projects:workflow:stagePrompt:add', {
    projectId: pid,
    stage,
    sourceItemId: 'no-such-item',
  });
  assert.equal(wfOf(pid).stagePrompts.length, before);

  await invoke('projects:workflow:stagePrompt:update', {
    projectId: pid,
    id: custom.id,
    patch: { title: '改過', prompt: '改過的內容' },
  });
  assert.equal(wfOf(pid).stagePrompts.find((p) => p.id === custom.id).prompt, '改過的內容');

  await invoke('projects:workflow:stagePrompt:remove', { projectId: pid, id: custom.id });
  assert.equal(
    wfOf(pid).stagePrompts.some((p) => p.id === custom.id),
    false
  );
});

test('從知識庫重新整理：編輯過的內建來源項目被偵測到，套用後恢復；自訂項目不受影響', async () => {
  const pid = await createSdd();
  const stage = wfOf(pid).stagePrompts[0].stage;
  assert.deepEqual(
    (await invoke('projects:workflow:stagePrompt:checkUpdates', { projectId: pid })).changes,
    []
  );

  const target = wfOf(pid).stagePrompts[0];
  const originalPrompt = target.prompt;
  await invoke('projects:workflow:stagePrompt:update', {
    projectId: pid,
    id: target.id,
    patch: { prompt: '我自己改過' },
  });
  await invoke('projects:workflow:stagePrompt:add', {
    projectId: pid,
    stage,
    title: '自訂',
    prompt: '自訂內容',
  });

  const check = await invoke('projects:workflow:stagePrompt:checkUpdates', { projectId: pid });
  assert.deepEqual(
    check.changes.map((c) => c.id),
    [target.id]
  );
  assert.equal(check.changes[0].currentPrompt, '我自己改過');
  assert.equal(check.changes[0].sourcePrompt, originalPrompt);
  // 只比對、不寫檔
  assert.equal(wfOf(pid).stagePrompts[0].prompt, '我自己改過');

  await invoke('projects:workflow:stagePrompt:applyUpdates', {
    projectId: pid,
    ids: [target.id],
  });
  assert.equal(wfOf(pid).stagePrompts[0].prompt, originalPrompt);
  assert.ok(wfOf(pid).stagePrompts.some((p) => p.prompt === '自訂內容'));
});

test('一般 projects:save 不會用過期的 workflow／stagePrompts 蓋掉較新的內容', async () => {
  const pid = await createSdd();
  const project = loadProjects().find((p) => p.id === pid);
  const stale = JSON.parse(JSON.stringify(project));
  await invoke('projects:workflow:stagePrompt:add', {
    projectId: pid,
    stage: project.workflow.stagePrompts[0].stage,
    title: '新加的',
    prompt: '新加的內容',
  });
  // 模擬渲染層（或舊版呼叫端）送來含過期 workflow 的專案物件
  await invoke('projects:save', { ...stale, name: '改了名字' });
  const after = loadProjects().find((p) => p.id === pid);
  assert.equal(after.name, '改了名字');
  assert.ok(after.workflow.stagePrompts.some((p) => p.title === '新加的'));
});
