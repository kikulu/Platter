/**
 * renderer/project/project-issues.js — Issue 管理
 *
 * 專案視窗（project.html）的一部分。這些檔案是「一般 <script>」，彼此共用全域詞法作用域
 * （頂層的 const／let／function 互相看得到），載入順序見 project.html，project-main.js 必須最後載入。
 */
/* global allAccounts, allProjects, capitalize, currentProjectId, editingIssues, genLocalId, issueFilterStatusEl, issueListEl, renderList */
/* exported renderIssues */

// ---------------------------------------------------------------------
// Issue 管理
// ---------------------------------------------------------------------
const ISSUE_TYPES = ['bug', 'feature', 'task', 'improvement'];
const ISSUE_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const ISSUE_STATUSES = ['open', 'inprogress', 'resolved', 'closed'];

function renderIssues() {
  issueListEl.innerHTML = '';
  const filterStatus = issueFilterStatusEl.value;
  const filtered = filterStatus
    ? editingIssues.filter((i) => i.status === filterStatus)
    : editingIssues;

  filtered.forEach((issue) => {
    const card = document.createElement('div');
    card.className = 'issue-card';

    const top = document.createElement('div');
    top.className = 'issue-card-top';
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'issue-title';
    titleInput.placeholder = window.i18n.t('project.issueTitlePlaceholder');
    titleInput.value = issue.title;
    titleInput.addEventListener('input', () => {
      issue.title = titleInput.value;
      renderList();
    });
    const removeBtn = document.createElement('button');
    removeBtn.className = 'issue-remove';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => {
      editingIssues = editingIssues.filter((i) => i.id !== issue.id);
      renderIssues();
      renderList();
    });
    top.appendChild(titleInput);
    top.appendChild(removeBtn);

    const descInputEl = document.createElement('textarea');
    descInputEl.className = 'issue-desc';
    descInputEl.placeholder = window.i18n.t('project.issueDescPlaceholder');
    descInputEl.value = issue.description || '';
    descInputEl.addEventListener('input', () => {
      issue.description = descInputEl.value;
    });

    const meta = document.createElement('div');
    meta.className = 'issue-card-meta';

    const typeSelect = document.createElement('select');
    ISSUE_TYPES.forEach((type) => {
      const opt = document.createElement('option');
      opt.value = type;
      opt.textContent = window.i18n.t(`project.issueType${capitalize(type)}`);
      typeSelect.appendChild(opt);
    });
    typeSelect.value = issue.type;
    typeSelect.addEventListener('change', () => {
      issue.type = typeSelect.value;
    });

    const prioritySelect = document.createElement('select');
    ISSUE_PRIORITIES.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = window.i18n.t(`project.issuePriority${capitalize(p)}`);
      prioritySelect.appendChild(opt);
    });
    prioritySelect.value = issue.priority;
    prioritySelect.addEventListener('change', () => {
      issue.priority = prioritySelect.value;
    });

    const statusSelectEl = document.createElement('select');
    ISSUE_STATUSES.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = window.i18n.t(`project.issueStatus${capitalize(s)}`);
      statusSelectEl.appendChild(opt);
    });
    statusSelectEl.value = issue.status;
    statusSelectEl.addEventListener('change', async () => {
      issue.status = statusSelectEl.value;
      renderList();
      // Issue 狀態即時持久化，用途同任務狀態切換
      if (currentProjectId) {
        allProjects = await window.workspaceAPI.setIssueStatus(
          currentProjectId,
          issue.id,
          issue.status
        );
      }
    });

    const assigneeSelect = document.createElement('select');
    assigneeSelect.innerHTML = `<option value="">${window.i18n.t('project.noAssignee')}</option>`;
    allAccounts.forEach((acc) => {
      const opt = document.createElement('option');
      opt.value = acc.id;
      opt.textContent = acc.name;
      assigneeSelect.appendChild(opt);
    });
    assigneeSelect.value = issue.assigneeId || '';
    assigneeSelect.addEventListener('change', () => {
      issue.assigneeId = assigneeSelect.value || null;
    });

    const dueDateInput = document.createElement('input');
    dueDateInput.type = 'date';
    dueDateInput.title = window.i18n.t('project.taskDueDate');
    dueDateInput.value = issue.dueDate || '';
    dueDateInput.addEventListener('change', () => {
      issue.dueDate = dueDateInput.value || null;
    });

    meta.appendChild(typeSelect);
    meta.appendChild(prioritySelect);
    meta.appendChild(statusSelectEl);
    meta.appendChild(assigneeSelect);
    meta.appendChild(dueDateInput);

    const tagsInput = document.createElement('input');
    tagsInput.type = 'text';
    tagsInput.className = 'issue-tags';
    tagsInput.placeholder = window.i18n.t('project.issueTagsPlaceholder');
    tagsInput.value = (issue.tags || []).join(', ');
    tagsInput.addEventListener('input', () => {
      issue.tags = tagsInput.value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    });

    card.appendChild(top);
    card.appendChild(descInputEl);
    card.appendChild(meta);
    card.appendChild(tagsInput);
    issueListEl.appendChild(card);
  });

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'settings-hint';
    empty.textContent = window.i18n.t('project.emptyIssues');
    issueListEl.appendChild(empty);
  }
}

issueFilterStatusEl.addEventListener('change', renderIssues);

document.getElementById('btn-add-issue').addEventListener('click', () => {
  editingIssues.push({
    id: genLocalId('issue'),
    title: '',
    description: '',
    type: 'task',
    priority: 'medium',
    status: 'open',
    assigneeId: null,
    dueDate: null,
    tags: [],
  });
  renderIssues();
  renderList();
  // 讓新卡片的標題欄位馬上可以輸入
  const inputs = issueListEl.querySelectorAll('.issue-title');
  if (inputs.length) inputs[inputs.length - 1].focus();
});
