/**
 * renderer/project/project-calendar.js — 月曆檢視
 *
 * 專案視窗（project.html）的一部分。這些檔案是「一般 <script>」，彼此共用全域詞法作用域
 * （頂層的 const／let／function 互相看得到），載入順序見 project.html，project-main.js 必須最後載入。
 */
/* global calDayDetailEl, calGridEl, calToolbarLabel, calWeekdaysEl, calendarMonth, editingIssues, editingTasks, formatDateLocal, selectedCalendarDate, startOfMonth */
/* exported renderCalendar */

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
