/**
 * renderer/project/project-tasks.js — 任務清單與工時紀錄
 *
 * 專案視窗（project.html）的一部分。這些檔案是「一般 <script>」，彼此共用全域詞法作用域
 * （頂層的 const／let／function 互相看得到），載入順序見 project.html，project-main.js 必須最後載入。
 */
/* global allAccounts, allProjects, capitalize, currentProjectId, editingTasks, expandedTimeTaskId, genLocalId, newTaskInput, renderList, taskListEl, taskProgressEl, taskTotalHoursEl */
/* exported renderTasks */

// ---------------------------------------------------------------------
// 任務清單
// ---------------------------------------------------------------------
function taskHours(task) {
  return (task.timeEntries || []).reduce(
    (sum, entry) => sum + (Number(entry.hours) || 0),
    0
  );
}

function formatHours(hours) {
  // 去掉沒意義的小數點（3 顯示 3，3.5 顯示 3.5），避免每個都是 3.00 小時
  const rounded = Math.round(hours * 100) / 100;
  return String(rounded);
}

function renderTaskProgress() {
  const total = editingTasks.length;
  const done = editingTasks.filter((t) => t.status === 'done').length;
  taskProgressEl.textContent = window.i18n.t('project.taskProgress', { done, total });

  const totalHours = editingTasks.reduce((sum, t) => sum + taskHours(t), 0);
  taskTotalHoursEl.textContent =
    totalHours > 0
      ? window.i18n.t('project.totalHours', { hours: formatHours(totalHours) })
      : '';
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
        allProjects = await window.workspaceAPI.setTaskStatus(
          currentProjectId,
          task.id,
          task.status
        );
      }
    });

    const startDateInput = document.createElement('input');
    startDateInput.type = 'date';
    startDateInput.title = window.i18n.t('project.taskStartDate');
    startDateInput.value = task.startDate || '';
    startDateInput.addEventListener('change', () => {
      task.startDate = startDateInput.value || null;
    });

    const dueDateInput = document.createElement('input');
    dueDateInput.type = 'date';
    dueDateInput.title = window.i18n.t('project.taskDueDate');
    dueDateInput.value = task.dueDate || '';
    dueDateInput.addEventListener('change', () => {
      task.dueDate = dueDateInput.value || null;
    });

    const timeBtn = document.createElement('button');
    timeBtn.type = 'button';
    timeBtn.className = 'task-time-btn' + (taskHours(task) > 0 ? ' has-entries' : '');
    timeBtn.textContent =
      taskHours(task) > 0
        ? `⏱ ${formatHours(taskHours(task))}${window.i18n.t('project.hoursUnit')}`
        : `⏱ ${window.i18n.t('project.logTime')}`;
    timeBtn.addEventListener('click', () => {
      expandedTimeTaskId = expandedTimeTaskId === task.id ? null : task.id;
      renderTasks();
    });

    const removeBtn = document.createElement('button');
    removeBtn.className = 'task-remove';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => {
      editingTasks = editingTasks.filter((t) => t.id !== task.id);
      if (expandedTimeTaskId === task.id) expandedTimeTaskId = null;
      renderTasks();
      renderTaskProgress();
    });

    row.appendChild(titleInput);
    row.appendChild(assigneeSelect);
    row.appendChild(statusSelectEl);
    row.appendChild(startDateInput);
    row.appendChild(dueDateInput);
    row.appendChild(timeBtn);
    row.appendChild(removeBtn);
    taskListEl.appendChild(row);

    if (expandedTimeTaskId === task.id) {
      taskListEl.appendChild(buildTimePanel(task));
    }
  });

  if (editingTasks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'settings-hint';
    empty.textContent = window.i18n.t('project.emptyTasks');
    taskListEl.appendChild(empty);
  }

  renderTaskProgress();
}

// 工時紀錄面板：列出這個任務目前的紀錄（可個別移除），下面是新增一筆
// 紀錄的小表單（日期預設今天、小時數、備註選填）。跟任務狀態切換一樣
// 即時持久化，不用等按「儲存專案」——避免記完工時忘記存檔白做工。
function buildTimePanel(task) {
  const panel = document.createElement('div');
  panel.className = 'task-time-panel';

  const entries = (task.timeEntries || [])
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date));
  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'task-time-empty';
    empty.textContent = window.i18n.t('project.noTimeEntries');
    panel.appendChild(empty);
  } else {
    entries.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'task-time-entry';

      const dateSpan = document.createElement('span');
      dateSpan.className = 'task-time-entry-date';
      dateSpan.textContent = entry.date;

      const hoursSpan = document.createElement('span');
      hoursSpan.className = 'task-time-entry-hours';
      hoursSpan.textContent = `${formatHours(entry.hours)}${window.i18n.t('project.hoursUnit')}`;

      const noteSpan = document.createElement('span');
      noteSpan.className = 'task-time-entry-note';
      noteSpan.textContent = entry.note || '';

      const removeEntryBtn = document.createElement('button');
      removeEntryBtn.className = 'task-time-entry-remove';
      removeEntryBtn.textContent = '✕';
      removeEntryBtn.addEventListener('click', async () => {
        if (!currentProjectId) return;
        allProjects = await window.workspaceAPI.removeTaskTimeEntry(
          currentProjectId,
          task.id,
          entry.id
        );
        syncTaskFromAllProjects(task.id);
        renderTasks();
      });

      row.appendChild(dateSpan);
      row.appendChild(hoursSpan);
      row.appendChild(noteSpan);
      row.appendChild(removeEntryBtn);
      panel.appendChild(row);
    });
  }

  if (currentProjectId) {
    const addRow = document.createElement('div');
    addRow.className = 'task-time-add';

    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.value = new Date().toISOString().slice(0, 10);

    const hoursInput = document.createElement('input');
    hoursInput.type = 'number';
    hoursInput.min = '0';
    hoursInput.step = '0.5';
    hoursInput.placeholder = window.i18n.t('project.timeHoursPlaceholder');

    const noteInput = document.createElement('input');
    noteInput.type = 'text';
    noteInput.placeholder = window.i18n.t('project.timeNotePlaceholder');

    const addBtn = document.createElement('button');
    addBtn.textContent = window.i18n.t('project.addTimeEntry');
    addBtn.addEventListener('click', async () => {
      const hours = parseFloat(hoursInput.value);
      if (!hours || hours <= 0) return;
      allProjects = await window.workspaceAPI.addTaskTimeEntry(
        currentProjectId,
        task.id,
        {
          date: dateInput.value || new Date().toISOString().slice(0, 10),
          hours,
          note: noteInput.value.trim(),
        }
      );
      syncTaskFromAllProjects(task.id);
      renderTasks();
    });

    addRow.appendChild(dateInput);
    addRow.appendChild(hoursInput);
    addRow.appendChild(noteInput);
    addRow.appendChild(addBtn);
    panel.appendChild(addRow);
  } else {
    const hint = document.createElement('div');
    hint.className = 'task-time-empty';
    hint.textContent = window.i18n.t('project.saveProjectFirstForTime');
    panel.appendChild(hint);
  }

  return panel;
}

// 工時紀錄的 add/remove 走獨立 IPC 即時持久化（見 lib/ipc/projects.js），
// 回傳的是完整 allProjects；editingTasks 裡的 task 物件是各自獨立的
// spread 副本，不會自動跟著更新，這裡手動把最新的 timeEntries 同步回去。
function syncTaskFromAllProjects(taskId) {
  if (!currentProjectId) return;
  const project = allProjects.find((p) => p.id === currentProjectId);
  if (!project) return;
  const updatedTask = project.tasks.find((t) => t.id === taskId);
  const task = editingTasks.find((t) => t.id === taskId);
  if (updatedTask && task) {
    task.timeEntries = updatedTask.timeEntries;
  }
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
    startDate: null,
    dueDate: null,
    timeEntries: [],
  });
  newTaskInput.value = '';
  renderTasks();
});
newTaskInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-add-task').click();
});
