(function () {
  const listEl = document.getElementById('proj-list');
  const emptyEl = document.getElementById('proj-empty');
  const editorEl = document.getElementById('proj-editor');

  const nameInput = document.getElementById('proj-name');
  const statusSelect = document.getElementById('proj-status');
  const startInput = document.getElementById('proj-start');
  const endInput = document.getElementById('proj-end');
  const descInput = document.getElementById('proj-description');

  const taskListEl = document.getElementById('proj-task-list');
  const newTaskInput = document.getElementById('proj-new-task-input');
  const taskProgressEl = document.getElementById('proj-task-progress');

  let allProjects = [];
  let allAccounts = [];
  let currentProjectId = null;
  let editingTasks = [];

  function genLocalId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // ---------------------------------------------------------------------
  // 專案清單
  // ---------------------------------------------------------------------
  function renderList() {
    listEl.innerHTML = '';
    allProjects.forEach((p) => {
      const div = document.createElement('div');
      div.className = 'proj-item' + (p.id === currentProjectId ? ' active' : '');

      const name = document.createElement('div');
      name.className = 'proj-name';
      name.textContent = p.name || window.i18n.t('project.unnamed');

      const meta = document.createElement('div');
      meta.className = 'proj-meta';
      const badge = document.createElement('span');
      badge.className = `status-badge ${p.status}`;
      badge.textContent = window.i18n.t(`project.status${capitalize(p.status)}`);
      const total = (p.tasks || []).length;
      const done = (p.tasks || []).filter((t) => t.status === 'done').length;
      const progress = document.createElement('span');
      progress.textContent = `${done}/${total}`;
      meta.appendChild(badge);
      meta.appendChild(progress);

      div.appendChild(name);
      div.appendChild(meta);
      div.addEventListener('click', () => selectProject(p.id));
      listEl.appendChild(div);
    });
  }

  function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }

  // ---------------------------------------------------------------------
  // 任務清單
  // ---------------------------------------------------------------------
  function renderTaskProgress() {
    const total = editingTasks.length;
    const done = editingTasks.filter((t) => t.status === 'done').length;
    taskProgressEl.textContent = window.i18n.t('project.taskProgress', { done, total });
  }

  function renderTasks() {
    taskListEl.innerHTML = '';
    editingTasks.forEach((task) => {
      const row = document.createElement('div');
      row.className = 'task-row';

      const titleInput = document.createElement('input');
      titleInput.type = 'text';
      titleInput.className = 'task-title';
      titleInput.value = task.title;
      titleInput.addEventListener('input', () => {
        task.title = titleInput.value;
      });

      const assigneeSelect = document.createElement('select');
      assigneeSelect.innerHTML = `<option value="">${window.i18n.t('project.noAssignee')}</option>`;
      allAccounts.forEach((acc) => {
        const opt = document.createElement('option');
        opt.value = acc.id;
        opt.textContent = acc.name;
        assigneeSelect.appendChild(opt);
      });
      assigneeSelect.value = task.assigneeId || '';
      assigneeSelect.addEventListener('change', () => {
        task.assigneeId = assigneeSelect.value || null;
      });

      const statusSelectEl = document.createElement('select');
      ['todo', 'doing', 'done'].forEach((s) => {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = window.i18n.t(`project.taskStatus${capitalize(s)}`);
        statusSelectEl.appendChild(opt);
      });
      statusSelectEl.value = task.status;
      statusSelectEl.addEventListener('change', async () => {
        task.status = statusSelectEl.value;
        renderTaskProgress();
        renderList();
        // 任務狀態即時持久化，不用等按「儲存專案」（前提是專案已經存在）
        if (currentProjectId) {
          allProjects = await window.workspaceAPI.setTaskStatus(currentProjectId, task.id, task.status);
        }
      });

      const dueDateInput = document.createElement('input');
      dueDateInput.type = 'date';
      dueDateInput.value = task.dueDate || '';
      dueDateInput.addEventListener('change', () => {
        task.dueDate = dueDateInput.value || null;
      });

      const removeBtn = document.createElement('button');
      removeBtn.className = 'task-remove';
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', () => {
        editingTasks = editingTasks.filter((t) => t.id !== task.id);
        renderTasks();
        renderTaskProgress();
      });

      row.appendChild(titleInput);
      row.appendChild(assigneeSelect);
      row.appendChild(statusSelectEl);
      row.appendChild(dueDateInput);
      row.appendChild(removeBtn);
      taskListEl.appendChild(row);
    });

    if (editingTasks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'settings-hint';
      empty.textContent = window.i18n.t('project.emptyTasks');
      taskListEl.appendChild(empty);
    }

    renderTaskProgress();
  }

  document.getElementById('btn-add-task').addEventListener('click', () => {
    const title = newTaskInput.value.trim();
    if (!title) return;
    editingTasks.push({
      id: genLocalId('task'),
      title,
      description: '',
      assigneeId: null,
      status: 'todo',
      dueDate: null,
    });
    newTaskInput.value = '';
    renderTasks();
  });
  newTaskInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-add-task').click();
  });

  // ---------------------------------------------------------------------
  // 專案編輯
  // ---------------------------------------------------------------------
  function selectProject(id) {
    currentProjectId = id;
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
    } else {
      nameInput.value = '';
      statusSelect.value = 'planning';
      startInput.value = '';
      endInput.value = '';
      descInput.value = '';
      editingTasks = [];
    }
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

  // ---------------------------------------------------------------------
  // 初始化
  // ---------------------------------------------------------------------
  (async () => {
    await window.i18n.init();
    [allProjects, allAccounts] = await Promise.all([
      window.workspaceAPI.listProjects(),
      window.workspaceAPI.listAccounts(),
    ]);
    renderList();
  })();
})();
