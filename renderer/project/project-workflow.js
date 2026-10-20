/**
 * renderer/project/project-workflow.js — 階段流程：步驟清單、派發、組合提示詞
 *
 * 專案視窗（project.html）的一部分。這些檔案是「一般 <script>」，彼此共用全域詞法作用域
 * （頂層的 const／let／function 互相看得到），載入順序見 project.html，project-main.js 必須最後載入。
 */
/* global allAccounts, allProjects, currentProject, currentProjectId, editingTasks, refreshOpenSpecInfo, renderList, renderPitchBridge, renderTasks, renderWorkflowDetail, selectWorkflowStep */
/* exported adoptProjects, currentWorkflow, refreshComposedPrompt, renderWorkflow, renderWorkflowSteps, wfContextEl, wfCopyBtn, wfDetailStageEl, wfDetailTitleEl, wfDispatchPanelEl, wfDoneBtn, wfFlash, wfOutputEl, wfPrevBtn, wfPromptEditEl, wfSavedHintEl, wfSelectedStepId, wfStepNumbers, wfTemplateNameEl, wfTemplateSavedEl, wfTopicEl */

// ---------------------------------------------------------------------
// 階段流程：依序執行範本的分階段提示詞
//
// 每個步驟：複製「已帶入專案主題與前面步驟產出」的完整提示詞給 AI → 把 AI 的產出貼回來
// → 標記完成 → 下一步。提示詞的組合在主行程（projects:workflow:compose），這裡只顯示與複製，
// 不重複實作組合邏輯。步驟狀態與對應任務狀態由主行程同步，回傳完整專案清單後，這裡再把
// 任務狀態同步回 editingTasks（否則之後按「儲存專案」會把任務狀態蓋回舊值）。
// ---------------------------------------------------------------------
let wfSelectedStepId = null;
let wfComposeToken = 0; // 連續快速切換步驟時，只採用最後一次 compose 的結果
const wfTopicEl = document.getElementById('wf-topic');
const wfContextEl = document.getElementById('wf-context-mode');
const wfProgressEl = document.getElementById('wf-progress');
const wfStepsEl = document.getElementById('wf-steps');
const wfDetailTitleEl = document.getElementById('wf-detail-title');
const wfDetailStageEl = document.getElementById('wf-detail-stage');
const wfPreviewEl = document.getElementById('wf-prompt-preview');
const wfPromptEditEl = document.getElementById('wf-prompt-edit');
const wfOutputEl = document.getElementById('wf-output');
const wfSavedHintEl = document.getElementById('wf-saved-hint');
const wfCopyBtn = document.getElementById('btn-wf-copy');
const wfDispatchBtn = document.getElementById('btn-wf-dispatch');
const wfDispatchPanelEl = document.getElementById('wf-dispatch-panel');
const wfDispatchTargetEl = document.getElementById('wf-dispatch-target');
const wfDispatchGoBtn = document.getElementById('btn-wf-dispatch-go');
const wfDispatchLastEl = document.getElementById('wf-dispatch-last');
let allRoles = [];
const wfPrevBtn = document.getElementById('btn-wf-prev');
const wfDoneBtn = document.getElementById('btn-wf-done');
const wfTemplateNameEl = document.getElementById('wf-template-name');
const wfTemplateSavedEl = document.getElementById('wf-template-saved');

function currentWorkflow() {
  const project = allProjects.find((p) => p.id === currentProjectId);
  return project && project.workflow ? project.workflow : null;
}

function wfFlash(text) {
  wfSavedHintEl.textContent = text;
  wfTemplateSavedEl.textContent = '';
}

// 「階段序號-階段內序號」編號（跟 lib/workflow.js 的 stepNumbers() 一致：
// 相鄰且 stage 相同的步驟屬於同一階段）
function wfStepNumbers(steps) {
  const numbers = [];
  let stageIdx = 0;
  let inStage = 0;
  let prev = null;
  steps.forEach((s) => {
    if (prev === null || s.stage !== prev) {
      stageIdx += 1;
      inStage = 0;
    }
    inStage += 1;
    prev = s.stage;
    numbers.push(`${stageIdx}-${inStage}`);
  });
  return numbers;
}

// 主行程回傳最新的專案清單：更新本地狀態，並把已持久化的任務狀態同步回 editingTasks
function adoptProjects(list) {
  allProjects = list;
  const project = allProjects.find((p) => p.id === currentProjectId);
  if (project) {
    project.tasks.forEach((persisted) => {
      const editing = editingTasks.find((t) => t.id === persisted.id);
      if (editing) editing.status = persisted.status;
    });
    renderTasks();
  }
  renderList();
}

function renderWorkflow() {
  const wf = currentWorkflow();
  if (!wf) return;
  wfTopicEl.value = wf.topic || '';
  wfContextEl.value = wf.contextMode || 'all';
  if (!wf.steps.some((s) => s.id === wfSelectedStepId)) {
    wfSelectedStepId = wf.currentStepId || (wf.steps[0] && wf.steps[0].id) || null;
  }
  renderWorkflowSteps(wf);
  renderWorkflowDetail(wf);
  refreshOpenSpecInfo();
  renderPitchBridge(wf);
}

// 派發（1.44.0）：顯示用的帳號名稱——帳號還在就用目前的名稱，已被刪除就用派發當下的快照
function dispatchAccountName(dispatch) {
  const acc = allAccounts.find((a) => a.id === dispatch.accountId);
  if (acc) return acc.name;
  return `${dispatch.accountName || ''} ${window.i18n.t('project.wfDispatchMissing')}`.trim();
}

function dispatchOptionLabel(acc) {
  const role = acc.roleId ? allRoles.find((r) => r.id === acc.roleId) : null;
  return `${acc.name} (${[acc.platform, role && role.name].filter(Boolean).join(' · ')})`;
}

function refreshDispatchPanel(wf, step) {
  wfDispatchLastEl.className = '';
  if (step && step.dispatch) {
    const when = step.dispatch.at ? new Date(step.dispatch.at).toLocaleString() : '';
    wfDispatchLastEl.textContent = window.i18n.t('project.wfDispatchLast', {
      name: dispatchAccountName(step.dispatch),
      time: when,
    });
  } else {
    wfDispatchLastEl.textContent = '';
  }
}

// 打開派發面板時才重新載入帳號與角色（使用者可能剛新增帳號或改了角色）
async function openDispatchPanel() {
  const wf = currentWorkflow();
  const step = wf && wf.steps.find((s) => s.id === wfSelectedStepId);
  if (!step) return;
  [allAccounts, allRoles] = await Promise.all([
    window.workspaceAPI.listAccounts(),
    window.workspaceAPI.listRoles(),
  ]);
  wfDispatchTargetEl.innerHTML = '';
  if (allAccounts.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = window.i18n.t('project.wfDispatchNoAccounts');
    wfDispatchTargetEl.appendChild(opt);
    wfDispatchGoBtn.disabled = true;
  } else {
    wfDispatchGoBtn.disabled = false;
    allAccounts.forEach((acc) => {
      const opt = document.createElement('option');
      opt.value = acc.id;
      opt.textContent = dispatchOptionLabel(acc);
      wfDispatchTargetEl.appendChild(opt);
    });
    // 預選順序：上次派發的對象 → 這一步任務目前的負責人 → 現在正在用的帳號
    const project = currentProject();
    const task =
      step.taskId && project && project.tasks.find((tk) => tk.id === step.taskId);
    const preferred = [
      step.dispatch && step.dispatch.accountId,
      task && task.assigneeId,
      (allAccounts.find((a) => a.active) || {}).id,
    ].find((id) => id && allAccounts.some((a) => a.id === id));
    if (preferred) wfDispatchTargetEl.value = preferred;
  }
  refreshDispatchPanel(wf, step);
  wfDispatchPanelEl.style.display = 'flex';
}

wfDispatchBtn.addEventListener('click', () => {
  if (wfDispatchPanelEl.style.display === 'none') openDispatchPanel();
  else wfDispatchPanelEl.style.display = 'none';
});

wfDispatchGoBtn.addEventListener('click', async () => {
  const accountId = wfDispatchTargetEl.value;
  const wf = currentWorkflow();
  const step = wf && wf.steps.find((s) => s.id === wfSelectedStepId);
  if (!accountId || !step) return;
  const res = await window.workspaceAPI.dispatchWorkflowStep(
    currentProjectId,
    step.id,
    accountId
  );
  if (!res || !res.ok) {
    wfDispatchLastEl.textContent = window.i18n.t('project.wfDispatchFailed');
    wfDispatchLastEl.className = 'error';
    return;
  }
  // 任務負責人已在主程序改好；同步目前編輯中的任務清單，
  // 避免之後按「儲存專案」把舊的負責人蓋回去
  const editing = editingTasks.find((tk) => tk.id === step.taskId);
  if (editing) editing.assigneeId = accountId;
  adoptProjects(res.projects);
  renderWorkflow();
  wfDispatchPanelEl.style.display = 'flex';
  wfDispatchLastEl.textContent = window.i18n.t(
    res.copied ? 'project.wfDispatchDone' : 'project.wfDispatchNotCopied',
    { name: res.accountName }
  );
  wfDispatchLastEl.className = res.copied ? 'ok' : 'error';
});

function renderWorkflowSteps(wf) {
  const done = wf.steps.filter((s) => s.status === 'done').length;
  wfProgressEl.textContent = window.i18n.t('project.wfProgress', {
    done,
    total: wf.steps.length,
  });

  const numbers = wfStepNumbers(wf.steps);
  const icons = { todo: '○', doing: '◐', done: '●' };
  wfStepsEl.innerHTML = '';
  let prevStage = null;
  wf.steps.forEach((step, i) => {
    if (step.stage !== prevStage) {
      prevStage = step.stage;
      const inThisStage = wf.steps.filter(
        (s, j) =>
          j >= i && wf.steps.slice(i, j + 1).every((x) => x.stage === step.stage)
      );
      const head = document.createElement('div');
      head.className = 'wf-stage-head';
      const title = document.createElement('span');
      title.textContent = step.stage || window.i18n.t('project.wfNoStage');
      const count = document.createElement('span');
      count.className = 'wf-stage-count';
      count.textContent = `${inThisStage.filter((s) => s.status === 'done').length}/${inThisStage.length}`;
      head.appendChild(title);
      head.appendChild(count);
      wfStepsEl.appendChild(head);
    }
    const row = document.createElement('div');
    row.className =
      'wf-step-row' +
      (step.status !== 'todo' ? ` ${step.status}` : '') +
      (step.id === wfSelectedStepId ? ' active' : '');
    const icon = document.createElement('span');
    icon.className = 'wf-step-icon';
    icon.textContent = icons[step.status] || icons.todo;
    const title = document.createElement('span');
    title.className = 'wf-step-title';
    title.textContent = `${numbers[i]} ${step.title}`;
    row.appendChild(icon);
    row.appendChild(title);
    if (step.dispatch) {
      const badge = document.createElement('span');
      badge.className = 'wf-step-dispatch';
      badge.textContent = `→ ${dispatchAccountName(step.dispatch)}`;
      row.appendChild(badge);
    }
    row.addEventListener('click', () => selectWorkflowStep(step.id));
    wfStepsEl.appendChild(row);
  });
}

async function refreshComposedPrompt() {
  const token = ++wfComposeToken;
  const text = await window.workspaceAPI.composeWorkflowPrompt(
    currentProjectId,
    wfSelectedStepId
  );
  if (token === wfComposeToken) wfPreviewEl.value = text;
  return text;
}
