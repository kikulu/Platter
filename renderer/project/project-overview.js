/**
 * renderer/project/project-overview.js — 跨專案總覽
 *
 * 專案視窗（project.html）的一部分。這些檔案是「一般 <script>」，彼此共用全域詞法作用域
 * （頂層的 const／let／function 互相看得到），載入順序見 project.html，project-main.js 必須最後載入。
 */
/* global PROJECT_COLORS, addDays, allProjects, capitalize, currentProjectId, editorEl, emptyEl, formatDateLocal, overviewCalMonth, overviewSelectedDate, parseLocalDate, renderList, selectProject, startOfMonth, templatePickerEl */
/* exported setListToolbarActive */

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
  document
    .getElementById('btn-new-from-template')
    .classList.toggle('active', mode === 'template');
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
  templatePickerEl.style.display = 'none';
  editorEl.style.display = 'none';
  emptyEl.style.display = 'none';
  document.getElementById('proj-overview').style.display = 'flex';
  setListToolbarActive('overview');
  renderList();
  renderOverviewLegend();
  switchOverviewTab('calendar');
}
document.getElementById('btn-overview').addEventListener('click', showOverview);
