/**
 * renderer/project/project-linked-docs.js — 關聯文件
 *
 * 專案視窗（project.html）的一部分。這些檔案是「一般 <script>」，彼此共用全域詞法作用域
 * （頂層的 const／let／function 互相看得到），載入順序見 project.html，project-main.js 必須最後載入。
 */
/* global adoptProjects, allDocuments, allKnowledgeItems, allProjects, currentProjectId, currentWorkflow, renderPitchBridge */
/* exported currentProject, renderLinkedDocuments */

// ---------------------------------------------------------------------
// 關聯文件：跟文件庫既有文件手動建立關聯（多對多），完全比照
// conversation.js 的同一套邏輯，只是操作對象換成專案。
// ---------------------------------------------------------------------
const projLinkedListEl = document.getElementById('proj-linked-list');
const projLinkSelectEl = document.getElementById('proj-link-select');

function docIconFor(doc) {
  const ext = /\.([a-zA-Z0-9]+)$/.exec((doc && doc.name) || '');
  const map = { md: '📝', markdown: '📝', docx: '📘', pdf: '📕', json: '🗂', txt: '📄' };
  return (ext && map[ext[1].toLowerCase()]) || '📎';
}

function currentProject() {
  return allProjects.find((p) => p.id === currentProjectId) || null;
}

function rebuildProjLinkSelect(project) {
  const linkedIds = new Set((project && project.linkedDocumentIds) || []);
  const available = allDocuments.filter((d) => !linkedIds.has(d.id));
  projLinkSelectEl.innerHTML = '';
  if (available.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = window.i18n.t('project.noAvailableDocuments');
    projLinkSelectEl.appendChild(opt);
    projLinkSelectEl.disabled = true;
    return;
  }
  projLinkSelectEl.disabled = false;
  available.forEach((d) => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.name;
    projLinkSelectEl.appendChild(opt);
  });
}

function renderLinkedDocuments() {
  const project = currentProject();
  projLinkedListEl.innerHTML = '';
  const linkedIds = (project && project.linkedDocumentIds) || [];
  if (linkedIds.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'linked-doc-empty';
    empty.textContent = window.i18n.t('project.noLinkedDocuments');
    projLinkedListEl.appendChild(empty);
  }
  linkedIds.forEach((docId) => {
    const doc = allDocuments.find((d) => d.id === docId);
    const row = document.createElement('div');
    row.className = 'linked-doc-row';

    const icon = document.createElement('span');
    icon.className = 'linked-doc-icon';
    icon.textContent = doc ? docIconFor(doc) : '⚠';

    const name = document.createElement('span');
    name.className = 'linked-doc-name' + (!doc || doc.missing ? ' missing' : '');
    name.textContent = doc
      ? doc.missing
        ? `${doc.name} (${window.i18n.t('documents.missingFlag')})`
        : doc.name
      : window.i18n.t('project.linkedDocumentGone');
    name.title = doc ? doc.filePath || '' : '';

    const actions = document.createElement('div');
    actions.className = 'linked-doc-actions';

    if (doc && !doc.missing) {
      const openBtn = document.createElement('button');
      openBtn.textContent = '📂';
      openBtn.title = window.i18n.t('documents.openFile');
      openBtn.addEventListener('click', async () => {
        await window.workspaceAPI.openDocumentFile(doc.id);
      });
      actions.appendChild(openBtn);
    }

    const unlinkBtn = document.createElement('button');
    unlinkBtn.className = 'danger-text';
    unlinkBtn.textContent = '✕';
    unlinkBtn.title = window.i18n.t('project.unlink');
    unlinkBtn.addEventListener('click', async () => {
      adoptProjects(
        await window.workspaceAPI.unlinkProjectDocument(currentProjectId, docId)
      );
      renderLinkedDocuments();
    });
    actions.appendChild(unlinkBtn);

    row.appendChild(icon);
    row.appendChild(name);
    row.appendChild(actions);
    projLinkedListEl.appendChild(row);
  });
  rebuildProjLinkSelect(project);
}

document.getElementById('btn-link-doc').addEventListener('click', async () => {
  if (!currentProjectId || !projLinkSelectEl.value) return;
  adoptProjects(
    await window.workspaceAPI.linkProjectDocument(
      currentProjectId,
      projLinkSelectEl.value
    )
  );
  renderLinkedDocuments();
});

window.workspaceAPI.onDocumentsChanged(async () => {
  allDocuments = await window.workspaceAPI.listDocuments();
  if (document.getElementById('tab-linked').classList.contains('active')) {
    renderLinkedDocuments();
  }
});

window.workspaceAPI.onKnowledgeChanged(async () => {
  allKnowledgeItems = (await window.workspaceAPI.listKnowledge()).items;
  if (document.getElementById('tab-workflow').classList.contains('active')) {
    renderPitchBridge(currentWorkflow());
  }
});
