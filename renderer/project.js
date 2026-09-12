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

  // 月曆
  const calToolbarLabel = document.getElementById('cal-month-label');
  const calWeekdaysEl = document.getElementById('cal-weekdays');
  const calGridEl = document.getElementById('cal-grid');
  const calDayDetailEl = document.getElementById('cal-day-detail');

  // 甘特圖
  const ganttEmptyEl = document.getElementById('gantt-empty');
  const ganttContainerEl = document.getElementById('gantt-container');

  // Issue 管理
  const issueListEl = document.getElementById('proj-issue-list');
  const issueFilterStatusEl = document.getElementById('issue-filter-status');

  let allProjects = [];
  let allAccounts = [];
  let currentProjectId = null;
  let editingTasks = [];
  let editingIssues = [];
  let calendarMonth = startOfMonth(new Date());
  let selectedCalendarDate = null;

  // 跨專案總覽用的獨立狀態（跟單一專案編輯畫面互不影響）
  let overviewCalMonth = startOfMonth(new Date());
  let overviewSelectedDate = null;
  const PROJECT_COLORS = [
    '#4f8cff',
    '#2ecc71',
    '#f5a623',
    '#e5484d',
    '#9b59b6',
    '#1abc9c',
    '#e67e22',
    '#3498db',
  ];

  function genLocalId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }

  // ---------------------------------------------------------------------
  // 日期小工具（一律用「本地日期」字串 YYYY-MM-DD，避免 toISOString 的 UTC 位移）
  // ---------------------------------------------------------------------
  function formatDateLocal(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function parseLocalDate(str) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function startOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }
  function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
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

      const openIssues = (p.issues || []).filter(
        (i) => i.status === 'open' || i.status === 'inprogress'
      ).length;
      if (openIssues > 0) {
        const issueBadge = document.createElement('span');
        issueBadge.textContent = `🐞 ${openIssues}`;
        meta.appendChild(issueBadge);
      }

      div.appendChild(name);
      div.appendChild(meta);
      div.addEventListener('click', () => selectProject(p.id));
      listEl.appendChild(div);
    });
  }

  // ---------------------------------------------------------------------
  // 分頁切換
  // ---------------------------------------------------------------------
  const TAB_IDS = ['tasks', 'calendar', 'gantt', 'issues'];
  function switchTab(tab) {
    TAB_IDS.forEach((id) => {
      document.getElementById(`tab-${id}`).classList.toggle('active', id === tab);
      document.getElementById(`panel-${id}`).classList.toggle('active', id === tab);
    });
    if (tab === 'calendar') renderCalendar();
    if (tab === 'gantt') renderGantt();
    if (tab === 'issues') renderIssues();
  }
  TAB_IDS.forEach((id) => {
    document.getElementById(`tab-${id}`).addEventListener('click', () => switchTab(id));
  });

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
      row.appendChild(startDateInput);
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
      startDate: null,
      dueDate: null,
    });
    newTaskInput.value = '';
    renderTasks();
  });
  newTaskInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-add-task').click();
  });

  // ---------------------------------------------------------------------
  // 月曆檢視：把任務（依 dueDate）跟 issue（依 dueDate）畫在月曆格子上
  // ---------------------------------------------------------------------
  function collectItemsByDate() {
    const map = {};
    editingTasks.forEach((t) => {
      if (t.dueDate) {
        (map[t.dueDate] = map[t.dueDate] || []).push({ kind: 'task', ref: t });
      }
    });
    editingIssues.forEach((i) => {
      if (i.dueDate) {
        (map[i.dueDate] = map[i.dueDate] || []).push({ kind: 'issue', ref: i });
      }
    });
    return map;
  }

  function renderCalendarWeekdays() {
    calWeekdaysEl.innerHTML = '';
    for (let i = 0; i < 7; i++) {
      const el = document.createElement('div');
      el.className = 'cal-weekday';
      el.textContent = window.i18n.t(`project.weekday${i}`);
      calWeekdaysEl.appendChild(el);
    }
  }

  function renderCalendar() {
    renderCalendarWeekdays();
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    calToolbarLabel.textContent = window.i18n.t('project.calendarMonthLabel', {
      year,
      month: month + 1,
    });

    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const itemsByDate = collectItemsByDate();
    const todayStr = formatDateLocal(new Date());

    calGridEl.innerHTML = '';
    const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
    for (let i = 0; i < totalCells; i++) {
      const dayNum = i - firstWeekday + 1;
      const cell = document.createElement('div');
      cell.className = 'cal-cell';

      if (dayNum < 1 || dayNum > daysInMonth) {
        cell.classList.add('cal-cell-empty');
      } else {
        const dateStr = formatDateLocal(new Date(year, month, dayNum));
        if (dateStr === todayStr) cell.classList.add('cal-cell-today');
        if (dateStr === selectedCalendarDate) cell.classList.add('selected');

        const label = document.createElement('div');
        label.className = 'cal-cell-date';
        label.textContent = String(dayNum);
        cell.appendChild(label);

        const items = itemsByDate[dateStr] || [];
        if (items.length > 0) {
          const dots = document.createElement('div');
          dots.className = 'cal-cell-dots';
          items.slice(0, 4).forEach((item) => {
            const dot = document.createElement('span');
            dot.className =
              item.kind === 'task'
                ? `cal-dot cal-dot-task-${item.ref.status}`
                : `cal-dot cal-dot-issue-${item.ref.priority}`;
            dot.title = item.ref.title;
            dots.appendChild(dot);
          });
          if (items.length > 4) {
            const more = document.createElement('span');
            more.className = 'cal-more';
            more.textContent = `+${items.length - 4}`;
            dots.appendChild(more);
          }
          cell.appendChild(dots);
        }

        cell.addEventListener('click', () => {
          selectedCalendarDate = dateStr;
          renderCalendar();
          renderDayDetail(dateStr, items);
        });
      }
      calGridEl.appendChild(cell);
    }

    if (selectedCalendarDate) {
      renderDayDetail(selectedCalendarDate, itemsByDate[selectedCalendarDate] || []);
    } else {
      calDayDetailEl.innerHTML = '';
    }
  }

  function renderDayDetail(dateStr, items) {
    calDayDetailEl.innerHTML = '';
    const heading = document.createElement('div');
    heading.className = 'cal-day-detail-heading';
    heading.textContent = dateStr;
    calDayDetailEl.appendChild(heading);

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'settings-hint';
      empty.textContent = window.i18n.t('project.calendarNoItems');
      calDayDetailEl.appendChild(empty);
      return;
    }
    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'cal-day-detail-row';
      const dot = document.createElement('span');
      dot.className =
        item.kind === 'task'
          ? `cal-dot cal-dot-task-${item.ref.status}`
          : `cal-dot cal-dot-issue-${item.ref.priority}`;
      const icon = document.createElement('span');
      icon.textContent = item.kind === 'task' ? '✅' : '🐞';
      const title = document.createElement('span');
      title.textContent = item.ref.title || window.i18n.t('project.unnamed');
      row.appendChild(dot);
      row.appendChild(icon);
      row.appendChild(title);
      calDayDetailEl.appendChild(row);
    });
  }

  document.getElementById('btn-cal-prev').addEventListener('click', () => {
    calendarMonth = new Date(
      calendarMonth.getFullYear(),
      calendarMonth.getMonth() - 1,
      1
    );
    renderCalendar();
  });
  document.getElementById('btn-cal-next').addEventListener('click', () => {
    calendarMonth = new Date(
      calendarMonth.getFullYear(),
      calendarMonth.getMonth() + 1,
      1
    );
    renderCalendar();
  });
  document.getElementById('btn-cal-today').addEventListener('click', () => {
    calendarMonth = startOfMonth(new Date());
    selectedCalendarDate = formatDateLocal(new Date());
    renderCalendar();
  });

  // ---------------------------------------------------------------------
  // 甘特圖：只用有 startDate 或 dueDate 的任務畫橫向時間軸
  // ---------------------------------------------------------------------
  function renderGantt() {
    const bars = [];
    editingTasks.forEach((t) => {
      if (!t.startDate && !t.dueDate) return;
      const start = parseLocalDate(t.startDate || t.dueDate);
      const end = parseLocalDate(t.dueDate || t.startDate);
      const [s, e] = start <= end ? [start, end] : [end, start];
      bars.push({
        title: t.title || window.i18n.t('project.unnamed'),
        start: s,
        end: e,
        status: t.status,
      });
    });

    ganttContainerEl.innerHTML = '';
    if (bars.length === 0) {
      ganttEmptyEl.style.display = 'block';
      ganttContainerEl.style.display = 'none';
      return;
    }
    ganttEmptyEl.style.display = 'none';
    ganttContainerEl.style.display = 'block';

    bars.sort((a, b) => a.start - b.start);
    let minDate = bars.reduce((m, b) => (b.start < m ? b.start : m), bars[0].start);
    let maxDate = bars.reduce((m, b) => (b.end > m ? b.end : m), bars[0].end);
    minDate = addDays(minDate, -1);
    maxDate = addDays(maxDate, 1);
    const totalDays = Math.max(1, Math.round((maxDate - minDate) / 86400000));

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayInRange = today >= minDate && today <= maxDate;
    const todayPct = todayInRange
      ? ((today - minDate) / 86400000 / totalDays) * 100
      : null;

    // 表頭：畫出每個月份的分界標籤
    const header = document.createElement('div');
    header.className = 'gantt-header';
    const headerLabel = document.createElement('div');
    headerLabel.className = 'gantt-label';
    const headerTrack = document.createElement('div');
    headerTrack.className = 'gantt-header-track';
    let cursor = new Date(minDate);
    while (cursor <= maxDate) {
      if (cursor.getDate() === 1 || cursor.getTime() === minDate.getTime()) {
        const offsetDays = Math.round((cursor - minDate) / 86400000);
        const marker = document.createElement('div');
        marker.className = 'gantt-month-marker';
        marker.style.left = `${(offsetDays / totalDays) * 100}%`;
        marker.textContent = window.i18n.t('project.ganttMonthLabel', {
          month: cursor.getMonth() + 1,
        });
        headerTrack.appendChild(marker);
      }
      cursor = addDays(cursor, 1);
    }
    header.appendChild(headerLabel);
    header.appendChild(headerTrack);
    ganttContainerEl.appendChild(header);

    bars.forEach((bar) => {
      const row = document.createElement('div');
      row.className = 'gantt-row';

      const label = document.createElement('div');
      label.className = 'gantt-label';
      label.textContent = bar.title;
      label.title = bar.title;

      const track = document.createElement('div');
      track.className = 'gantt-track';

      if (todayPct !== null) {
        const line = document.createElement('div');
        line.className = 'gantt-today-line';
        line.style.left = `${todayPct}%`;
        track.appendChild(line);
      }

      const startOffset = Math.round((bar.start - minDate) / 86400000);
      const durationDays = Math.round((bar.end - bar.start) / 86400000) + 1;
      const barEl = document.createElement('div');
      barEl.className = `gantt-bar gantt-bar-${bar.status}`;
      barEl.style.left = `${(startOffset / totalDays) * 100}%`;
      barEl.style.width = `${Math.max((durationDays / totalDays) * 100, 1.5)}%`;
      barEl.title = `${bar.title}\n${formatDateLocal(bar.start)} ~ ${formatDateLocal(bar.end)}`;
      track.appendChild(barEl);

      row.appendChild(label);
      row.appendChild(track);
      ganttContainerEl.appendChild(row);
    });
  }

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

  // ---------------------------------------------------------------------
  // 跨專案總覽：把所有專案的月曆／甘特圖／Issue 疊在一起看（純讀取，不編輯）
  // ---------------------------------------------------------------------
  function projectColor(projectId) {
    const idx = allProjects.findIndex((p) => p.id === projectId);
    return PROJECT_COLORS[(idx >= 0 ? idx : 0) % PROJECT_COLORS.length];
  }

  function setListToolbarActive(mode) {
    document
      .getElementById('btn-overview')
      .classList.toggle('active', mode === 'overview');
  }

  function renderOverviewLegend() {
    const legendEl = document.getElementById('ov-legend');
    legendEl.innerHTML = '';
    if (allProjects.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'settings-hint';
      empty.textContent = window.i18n.t('project.overviewNoProjects');
      legendEl.appendChild(empty);
      return;
    }
    allProjects.forEach((p) => {
      const item = document.createElement('span');
      item.className = 'ov-legend-item';
      const swatch = document.createElement('span');
      swatch.className = 'ov-legend-swatch';
      swatch.style.background = projectColor(p.id);
      const name = document.createElement('span');
      name.textContent = p.name || window.i18n.t('project.unnamed');
      item.appendChild(swatch);
      item.appendChild(name);
      item.addEventListener('click', () => jumpToProject(p.id, 'tasks'));
      legendEl.appendChild(item);
    });
  }

  const OVERVIEW_TAB_IDS = ['calendar', 'gantt', 'issues'];
  function switchOverviewTab(tab) {
    OVERVIEW_TAB_IDS.forEach((id) => {
      document.getElementById(`tab-ov-${id}`).classList.toggle('active', id === tab);
      document.getElementById(`ov-panel-${id}`).classList.toggle('active', id === tab);
    });
    if (tab === 'calendar') renderOverviewCalendar();
    if (tab === 'gantt') renderOverviewGantt();
    if (tab === 'issues') renderOverviewIssues();
  }
  OVERVIEW_TAB_IDS.forEach((id) => {
    document
      .getElementById(`tab-ov-${id}`)
      .addEventListener('click', () => switchOverviewTab(id));
  });

  function jumpToProject(projectId, tab) {
    selectProject(projectId, tab);
  }

  function collectOverviewItemsByDate() {
    const map = {};
    allProjects.forEach((p) => {
      (p.tasks || []).forEach((t) => {
        if (t.dueDate) {
          (map[t.dueDate] = map[t.dueDate] || []).push({
            kind: 'task',
            ref: t,
            project: p,
          });
        }
      });
      (p.issues || []).forEach((i) => {
        if (i.dueDate) {
          (map[i.dueDate] = map[i.dueDate] || []).push({
            kind: 'issue',
            ref: i,
            project: p,
          });
        }
      });
    });
    return map;
  }

  function renderOverviewCalendarWeekdays() {
    const el = document.getElementById('ov-cal-weekdays');
    el.innerHTML = '';
    for (let i = 0; i < 7; i++) {
      const d = document.createElement('div');
      d.className = 'cal-weekday';
      d.textContent = window.i18n.t(`project.weekday${i}`);
      el.appendChild(d);
    }
  }

  function renderOverviewCalendar() {
    renderOverviewCalendarWeekdays();
    const year = overviewCalMonth.getFullYear();
    const month = overviewCalMonth.getMonth();
    document.getElementById('ov-cal-month-label').textContent = window.i18n.t(
      'project.calendarMonthLabel',
      { year, month: month + 1 }
    );

    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const itemsByDate = collectOverviewItemsByDate();
    const todayStr = formatDateLocal(new Date());

    const gridEl = document.getElementById('ov-cal-grid');
    gridEl.innerHTML = '';
    const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
    for (let i = 0; i < totalCells; i++) {
      const dayNum = i - firstWeekday + 1;
      const cell = document.createElement('div');
      cell.className = 'cal-cell';

      if (dayNum < 1 || dayNum > daysInMonth) {
        cell.classList.add('cal-cell-empty');
      } else {
        const dateStr = formatDateLocal(new Date(year, month, dayNum));
        if (dateStr === todayStr) cell.classList.add('cal-cell-today');
        if (dateStr === overviewSelectedDate) cell.classList.add('selected');

        const label = document.createElement('div');
        label.className = 'cal-cell-date';
        label.textContent = String(dayNum);
        cell.appendChild(label);

        const items = itemsByDate[dateStr] || [];
        if (items.length > 0) {
          const dots = document.createElement('div');
          dots.className = 'cal-cell-dots';
          items.slice(0, 4).forEach((item) => {
            const dot = document.createElement('span');
            dot.className = 'cal-dot';
            dot.style.background = projectColor(item.project.id);
            dot.title = `${item.project.name}：${item.ref.title}`;
            dots.appendChild(dot);
          });
          if (items.length > 4) {
            const more = document.createElement('span');
            more.className = 'cal-more';
            more.textContent = `+${items.length - 4}`;
            dots.appendChild(more);
          }
          cell.appendChild(dots);
        }

        cell.addEventListener('click', () => {
          overviewSelectedDate = dateStr;
          renderOverviewCalendar();
          renderOverviewDayDetail(dateStr, items);
        });
      }
      gridEl.appendChild(cell);
    }

    if (overviewSelectedDate) {
      renderOverviewDayDetail(
        overviewSelectedDate,
        itemsByDate[overviewSelectedDate] || []
      );
    } else {
      document.getElementById('ov-cal-day-detail').innerHTML = '';
    }
  }

  function renderOverviewDayDetail(dateStr, items) {
    const detailEl = document.getElementById('ov-cal-day-detail');
    detailEl.innerHTML = '';
    const heading = document.createElement('div');
    heading.className = 'cal-day-detail-heading';
    heading.textContent = dateStr;
    detailEl.appendChild(heading);

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'settings-hint';
      empty.textContent = window.i18n.t('project.calendarNoItems');
      detailEl.appendChild(empty);
      return;
    }
    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'cal-day-detail-row clickable';
      const dot = document.createElement('span');
      dot.className = 'cal-dot';
      dot.style.background = projectColor(item.project.id);
      const icon = document.createElement('span');
      icon.textContent = item.kind === 'task' ? '✅' : '🐞';
      const title = document.createElement('span');
      title.textContent = `${item.project.name}：${item.ref.title || window.i18n.t('project.unnamed')}`;
      row.appendChild(dot);
      row.appendChild(icon);
      row.appendChild(title);
      row.addEventListener('click', () =>
        jumpToProject(item.project.id, item.kind === 'task' ? 'tasks' : 'issues')
      );
      detailEl.appendChild(row);
    });
  }

  document.getElementById('btn-ov-cal-prev').addEventListener('click', () => {
    overviewCalMonth = new Date(
      overviewCalMonth.getFullYear(),
      overviewCalMonth.getMonth() - 1,
      1
    );
    renderOverviewCalendar();
  });
  document.getElementById('btn-ov-cal-next').addEventListener('click', () => {
    overviewCalMonth = new Date(
      overviewCalMonth.getFullYear(),
      overviewCalMonth.getMonth() + 1,
      1
    );
    renderOverviewCalendar();
  });
  document.getElementById('btn-ov-cal-today').addEventListener('click', () => {
    overviewCalMonth = startOfMonth(new Date());
    overviewSelectedDate = formatDateLocal(new Date());
    renderOverviewCalendar();
  });

  function renderOverviewGantt() {
    const bars = [];
    allProjects.forEach((p) => {
      (p.tasks || []).forEach((t) => {
        if (!t.startDate && !t.dueDate) return;
        const start = parseLocalDate(t.startDate || t.dueDate);
        const end = parseLocalDate(t.dueDate || t.startDate);
        const [s, e] = start <= end ? [start, end] : [end, start];
        bars.push({
          title: `${p.name}：${t.title || window.i18n.t('project.unnamed')}`,
          start: s,
          end: e,
          status: t.status,
          color: projectColor(p.id),
          projectId: p.id,
        });
      });
    });

    const ganttEmptyOv = document.getElementById('ov-gantt-empty');
    const ganttContainerOv = document.getElementById('ov-gantt-container');
    ganttContainerOv.innerHTML = '';
    if (bars.length === 0) {
      ganttEmptyOv.style.display = 'block';
      ganttContainerOv.style.display = 'none';
      return;
    }
    ganttEmptyOv.style.display = 'none';
    ganttContainerOv.style.display = 'block';

    bars.sort((a, b) => a.start - b.start);
    let minDate = bars.reduce((m, b) => (b.start < m ? b.start : m), bars[0].start);
    let maxDate = bars.reduce((m, b) => (b.end > m ? b.end : m), bars[0].end);
    minDate = addDays(minDate, -1);
    maxDate = addDays(maxDate, 1);
    const totalDays = Math.max(1, Math.round((maxDate - minDate) / 86400000));

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayInRange = today >= minDate && today <= maxDate;
    const todayPct = todayInRange
      ? ((today - minDate) / 86400000 / totalDays) * 100
      : null;

    const header = document.createElement('div');
    header.className = 'gantt-header';
    const headerLabel = document.createElement('div');
    headerLabel.className = 'gantt-label';
    const headerTrack = document.createElement('div');
    headerTrack.className = 'gantt-header-track';
    let cursor = new Date(minDate);
    while (cursor <= maxDate) {
      if (cursor.getDate() === 1 || cursor.getTime() === minDate.getTime()) {
        const offsetDays = Math.round((cursor - minDate) / 86400000);
        const marker = document.createElement('div');
        marker.className = 'gantt-month-marker';
        marker.style.left = `${(offsetDays / totalDays) * 100}%`;
        marker.textContent = window.i18n.t('project.ganttMonthLabel', {
          month: cursor.getMonth() + 1,
        });
        headerTrack.appendChild(marker);
      }
      cursor = addDays(cursor, 1);
    }
    header.appendChild(headerLabel);
    header.appendChild(headerTrack);
    ganttContainerOv.appendChild(header);

    bars.forEach((bar) => {
      const row = document.createElement('div');
      row.className = 'gantt-row';

      const label = document.createElement('div');
      label.className = 'gantt-label';
      label.textContent = bar.title;
      label.title = bar.title;
      label.style.cursor = 'pointer';
      label.addEventListener('click', () => jumpToProject(bar.projectId, 'gantt'));

      const track = document.createElement('div');
      track.className = 'gantt-track';

      if (todayPct !== null) {
        const line = document.createElement('div');
        line.className = 'gantt-today-line';
        line.style.left = `${todayPct}%`;
        track.appendChild(line);
      }

      const startOffset = Math.round((bar.start - minDate) / 86400000);
      const durationDays = Math.round((bar.end - bar.start) / 86400000) + 1;
      const barEl = document.createElement('div');
      barEl.className = `gantt-bar gantt-bar-${bar.status}`;
      barEl.style.left = `${(startOffset / totalDays) * 100}%`;
      barEl.style.width = `${Math.max((durationDays / totalDays) * 100, 1.5)}%`;
      barEl.style.borderLeft = `3px solid ${bar.color}`;
      barEl.title = `${bar.title}\n${formatDateLocal(bar.start)} ~ ${formatDateLocal(bar.end)}`;
      track.appendChild(barEl);

      row.appendChild(label);
      row.appendChild(track);
      ganttContainerOv.appendChild(row);
    });
  }

  function renderOverviewIssues() {
    const listEl2 = document.getElementById('ov-issue-list');
    listEl2.innerHTML = '';
    const filterStatus = document.getElementById('ov-issue-filter-status').value;

    const rows = [];
    allProjects.forEach((p) => {
      (p.issues || []).forEach((i) => {
        if (filterStatus && i.status !== filterStatus) return;
        rows.push({ issue: i, project: p });
      });
    });

    rows.forEach(({ issue, project }) => {
      const row = document.createElement('div');
      row.className = 'ov-issue-row';
      const dot = document.createElement('span');
      dot.className = 'ov-issue-dot';
      dot.style.background = projectColor(project.id);
      const projName = document.createElement('span');
      projName.className = 'ov-issue-project';
      projName.textContent = project.name || window.i18n.t('project.unnamed');
      const title = document.createElement('span');
      title.className = 'ov-issue-title';
      title.textContent = issue.title || window.i18n.t('project.unnamed');
      const typeBadge = document.createElement('span');
      typeBadge.textContent = window.i18n.t(`project.issueType${capitalize(issue.type)}`);
      const priorityBadge = document.createElement('span');
      priorityBadge.className = `issue-priority-badge issue-priority-${issue.priority}`;
      priorityBadge.textContent = window.i18n.t(
        `project.issuePriority${capitalize(issue.priority)}`
      );
      const statusBadge = document.createElement('span');
      statusBadge.className = 'status-badge';
      statusBadge.textContent = window.i18n.t(
        `project.issueStatus${capitalize(issue.status)}`
      );
      const due = document.createElement('span');
      due.className = 'ov-issue-due';
      due.textContent = issue.dueDate || '';

      row.appendChild(dot);
      row.appendChild(projName);
      row.appendChild(title);
      row.appendChild(typeBadge);
      row.appendChild(priorityBadge);
      row.appendChild(statusBadge);
      row.appendChild(due);
      row.addEventListener('click', () => jumpToProject(project.id, 'issues'));
      listEl2.appendChild(row);
    });

    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'settings-hint';
      empty.textContent = window.i18n.t('project.emptyIssues');
      listEl2.appendChild(empty);
    }
  }
  document
    .getElementById('ov-issue-filter-status')
    .addEventListener('change', renderOverviewIssues);

  function showOverview() {
    currentProjectId = null;
    editorEl.style.display = 'none';
    emptyEl.style.display = 'none';
    document.getElementById('proj-overview').style.display = 'flex';
    setListToolbarActive('overview');
    renderList();
    renderOverviewLegend();
    switchOverviewTab('calendar');
  }
  document.getElementById('btn-overview').addEventListener('click', showOverview);

  // ---------------------------------------------------------------------
  // 專案編輯
  // ---------------------------------------------------------------------
  function selectProject(id, initialTab) {
    document.getElementById('proj-overview').style.display = 'none';
    setListToolbarActive('project');
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
    switchTab(initialTab || 'tasks');
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
