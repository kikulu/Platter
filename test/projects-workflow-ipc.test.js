'use strict';

/**
 * test/projects-workflow-ipc.test.js
 *
 * 專案範本與階段流程（workflow）的 IPC 層：從範本建立專案、步驟狀態與任務狀態同步、
 * 組合提示詞、更新產出、另存範本、刪除範本、既有的「儲存專案」不會蓋掉 workflow。
 * 用假的 electron 在一般 Node.js 環境直接呼叫真正的 handler（同 knowledge-bundles-ipc.test.js）。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'platter-wf-ipc-'));
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
const { registerProjectsIpc } = require('../lib/ipc/projects');
const { searchGlobal } = require('../lib/ipc/search');
const { loadProjects } = require('../lib/stores');
Module._load = originalLoad;

const handlers = new Map();
registerProjectsIpc({ handle: (channel, fn) => handlers.set(channel, fn) });
const invoke = (channel, arg) => handlers.get(channel)({}, arg);

const projectsFile = path.join(tmpUserData, 'projects.json');
const templatesFile = path.join(tmpUserData, 'project-templates.json');
const knowledgeFile = path.join(tmpUserData, 'knowledge-base.json');
const seededFile = path.join(tmpUserData, 'seeded-defaults.json');

function reset() {
  [projectsFile, templatesFile, knowledgeFile, seededFile].forEach((f) => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });
}

test.after(() => {
  fs.rmSync(tmpUserData, { recursive: true, force: true });
});

async function createSdd(topic = '線上讀書會平台', name) {
  const res = await invoke('projects:createFromTemplate', {
    templateId: 'proj-tpl-sdd',
    topic,
    name,
  });
  assert.equal(res.ok, true);
  return res;
}
const getProject = (id) => loadProjects().find((p) => p.id === id);

test('projectTemplates:list：內建範本在前，只有預覽（階段/步驟標題），不含提示詞內容', async () => {
  reset();
  const list = await invoke('projectTemplates:list');
  assert.ok(list.length >= 4);
  assert.ok(list.every((t) => t.builtIn));
  const sdd = list.find((t) => t.id === 'proj-tpl-sdd');
  assert.deepEqual(
    sdd.stages.map((st) => st.steps.length),
    [3, 2, 2]
  );
  assert.equal(sdd.stages[0].steps[0].title, 'SDD 專案原則（Constitution）');
  assert.ok(!JSON.stringify(list).includes('角色與目標'), '清單不含提示詞全文');
});

test('projects:createFromTemplate：建立專案、workflow 與一步一任務，並存檔', async () => {
  reset();
  const { projectId, projects } = await createSdd('線上讀書會平台');
  assert.equal(projects.length, 1);
  const p = getProject(projectId);
  assert.equal(p.name, '線上讀書會平台'); // 沒填名稱就用主題
  assert.equal(p.status, 'planning');
  assert.ok(p.description.includes('SDD 規格驅動開發'));
  assert.equal(p.workflow.topic, '線上讀書會平台');
  assert.equal(p.workflow.steps.length, 7);
  assert.equal(p.tasks.length, 7);
  assert.equal(p.workflow.currentStepId, p.workflow.steps[0].id);
  p.workflow.steps.forEach((s, i) => assert.equal(s.taskId, p.tasks[i].id));
  assert.equal(p.tasks[0].title, '1-1 SDD 專案原則（Constitution）');
  assert.equal(p.tasks[6].title, '3-2 SDD 依任務實作（Implement）');
  // 提示詞已經快照進專案
  assert.ok(p.workflow.steps[1].prompt.includes('功能規格撰寫'));

  const named = await createSdd('主題B', '  自訂專案名稱 ');
  assert.equal(getProject(named.projectId).name, '自訂專案名稱');
});

test('projects:createFromTemplate：主題空白、範本不存在時回傳錯誤，不建立專案', async () => {
  reset();
  assert.deepEqual(
    await invoke('projects:createFromTemplate', {
      templateId: 'proj-tpl-sdd',
      topic: '  ',
    }),
    {
      ok: false,
      error: 'topic-required',
    }
  );
  assert.deepEqual(
    await invoke('projects:createFromTemplate', { templateId: 'nope', topic: 'x' }),
    {
      ok: false,
      error: 'template-not-found',
    }
  );
  assert.equal(loadProjects().length, 0);
});

test('建立專案用的是「使用者知識庫裡的版本」：調整過知識庫提示詞，之後建立的專案跟著變；已建立的專案不受影響', async () => {
  reset();
  const before = await createSdd('先建立的專案');
  // 使用者把 SDD 規格提示詞改成自己的版本
  const kb = JSON.parse(fs.readFileSync(knowledgeFile, 'utf-8'));
  const item = kb.items.find((it) => it.defaultId === 'kb-default-043');
  item.content = '# 我改過的規格提示詞\n' + '內容'.repeat(80);
  fs.writeFileSync(knowledgeFile, JSON.stringify(kb));

  const after = await createSdd('後建立的專案');
  assert.ok(
    getProject(after.projectId).workflow.steps[1].prompt.startsWith(
      '# 我改過的規格提示詞'
    )
  );
  assert.ok(
    getProject(before.projectId).workflow.steps[1].prompt.includes(
      '功能規格撰寫（Specify）'
    )
  );

  // 使用者把該項目刪掉：退回內建檔內容，仍可建立完整流程
  kb.items = kb.items.filter((it) => it.defaultId !== 'kb-default-043');
  fs.writeFileSync(knowledgeFile, JSON.stringify(kb));
  // 標記已種過，避免 loadKnowledgeBase() 的增量補種又把它補回來
  const seeded = JSON.parse(fs.readFileSync(seededFile, 'utf-8'));
  assert.ok(seeded.knowledgeBase.includes('kb-default-043'));
  const third = await createSdd('第三個專案');
  assert.equal(getProject(third.projectId).workflow.steps.length, 7);
  assert.ok(
    getProject(third.projectId).workflow.steps[1].prompt.includes(
      '功能規格撰寫（Specify）'
    )
  );
});

test('projects:workflow:setStepStatus：同步對應任務狀態，完成時「目前步驟」移到下一步', async () => {
  reset();
  const { projectId } = await createSdd();
  const [s1, s2] = getProject(projectId).workflow.steps;

  await invoke('projects:workflow:setStepStatus', {
    projectId,
    stepId: s1.id,
    status: 'doing',
  });
  let p = getProject(projectId);
  assert.equal(p.workflow.steps[0].status, 'doing');
  assert.equal(p.tasks[0].status, 'doing');
  assert.equal(p.workflow.currentStepId, s1.id, '進行中不移動');

  await invoke('projects:workflow:setStepStatus', {
    projectId,
    stepId: s1.id,
    status: 'done',
  });
  p = getProject(projectId);
  assert.equal(p.tasks[0].status, 'done');
  assert.equal(p.workflow.currentStepId, s2.id);

  // 不合法的狀態、不存在的步驟都不會改資料
  await invoke('projects:workflow:setStepStatus', {
    projectId,
    stepId: s2.id,
    status: '亂',
  });
  await invoke('projects:workflow:setStepStatus', {
    projectId,
    stepId: 'nope',
    status: 'done',
  });
  p = getProject(projectId);
  assert.equal(p.workflow.steps[1].status, 'todo');
  assert.equal(p.tasks[1].status, 'todo');
});

test('projects:workflow:setStepStatus：對應任務被使用者刪掉時不會出錯，步驟狀態仍然更新', async () => {
  reset();
  const { projectId } = await createSdd();
  const p = getProject(projectId);
  const stepId = p.workflow.steps[0].id;
  const saved = JSON.parse(fs.readFileSync(projectsFile, 'utf-8'));
  saved.projects[0].tasks = saved.projects[0].tasks.slice(1);
  fs.writeFileSync(projectsFile, JSON.stringify(saved));

  await invoke('projects:workflow:setStepStatus', { projectId, stepId, status: 'done' });
  assert.equal(getProject(projectId).workflow.steps[0].status, 'done');
});

test('projects:workflow:updateStep / setMeta / compose：貼回產出後，下一步的提示詞會帶入主題與前面產出', async () => {
  reset();
  const { projectId } = await createSdd('線上讀書會平台');
  const [s1, s2] = getProject(projectId).workflow.steps;

  await invoke('projects:workflow:updateStep', {
    projectId,
    stepId: s1.id,
    patch: { output: '這是專案原則的產出', bogus: 'x' },
  });
  assert.equal(getProject(projectId).workflow.steps[0].output, '這是專案原則的產出');
  assert.equal(
    getProject(projectId).workflow.steps[0].bogus,
    undefined,
    '只接受 output/prompt/title'
  );

  let text = await invoke('projects:workflow:compose', { projectId, stepId: s2.id });
  assert.ok(text.includes('# 專案主題\n線上讀書會平台'));
  assert.ok(text.includes('## 1-1 SDD 專案原則（Constitution）\n這是專案原則的產出'));
  assert.ok(text.includes('功能規格撰寫（Specify）'));

  await invoke('projects:workflow:setMeta', {
    projectId,
    contextMode: 'none',
    topic: ' 新主題 ',
  });
  text = await invoke('projects:workflow:compose', { projectId, stepId: s2.id });
  assert.ok(text.includes('# 專案主題\n新主題'));
  assert.ok(!text.includes('這是專案原則的產出'));

  await invoke('projects:workflow:setMeta', { projectId, currentStepId: s2.id });
  assert.equal(getProject(projectId).workflow.currentStepId, s2.id);
  await invoke('projects:workflow:setMeta', { projectId, currentStepId: 'nope' });
  assert.equal(
    getProject(projectId).workflow.currentStepId,
    s2.id,
    '不存在的步驟 id 不會被接受'
  );

  // 使用者在專案內改提示詞與標題
  await invoke('projects:workflow:updateStep', {
    projectId,
    stepId: s2.id,
    patch: { prompt: '我改過的提示詞', title: '我改過的標題' },
  });
  text = await invoke('projects:workflow:compose', { projectId, stepId: s2.id });
  assert.ok(text.includes('我改過的提示詞') && text.includes('我改過的標題'));

  assert.equal(
    await invoke('projects:workflow:compose', { projectId: 'nope', stepId: s1.id }),
    ''
  );
});

test('projects:save：一般「儲存專案」不會蓋掉 workflow（渲染層送來的專案物件沒有這個欄位）', async () => {
  reset();
  const { projectId } = await createSdd();
  const p = getProject(projectId);
  await invoke('projects:workflow:updateStep', {
    projectId,
    stepId: p.workflow.steps[0].id,
    patch: { output: '不能被蓋掉的產出' },
  });
  const current = getProject(projectId);
  // 模擬渲染層：只送表單欄位 + tasks + issues
  await invoke('projects:save', {
    id: projectId,
    name: '改過名稱',
    status: 'active',
    startDate: null,
    endDate: null,
    description: current.description,
    tasks: current.tasks,
    issues: [],
  });
  const after = getProject(projectId);
  assert.equal(after.name, '改過名稱');
  assert.equal(after.workflow.steps[0].output, '不能被蓋掉的產出');
  assert.equal(after.workflow.steps.length, 7);
});

test('projects:workflow:saveAsTemplate：另存使用者範本（含專案內改過的提示詞），可用它再建立專案，也可刪除；內建範本不能刪', async () => {
  reset();
  const { projectId } = await createSdd();
  const p = getProject(projectId);
  await invoke('projects:workflow:updateStep', {
    projectId,
    stepId: p.workflow.steps[0].id,
    patch: { prompt: '我的專屬第一步提示詞。'.repeat(20) },
  });

  const saved = await invoke('projects:workflow:saveAsTemplate', {
    projectId,
    name: '我的 SDD 變體',
    description: '團隊版',
  });
  assert.equal(saved.ok, true);

  const list = await invoke('projectTemplates:list');
  const custom = list.find((t) => t.id === saved.templateId);
  assert.equal(custom.builtIn, false);
  assert.equal(custom.name, '我的 SDD 變體');
  assert.equal(list[list.length - 1].id, saved.templateId, '自訂範本排在內建之後');
  assert.deepEqual(
    custom.stages.map((st) => st.steps.length),
    [3, 2, 2]
  );

  const again = await invoke('projects:createFromTemplate', {
    templateId: saved.templateId,
    topic: '另一個主題',
  });
  assert.equal(again.ok, true);
  const q = getProject(again.projectId);
  assert.equal(q.workflow.steps.length, 7);
  assert.ok(q.workflow.steps[0].prompt.startsWith('我的專屬第一步提示詞'));
  assert.equal(q.workflow.steps[0].output, '', '不帶產出');
  assert.equal(q.workflow.steps[0].status, 'todo');

  assert.deepEqual(await invoke('projectTemplates:delete', 'proj-tpl-sdd'), {
    ok: false,
  });
  assert.deepEqual(await invoke('projectTemplates:delete', saved.templateId), {
    ok: true,
  });
  assert.ok(
    !(await invoke('projectTemplates:list')).some((t) => t.id === saved.templateId)
  );

  assert.deepEqual(
    await invoke('projects:workflow:saveAsTemplate', { projectId: 'nope', name: 'x' }),
    { ok: false, error: 'no-workflow' }
  );
});

test('每組內建範本都能建立專案，且任務數 = 步驟數', async () => {
  reset();
  const list = await invoke('projectTemplates:list');
  for (const tpl of list) {
    const res = await invoke('projects:createFromTemplate', {
      templateId: tpl.id,
      topic: '測試',
    });
    assert.equal(res.ok, true, tpl.name);
    const p = getProject(res.projectId);
    const declared = tpl.stages.reduce((n, st) => n + st.steps.length, 0);
    assert.equal(p.workflow.steps.length, declared, tpl.name);
    assert.equal(p.tasks.length, declared, tpl.name);
  }
});

test('舊資料與備份：沒有 workflow 的專案照常載入；workflow 缺欄位時載入補齊；搜尋能比對專案主題', async () => {
  reset();
  fs.writeFileSync(
    projectsFile,
    JSON.stringify({
      projects: [
        { id: 'p_old', name: '舊專案', tasks: [], issues: [] },
        {
          id: 'p_wf',
          name: '殘缺流程',
          tasks: [],
          issues: [],
          workflow: { topic: '神秘主題XYZ', steps: [{ id: 's1', title: 't' }] },
        },
        { id: 'p_bad', name: '壞掉', tasks: [], issues: [], workflow: { steps: 'oops' } },
      ],
    })
  );
  const projects = loadProjects();
  assert.equal(projects[0].workflow, undefined);
  assert.equal(projects[1].workflow.steps[0].status, 'todo');
  assert.equal(projects[1].workflow.currentStepId, 's1');
  assert.equal(projects[2].workflow, undefined, '結構壞掉的 workflow 被丟掉');

  const hits = searchGlobal('神秘主題XYZ').filter((r) => r.kind === 'project');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'p_wf');
});
