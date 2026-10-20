/**
 * renderer/project/project-main.js — 專案編輯、事件接線與初始化（必須最後載入）
 *
 * 專案視窗（project.html）的一部分。這些檔案是「一般 <script>」，彼此共用全域詞法作用域
 * （頂層的 const／let／function 互相看得到），載入順序見 project.html，project-main.js 必須最後載入。
 */
/* global allAccounts, allDocuments, allKnowledgeItems, allProjects, calendarMonth, currentProjectId, descInput, editingIssues, editingTasks, editorEl, emptyEl, endInput, expandedTimeTaskId, nameInput, ospChangeIdEdited, refreshOpenSpecInfo, renderList, renderTasks, selectedCalendarDate, setListToolbarActive, startInput, startOfMonth, statusSelect, switchTab, templatePickerEl, wfFlash, wfOspChangeIdEl, wfOspEl, wfOspResultEl, wfSelectedStepId */
/* exported selectProject */

// ---------------------------------------------------------------------
// 專案編輯
// ---------------------------------------------------------------------
function selectProject(id, initialTab) {
  document.getElementById('proj-overview').style.display = 'none';
  templatePickerEl.style.display = 'none';
  setListToolbarActive('project');
  currentProjectId = id;
  expandedTimeTaskId = null;
  const project = allProjects.find((p) => p.id === id);
  editorEl.style.display = 'flex';
  emptyEl.style.display = 'none';
  if (project) {
    nameInput.value = project.name || '';
    statusSelect.value = project.status || 'planning';
    startInput.value = project.startDate || '';
    endInput.value = project.endDate || '';
    descInput.value = project.description || '';
    editingTasks = (project.tasks || []).map((t) => ({ ...t }));
    editingIssues = (project.issues || []).map((i) => ({
      ...i,
      tags: [...(i.tags || [])],
    }));
  } else {
    nameInput.value = '';
    statusSelect.value = 'planning';
    startInput.value = '';
    endInput.value = '';
    descInput.value = '';
    editingTasks = [];
    editingIssues = [];
  }
  selectedCalendarDate = null;
  calendarMonth = startOfMonth(new Date());
  // 「階段流程」分頁只有從範本建立的專案才有；沒有流程的專案要求這個分頁時退回任務清單
  const hasWorkflow = !!(project && project.workflow);
  document.getElementById('tab-workflow').style.display = hasWorkflow ? '' : 'none';
  wfSelectedStepId = null;
  ospChangeIdEdited = false;
  wfOspChangeIdEl.value = '';
  wfOspResultEl.textContent = '';
  wfOspEl.style.display = 'none'; // 切到流程分頁時 refreshOpenSpecInfo() 會依專案決定要不要顯示
  wfFlash('');
  switchTab(
    initialTab === 'workflow' && !hasWorkflow ? 'tasks' : initialTab || 'tasks'
  );
  renderTasks();
  renderList();
}

document.getElementById('btn-new-project').addEventListener('click', () => {
  selectProject(null);
  nameInput.focus();
});

document.getElementById('btn-save-project').addEventListener('click', async () => {
  const project = {
    id: currentProjectId,
    name: nameInput.value.trim() || window.i18n.t('project.unnamed'),
    status: statusSelect.value,
    startDate: startInput.value || null,
    endDate: endInput.value || null,
    description: descInput.value,
    tasks: editingTasks,
    issues: editingIssues,
  };
  allProjects = await window.workspaceAPI.saveProject(project);
  if (!currentProjectId) currentProjectId = allProjects[allProjects.length - 1].id;
  renderList();
});

document.getElementById('btn-delete-project').addEventListener('click', async () => {
  if (!currentProjectId) {
    editorEl.style.display = 'none';
    emptyEl.style.display = 'flex';
    return;
  }
  const project = allProjects.find((p) => p.id === currentProjectId);
  const ok = window.confirm(
    window.i18n.t('project.deleteConfirm', { name: project ? project.name : '' })
  );
  if (!ok) return;
  allProjects = await window.workspaceAPI.deleteProject(currentProjectId);
  currentProjectId = null;
  editorEl.style.display = 'none';
  emptyEl.style.display = 'flex';
  renderList();
});

// 跨模組快速搜尋（命令面板）跳轉過來時要選中的專案（連同指定分頁：
// 任務結果跳「任務」分頁、issue 結果跳「議題」分頁）
window.workspaceAPI.onSearchSelect((payload) => {
  if (payload) selectProject(payload.id, payload.tab);
});

// ---------------------------------------------------------------------
// 初始化
// ---------------------------------------------------------------------
(async () => {
  await window.i18n.init();
  [allProjects, allAccounts, allDocuments, allKnowledgeItems] = await Promise.all([
    window.workspaceAPI.listProjects(),
    window.workspaceAPI.listAccounts(),
    window.workspaceAPI.listDocuments(),
    window.workspaceAPI.listKnowledge().then((kb) => kb.items),
  ]);
  renderList();

  const pending = await window.workspaceAPI.consumePendingSelection('projects');
  if (pending) selectProject(pending.id, pending.tab);
})();
