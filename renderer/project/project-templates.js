/**
 * renderer/project/project-templates.js — 從範本建立專案
 *
 * 專案視窗（project.html）的一部分。這些檔案是「一般 <script>」，彼此共用全域詞法作用域
 * （頂層的 const／let／function 互相看得到），載入順序見 project.html，project-main.js 必須最後載入。
 */
/* global allProjects, currentProjectId, editorEl, emptyEl, renderList, selectProject, setListToolbarActive, templatePickerEl */
/* exported renderTemplateList, templates */

// ---------------------------------------------------------------------
// 從範本建立專案（選範本 + 輸入專案主題）
//
// 範本清單與展開成專案的邏輯都在主行程（lib/workflow.js、lib/ipc/projects.js），
// 這裡只負責挑選與送出。
// ---------------------------------------------------------------------
let templates = [];
let selectedTemplateId = null;
const tplListEl = document.getElementById('tpl-list');
const tplTopicEl = document.getElementById('tpl-topic');
const tplNameEl = document.getElementById('tpl-name');
const tplErrorEl = document.getElementById('tpl-error');

function renderTemplateList() {
  tplListEl.innerHTML = '';
  templates.forEach((tpl) => {
    const card = document.createElement('div');
    card.className = 'tpl-card' + (tpl.id === selectedTemplateId ? ' active' : '');

    const head = document.createElement('div');
    head.className = 'tpl-card-head';
    const name = document.createElement('span');
    name.className = 'tpl-card-name';
    name.textContent = tpl.name;
    const badge = document.createElement('span');
    badge.className = 'tpl-badge';
    badge.textContent = window.i18n.t(
      tpl.builtIn ? 'project.tplBuiltIn' : 'project.tplCustom'
    );
    const stepCount = tpl.stages.reduce((n, st) => n + st.steps.length, 0);
    const count = document.createElement('span');
    count.className = 'tpl-badge';
    count.textContent = window.i18n.t('project.tplCount', {
      stages: tpl.stages.length,
      steps: stepCount,
    });
    head.appendChild(name);
    head.appendChild(badge);
    head.appendChild(count);
    if (!tpl.builtIn) {
      const del = document.createElement('button');
      del.className = 'step-icon-btn';
      del.textContent = '✕';
      del.title = window.i18n.t('project.tplDelete');
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (
          !window.confirm(window.i18n.t('project.tplDeleteConfirm', { name: tpl.name }))
        )
          return;
        await window.workspaceAPI.deleteProjectTemplate(tpl.id);
        templates = await window.workspaceAPI.listProjectTemplates();
        if (!templates.some((t) => t.id === selectedTemplateId)) {
          selectedTemplateId = templates.length ? templates[0].id : null;
        }
        renderTemplateList();
      });
      head.appendChild(del);
    }
    card.appendChild(head);

    if (tpl.description) {
      const desc = document.createElement('div');
      desc.className = 'tpl-card-desc';
      desc.textContent = tpl.description;
      card.appendChild(desc);
    }

    const stages = document.createElement('div');
    stages.className = 'tpl-card-stages';
    tpl.stages.forEach((st) => {
      const line = document.createElement('div');
      const stageName = document.createElement('span');
      stageName.className = 'tpl-stage-name';
      stageName.textContent = st.title ? `${st.title}：` : '';
      const stageSteps = document.createElement('span');
      stageSteps.className = 'tpl-stage-steps';
      stageSteps.textContent = st.steps.map((x) => x.title).join(' → ');
      line.appendChild(stageName);
      line.appendChild(stageSteps);
      stages.appendChild(line);
    });
    card.appendChild(stages);

    card.addEventListener('click', () => {
      selectedTemplateId = tpl.id;
      renderTemplateList();
    });
    tplListEl.appendChild(card);
  });
}

async function showTemplatePicker() {
  currentProjectId = null;
  editorEl.style.display = 'none';
  emptyEl.style.display = 'none';
  document.getElementById('proj-overview').style.display = 'none';
  templatePickerEl.style.display = 'flex';
  setListToolbarActive('template');
  tplErrorEl.textContent = '';
  templates = await window.workspaceAPI.listProjectTemplates();
  if (!templates.some((t) => t.id === selectedTemplateId)) {
    selectedTemplateId = templates.length ? templates[0].id : null;
  }
  renderTemplateList();
  renderList();
  tplTopicEl.focus();
}
document
  .getElementById('btn-new-from-template')
  .addEventListener('click', showTemplatePicker);

document.getElementById('btn-tpl-cancel').addEventListener('click', () => {
  templatePickerEl.style.display = 'none';
  setListToolbarActive('project');
  emptyEl.style.display = 'flex';
});

document.getElementById('btn-tpl-create').addEventListener('click', async () => {
  const topic = tplTopicEl.value.trim();
  if (!topic) {
    tplErrorEl.textContent = window.i18n.t('project.tplErrTopic');
    tplTopicEl.focus();
    return;
  }
  if (!selectedTemplateId) {
    tplErrorEl.textContent = window.i18n.t('project.tplErrGeneric');
    return;
  }
  tplErrorEl.textContent = '';
  const res = await window.workspaceAPI.createProjectFromTemplate({
    templateId: selectedTemplateId,
    topic,
    name: tplNameEl.value.trim(),
  });
  if (!res || !res.ok) {
    tplErrorEl.textContent = window.i18n.t(
      res && res.error === 'topic-required'
        ? 'project.tplErrTopic'
        : 'project.tplErrGeneric'
    );
    return;
  }
  tplTopicEl.value = '';
  tplNameEl.value = '';
  allProjects = res.projects;
  selectProject(res.projectId, 'workflow');
});
