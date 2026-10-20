/**
 * renderer/project/project-core.js — DOM 參照、共用狀態、日期小工具、專案清單、分頁切換
 *
 * 專案視窗（project.html）的一部分。這些檔案是「一般 <script>」，彼此共用全域詞法作用域
 * （頂層的 const／let／function 互相看得到），載入順序見 project.html，project-main.js 必須最後載入。
 */
/* global renderCalendar, renderGantt, renderIssues, renderLinkedDocuments, renderWorkflow, selectProject */
/* exported PROJECT_COLORS, addDays, allAccounts, allDocuments, allKnowledgeItems, allProjects, calDayDetailEl, calGridEl, calToolbarLabel, calWeekdaysEl, calendarMonth, capitalize, currentProjectId, descInput, editingIssues, editingTasks, editorEl, emptyEl, endInput, expandedTimeTaskId, formatDateLocal, ganttContainerEl, ganttEmptyEl, genLocalId, issueFilterStatusEl, issueListEl, listEl, nameInput, newTaskInput, overviewCalMonth, overviewSelectedDate, parseLocalDate, renderList, selectedCalendarDate, startInput, startOfMonth, statusSelect, switchTab, taskListEl, taskProgressEl, taskTotalHoursEl, templatePickerEl */

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
const taskTotalHoursEl = document.getElementById('proj-task-total-hours');

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

const templatePickerEl = document.getElementById('proj-template-picker');

let allProjects = [];
let allAccounts = [];
let allDocuments = []; // 文件庫清單，關聯文件分頁跟簡報橋接都要用
let allKnowledgeItems = []; // 知識庫項目，簡報橋接只挑標籤含「簡報製作」的
let currentProjectId = null;
let editingTasks = [];
let expandedTimeTaskId = null; // 目前展開「工時紀錄」面板的任務 id，切換任務清單時重置
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
const TAB_IDS = ['tasks', 'calendar', 'gantt', 'issues', 'workflow', 'linked'];
function switchTab(tab) {
  TAB_IDS.forEach((id) => {
    document.getElementById(`tab-${id}`).classList.toggle('active', id === tab);
    document.getElementById(`panel-${id}`).classList.toggle('active', id === tab);
  });
  if (tab === 'calendar') renderCalendar();
  if (tab === 'gantt') renderGantt();
  if (tab === 'issues') renderIssues();
  if (tab === 'workflow') renderWorkflow();
  if (tab === 'linked') renderLinkedDocuments();
}
TAB_IDS.forEach((id) => {
  document.getElementById(`tab-${id}`).addEventListener('click', () => switchTab(id));
});
