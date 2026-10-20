/**
 * renderer/project/project-gantt.js — 甘特圖
 *
 * 專案視窗（project.html）的一部分。這些檔案是「一般 <script>」，彼此共用全域詞法作用域
 * （頂層的 const／let／function 互相看得到），載入順序見 project.html，project-main.js 必須最後載入。
 */
/* global addDays, editingTasks, formatDateLocal, ganttContainerEl, ganttEmptyEl, parseLocalDate */
/* exported renderGantt */

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
