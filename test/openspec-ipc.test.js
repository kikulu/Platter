'use strict';

/**
 * test/openspec-ipc.test.js — OpenSpec 整合的 IPC 層：openspecInfo、匯入現有規格、匯出成
 * openspec/changes/<變更名稱>/。用假的 electron（dialog 回傳預先指定的資料夾／按鈕）直接呼叫
 * 真正的 handler。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'platter-osp-ipc-'));
const dialogState = { openPaths: [], canceled: false, messageResponse: 0, messages: [] };
const fakeElectron = {
  app: { getPath: () => tmpUserData },
  BrowserWindow: { getAllWindows: () => [] },
  Notification: class {
    static isSupported() {
      return false;
    }
  },
  dialog: {
    showOpenDialog: async () => ({
      canceled: dialogState.canceled,
      filePaths: dialogState.canceled ? [] : dialogState.openPaths,
    }),
    showMessageBox: async (win, opts) => {
      dialogState.messages.push(opts);
      return { response: dialogState.messageResponse };
    },
  },
};
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return fakeElectron;
  return originalLoad.call(this, request, ...rest);
};
const { registerProjectsIpc } = require('../lib/ipc/projects');
const { loadProjects } = require('../lib/stores');
Module._load = originalLoad;

const handlers = new Map();
registerProjectsIpc({ handle: (channel, fn) => handlers.set(channel, fn) });
const invoke = (channel, arg) => handlers.get(channel)({}, arg);

const tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'platter-osp-work-'));
test.after(() => {
  fs.rmSync(tmpUserData, { recursive: true, force: true });
  fs.rmSync(tmpWork, { recursive: true, force: true });
});

const getProject = (id) => loadProjects().find((p) => p.id === id);

async function createOpenSpec(topic = 'Reading club platform') {
  const res = await invoke('projects:createFromTemplate', {
    templateId: 'proj-tpl-openspec',
    topic,
  });
  assert.equal(res.ok, true);
  return res.projectId;
}
async function setOutput(projectId, artifact, output) {
  const step = getProject(projectId).workflow.steps.find((s) => s.artifact === artifact);
  await invoke('projects:workflow:updateStep', {
    projectId,
    stepId: step.id,
    patch: { output },
  });
}
function newTargetDir() {
  const dir = fs.mkdtempSync(path.join(tmpWork, 'target-'));
  dialogState.openPaths = [dir];
  dialogState.canceled = false;
  return dir;
}

test('OpenSpec 範本建立的專案：8 個步驟、artifact 與 useBaseContext 旗標都帶進專案', async () => {
  const projectId = await createOpenSpec();
  const wf = getProject(projectId).workflow;
  assert.equal(wf.steps.length, 8);
  assert.equal(wf.steps.filter((s) => s.artifact).length, 4);
  assert.equal(wf.steps.filter((s) => s.useBaseContext).length, 2);
});

test('projects:workflow:openspecInfo：非 OpenSpec 專案 available=false；OpenSpec 專案給建議名稱與檔案預覽', async () => {
  const sdd = await invoke('projects:createFromTemplate', {
    templateId: 'proj-tpl-sdd',
    topic: 'x',
  });
  assert.deepEqual(
    await invoke('projects:workflow:openspecInfo', { projectId: sdd.projectId }),
    {
      available: false,
    }
  );
  assert.deepEqual(
    await invoke('projects:workflow:openspecInfo', { projectId: 'nope' }),
    {
      available: false,
    }
  );

  const projectId = await createOpenSpec('Reading club platform');
  let info = await invoke('projects:workflow:openspecInfo', { projectId });
  assert.equal(info.available, true);
  assert.equal(info.changeId, 'reading-club-platform', '沒有 AI 建議時用主題轉出的名稱');
  assert.deepEqual(info.files, []);
  assert.equal(info.skipped.length, 4, '四個匯出步驟都還沒有產出');
  assert.equal(info.baseContext, null);

  await setOutput(
    projectId,
    'proposal.md',
    '# Proposal: X\n\n建議變更名稱：add-reading-club'
  );
  await setOutput(projectId, 'tasks.md', '# Tasks');
  info = await invoke('projects:workflow:openspecInfo', { projectId });
  assert.equal(info.changeId, 'add-reading-club', 'AI 在提案產出裡建議的名稱優先');
  assert.deepEqual(
    info.files.map((f) => f.path),
    ['proposal.md', 'tasks.md']
  );
  assert.equal(info.skipped.length, 2);
});

test('匯入現有規格：既有規格帶進差異規格步驟的提示詞（提案步驟不帶），清除後消失', async () => {
  const projectId = await createOpenSpec();
  const root = fs.mkdtempSync(path.join(tmpWork, 'existing-'));
  fs.mkdirSync(path.join(root, 'openspec', 'specs', 'auth'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'openspec', 'specs', 'auth', 'spec.md'),
    '# Auth\n### Requirement: Session Expiration\nThe system MUST expire sessions.'
  );
  dialogState.openPaths = [root];
  dialogState.canceled = false;

  const res = await invoke('projects:workflow:importOpenSpecSpecs', { projectId });
  assert.equal(res.ok, true);
  assert.equal(res.capabilityCount, 1);

  const wf = getProject(projectId).workflow;
  assert.equal(wf.baseContext.capabilityCount, 1);
  assert.equal(wf.baseContext.source, path.join(root, 'openspec', 'specs'));
  const specStep = wf.steps.find((s) => s.artifact === 'specs/general/spec.md');
  const proposalStep = wf.steps.find((s) => s.artifact === 'proposal.md');
  const withBase = await invoke('projects:workflow:compose', {
    projectId,
    stepId: specStep.id,
  });
  assert.ok(withBase.includes('### Requirement: Session Expiration'));
  assert.ok(
    !(
      await invoke('projects:workflow:compose', { projectId, stepId: proposalStep.id })
    ).includes('Session Expiration')
  );
  const info = await invoke('projects:workflow:openspecInfo', { projectId });
  assert.equal(info.baseContext.capabilityCount, 1);

  await invoke('projects:workflow:clearBaseContext', { projectId });
  assert.equal(getProject(projectId).workflow.baseContext, undefined);
  assert.ok(
    !(
      await invoke('projects:workflow:compose', { projectId, stepId: specStep.id })
    ).includes('Session Expiration')
  );
});

test('匯入現有規格：取消、找不到 specs 資料夾、沒有任何 capability 都回傳對應錯誤且不改資料', async () => {
  const projectId = await createOpenSpec();
  dialogState.canceled = true;
  assert.deepEqual(await invoke('projects:workflow:importOpenSpecSpecs', { projectId }), {
    ok: false,
    error: 'canceled',
  });

  dialogState.canceled = false;
  dialogState.openPaths = [fs.mkdtempSync(path.join(tmpWork, 'nospecs-'))];
  assert.equal(
    (await invoke('projects:workflow:importOpenSpecSpecs', { projectId })).error,
    'no-specs-dir'
  );

  const emptyRoot = fs.mkdtempSync(path.join(tmpWork, 'emptyspecs-'));
  fs.mkdirSync(path.join(emptyRoot, 'openspec', 'specs'), { recursive: true });
  dialogState.openPaths = [emptyRoot];
  assert.equal(
    (await invoke('projects:workflow:importOpenSpecSpecs', { projectId })).error,
    'no-specs'
  );

  assert.equal(getProject(projectId).workflow.baseContext, undefined);
  assert.equal(
    (await invoke('projects:workflow:importOpenSpecSpecs', { projectId: 'nope' })).error,
    'no-workflow'
  );
});

test('匯出：寫成 openspec/changes/<名稱>/ 的 proposal.md、specs/<capability>/spec.md、design.md、tasks.md', async () => {
  const projectId = await createOpenSpec();
  await setOutput(
    projectId,
    'proposal.md',
    '```markdown\n# Proposal: Reading club\n```\n建議變更名稱：add-reading-club'
  );
  await setOutput(
    projectId,
    'specs/general/spec.md',
    '=== FILE: specs/membership/spec.md ===\n# Delta for Membership\n=== FILE: specs/events/spec.md ===\n# Delta for Events'
  );
  await setOutput(projectId, 'tasks.md', '# Tasks\n- [ ] 1.1 x');
  const target = newTargetDir();

  const res = await invoke('projects:workflow:exportOpenSpec', {
    projectId,
    changeId: 'add-reading-club',
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.files, [
    'openspec/changes/add-reading-club/proposal.md',
    'openspec/changes/add-reading-club/specs/membership/spec.md',
    'openspec/changes/add-reading-club/specs/events/spec.md',
    'openspec/changes/add-reading-club/tasks.md',
  ]);
  assert.equal(res.skipped.length, 1, 'design.md 沒有產出');
  const base = path.join(target, 'openspec', 'changes', 'add-reading-club');
  assert.equal(
    fs.readFileSync(path.join(base, 'proposal.md'), 'utf-8'),
    '# Proposal: Reading club\n'
  );
  assert.equal(
    fs.readFileSync(path.join(base, 'specs', 'events', 'spec.md'), 'utf-8'),
    '# Delta for Events\n'
  );
  assert.ok(!fs.existsSync(path.join(base, 'design.md')));
});

test('匯出：不合法的變更名稱、沒有可匯出內容、取消選資料夾都不會寫任何檔案', async () => {
  const projectId = await createOpenSpec();
  const target = newTargetDir();
  for (const bad of ['Add Dark', '../evil', '', undefined]) {
    assert.equal(
      (await invoke('projects:workflow:exportOpenSpec', { projectId, changeId: bad }))
        .error,
      'invalid-change-id'
    );
  }
  assert.equal(
    (await invoke('projects:workflow:exportOpenSpec', { projectId, changeId: 'ok-name' }))
      .error,
    'nothing-to-export'
  );

  await setOutput(projectId, 'tasks.md', '# Tasks');
  dialogState.canceled = true;
  assert.equal(
    (await invoke('projects:workflow:exportOpenSpec', { projectId, changeId: 'ok-name' }))
      .error,
    'canceled'
  );
  assert.deepEqual(fs.readdirSync(target), []);
  assert.equal(
    (
      await invoke('projects:workflow:exportOpenSpec', {
        projectId: 'nope',
        changeId: 'a',
      })
    ).error,
    'no-workflow'
  );
});

test('匯出：目標已有同名檔案時要確認才覆蓋；選取消不動原檔', async () => {
  const projectId = await createOpenSpec();
  await setOutput(projectId, 'tasks.md', '# Tasks v2');
  const target = newTargetDir();
  const file = path.join(target, 'openspec', 'changes', 'chg', 'tasks.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'ORIGINAL');

  dialogState.messages = [];
  dialogState.messageResponse = 1; // 取消
  let res = await invoke('projects:workflow:exportOpenSpec', {
    projectId,
    changeId: 'chg',
  });
  assert.equal(res.error, 'canceled');
  assert.equal(fs.readFileSync(file, 'utf-8'), 'ORIGINAL');
  assert.equal(dialogState.messages.length, 1);
  assert.ok(dialogState.messages[0].detail.includes('tasks.md'));

  dialogState.messageResponse = 0; // 覆蓋
  res = await invoke('projects:workflow:exportOpenSpec', { projectId, changeId: 'chg' });
  assert.equal(res.ok, true);
  assert.equal(fs.readFileSync(file, 'utf-8'), '# Tasks v2\n');
});

test('匯出：AI 產出裡的穿越路徑標記不會寫出變更資料夾之外', async () => {
  const projectId = await createOpenSpec();
  await setOutput(
    projectId,
    'specs/general/spec.md',
    '=== FILE: ../../../../pwned.md ===\nhack\n=== FILE: specs/ok/spec.md ===\nfine'
  );
  const target = newTargetDir();
  const res = await invoke('projects:workflow:exportOpenSpec', {
    projectId,
    changeId: 'safe',
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.files, ['openspec/changes/safe/specs/ok/spec.md']);
  assert.ok(!fs.existsSync(path.join(target, 'pwned.md')));
  assert.ok(!fs.existsSync(path.join(path.dirname(target), 'pwned.md')));
  const info = await invoke('projects:workflow:openspecInfo', { projectId });
  assert.equal(info.rejected.length, 1);
});
