/**
 * renderer/project/project-workflow-detail.js — 階段流程：步驟詳細面板與操作
 *
 * 專案視窗（project.html）的一部分。這些檔案是「一般 <script>」，彼此共用全域詞法作用域
 * （頂層的 const／let／function 互相看得到），載入順序見 project.html，project-main.js 必須最後載入。
 */
/* global adoptProjects, allDocuments, capitalize, currentProjectId, currentWorkflow, refreshComposedPrompt, refreshOpenSpecInfo, renderPitchBridge, renderStagePrompts, renderWorkflow, renderWorkflowSteps, wfContextEl, wfCopyBtn, wfDetailStageEl, wfDetailTitleEl, wfDispatchPanelEl, wfDoneBtn, wfFlash, wfOutputEl, wfPrevBtn, wfPromptEditEl, wfSavedHintEl, wfSelectedStepId, wfStepNumbers, wfTemplateNameEl, wfTemplateSavedEl, wfTopicEl */
/* exported renderWorkflowDetail, selectWorkflowStep */

function renderWorkflowDetail(wf) {
  const idx = wf.steps.findIndex((s) => s.id === wfSelectedStepId);
  const step = wf.steps[idx];
  if (!step) return;
  const numbers = wfStepNumbers(wf.steps);
  wfDetailTitleEl.textContent = `${numbers[idx]} ${step.title}`;
  // 「階段名稱 · 第 n/total 步 · 狀態」；用 ' · ' 分隔（不用全形空白，會被 lint 擋下）
  wfDetailStageEl.textContent = [
    step.stage,
    window.i18n.t('project.wfStepOf', { n: idx + 1, total: wf.steps.length }),
    window.i18n.t(`project.taskStatus${capitalize(step.status)}`),
  ]
    .filter(Boolean)
    .join(' · ');
  renderStagePrompts(wf, step);
  wfPromptEditEl.value = step.prompt || '';
  wfOutputEl.value = step.output || '';
  wfPrevBtn.disabled = idx === 0;
  wfDoneBtn.textContent = window.i18n.t(
    idx === wf.steps.length - 1 ? 'project.wfDoneLast' : 'project.wfDoneNext'
  );
  wfCopyBtn.textContent = window.i18n.t('project.wfCopy');
  // 切換步驟時收起派發面板（對象與紀錄是每一步各自的）
  if (wfDispatchPanelEl.dataset.stepId !== step.id) {
    wfDispatchPanelEl.style.display = 'none';
    wfDispatchPanelEl.dataset.stepId = step.id;
  }
  refreshComposedPrompt();
}

async function selectWorkflowStep(stepId) {
  wfSelectedStepId = stepId;
  wfFlash('');
  renderWorkflow();
  // 記住停在哪一步，重開視窗後接續
  adoptProjects(
    await window.workspaceAPI.setWorkflowMeta(currentProjectId, {
      currentStepId: stepId,
    })
  );
}

wfTopicEl.addEventListener('change', async () => {
  adoptProjects(
    await window.workspaceAPI.setWorkflowMeta(currentProjectId, {
      topic: wfTopicEl.value,
    })
  );
  refreshComposedPrompt();
});
wfContextEl.addEventListener('change', async () => {
  adoptProjects(
    await window.workspaceAPI.setWorkflowMeta(currentProjectId, {
      contextMode: wfContextEl.value,
    })
  );
  refreshComposedPrompt();
});

// 產出貼回來、提示詞原文改動：離開輸入框（change）就即時存檔，不用按「儲存專案」
wfOutputEl.addEventListener('change', async () => {
  adoptProjects(
    await window.workspaceAPI.updateWorkflowStep(currentProjectId, wfSelectedStepId, {
      output: wfOutputEl.value,
    })
  );
  wfSavedHintEl.textContent = window.i18n.t('project.wfSaved');
  renderWorkflowSteps(currentWorkflow());
  refreshOpenSpecInfo(); // 產出變了，可匯出的檔案預覽與建議變更名稱要跟著更新
});
wfPromptEditEl.addEventListener('change', async () => {
  adoptProjects(
    await window.workspaceAPI.updateWorkflowStep(currentProjectId, wfSelectedStepId, {
      prompt: wfPromptEditEl.value,
    })
  );
  refreshComposedPrompt();
});

async function setWfStatus(stepId, status) {
  adoptProjects(
    await window.workspaceAPI.setWorkflowStepStatus(currentProjectId, stepId, status)
  );
}

wfCopyBtn.addEventListener('click', async () => {
  const text = await refreshComposedPrompt();
  await navigator.clipboard.writeText(text);
  wfCopyBtn.textContent = window.i18n.t('project.wfCopied');
  setTimeout(() => {
    wfCopyBtn.textContent = window.i18n.t('project.wfCopy');
  }, 1500);
  // 複製提示詞 = 這一步開始了
  const wf = currentWorkflow();
  const step = wf && wf.steps.find((s) => s.id === wfSelectedStepId);
  if (step && step.status === 'todo') {
    await setWfStatus(step.id, 'doing');
    renderWorkflow();
  }
});

wfPrevBtn.addEventListener('click', () => {
  const wf = currentWorkflow();
  const idx = wf.steps.findIndex((s) => s.id === wfSelectedStepId);
  if (idx > 0) selectWorkflowStep(wf.steps[idx - 1].id);
});

document.getElementById('btn-wf-reset').addEventListener('click', async () => {
  await setWfStatus(wfSelectedStepId, 'todo');
  renderWorkflow();
});

wfDoneBtn.addEventListener('click', async () => {
  await setWfStatus(wfSelectedStepId, 'done');
  // 主行程標成完成時會把「目前步驟」移到下一個還沒完成的步驟，跟著過去
  const wf = currentWorkflow();
  wfSelectedStepId = wf.currentStepId;
  wfFlash('');
  renderWorkflow();
});

document.getElementById('btn-wf-save-template').addEventListener('click', async () => {
  const wf = currentWorkflow();
  if (!wf) return;
  const name = wfTemplateNameEl.value.trim() || `${wf.templateName || ''}`.trim();
  const res = await window.workspaceAPI.saveWorkflowAsTemplate(currentProjectId, {
    name,
  });
  if (res && res.ok) {
    wfTemplateNameEl.value = '';
    wfTemplateSavedEl.textContent = window.i18n.t('project.wfTemplateSaved', { name });
  }
});

// 把目前步驟的產出存成文件庫的一份新文件，並自動跟這個專案建立關聯
// （見 lib/ipc/projects.js 的 projects:workflow:saveStepOutputAsDocument）。
document.getElementById('btn-wf-save-as-doc').addEventListener('click', async () => {
  if (!currentProjectId || !wfSelectedStepId) return;
  if (!wfOutputEl.value.trim()) {
    wfFlash(window.i18n.t('project.wfSaveAsDocumentEmpty'));
    return;
  }
  const result = await window.workspaceAPI.saveWorkflowStepOutputAsDocument(
    currentProjectId,
    wfSelectedStepId
  );
  if (!result.ok) {
    wfFlash(window.i18n.t('project.wfSaveAsDocumentFailed'));
    return;
  }
  allDocuments = result.docs;
  adoptProjects(result.projects);
  wfFlash(window.i18n.t('project.wfSaveAsDocumentDone'));
  renderPitchBridge(currentWorkflow()); // 剛存的文件不影響簡報橋接內容本身，但穩妥起見刷新一次
});
