const { Notification } = require('electron');
const { loadProjects } = require('./stores');
const { broadcastToAllWindows } = require('./broadcast');
const { logAudit } = require('./logs');
const state = require('./state');

// ---------------------------------------------------------------------------
// 任務到期日提醒
//
// 掃描所有專案裡「還沒完成」的任務跟 issue，依 dueDate 分成「已逾期」
// 跟「今天到期」兩類，回傳給側邊欄角標顯示，並在有新的到期項目時彈一次
// 原生系統通知。故意不管已經完成的項目（task.status === 'done' /
// issue.status 是 resolved/closed）——已完成的東西再提醒沒有意義。
// ---------------------------------------------------------------------------

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function isTaskOpen(task) {
  return task.status !== 'done';
}

function isIssueOpen(issue) {
  return issue.status !== 'resolved' && issue.status !== 'closed';
}

/**
 * 掃描所有專案，回傳到期摘要：
 *   { overdueCount, dueTodayCount, items: [{ projectId, projectName, kind, id, title, dueDate, overdue }] }
 * dueDate 用 ISO 'YYYY-MM-DD' 字串直接比較大小（跟任務表單存的格式一致，
 * 不用轉成 Date 物件也能正確排序/比較）。
 */
function getDueSummary() {
  const today = todayStr();
  const items = [];

  loadProjects().forEach((project) => {
    (project.tasks || []).forEach((task) => {
      if (!task.dueDate || !isTaskOpen(task)) return;
      if (task.dueDate > today) return;
      items.push({
        projectId: project.id,
        projectName: project.name || '',
        kind: 'task',
        id: task.id,
        title: task.title || '',
        dueDate: task.dueDate,
        overdue: task.dueDate < today,
      });
    });
    (project.issues || []).forEach((issue) => {
      if (!issue.dueDate || !isIssueOpen(issue)) return;
      if (issue.dueDate > today) return;
      items.push({
        projectId: project.id,
        projectName: project.name || '',
        kind: 'issue',
        id: issue.id,
        title: issue.title || '',
        dueDate: issue.dueDate,
        overdue: issue.dueDate < today,
      });
    });
  });

  const overdueCount = items.filter((i) => i.overdue).length;
  const dueTodayCount = items.length - overdueCount;
  return { overdueCount, dueTodayCount, items };
}

// 系統通知的文字直接在這裡維護三語版本，不透過 renderer 的 i18n 系統
// （那套是 fetch JSON + DOM 套用，main process 沒有 DOM，硬要共用反而
// 更複雜）。只有這一個通知用得到，維護成本可以接受。
const REMINDER_TEXT = {
  'zh-TW': {
    title: 'Platter 專案提醒',
    overdue: (n) => `${n} 項已逾期`,
    dueToday: (n) => `${n} 項今天到期`,
  },
  en: {
    title: 'Platter Project Reminder',
    overdue: (n) => `${n} overdue`,
    dueToday: (n) => `${n} due today`,
  },
  ja: {
    title: 'Platter プロジェクトリマインダー',
    overdue: (n) => `${n} 件期限超過`,
    dueToday: (n) => `${n} 件本日期限`,
  },
};

function textFor(lang) {
  return REMINDER_TEXT[lang] || REMINDER_TEXT['zh-TW'];
}

// 記住上一次「已經跳過原生通知」的內容指紋（不是單純的總數，是每個
// 到期項目 id + 逾期/今天到期 狀態排序後串起來），避免同一批到期項目
// 每次排程檢查（每小時一次）都再彈一次通知——但只要有任何項目變成
// 到期、或狀態從「今天到期」變成「已逾期」（時間走到隔天），指紋就會
// 變，就會再通知一次。
let lastNotifiedFingerprint = null;

function fingerprintOf(summary) {
  return summary.items
    .map((i) => `${i.kind}:${i.id}:${i.overdue ? 'overdue' : 'today'}`)
    .sort()
    .join('|');
}

function checkDueTasksAndNotify() {
  const summary = getDueSummary();
  broadcastToAllWindows('reminders:changed', {
    overdueCount: summary.overdueCount,
    dueTodayCount: summary.dueTodayCount,
  });

  if (summary.items.length === 0) return;

  const fingerprint = fingerprintOf(summary);
  if (fingerprint === lastNotifiedFingerprint) return; // 跟上次通知的內容一樣，不要重複打擾
  lastNotifiedFingerprint = fingerprint;

  if (!Notification.isSupported()) return;

  const text = textFor(state.appState.ui.language);
  const parts = [];
  if (summary.overdueCount > 0) parts.push(text.overdue(summary.overdueCount));
  if (summary.dueTodayCount > 0) parts.push(text.dueToday(summary.dueTodayCount));

  const notification = new Notification({
    title: text.title,
    body: parts.join('、'),
    silent: false,
  });
  notification.show();
  logAudit('project', 'dueReminder', `到期提醒：${parts.join('、')}`);
}

// 每小時檢查一次，加上開機時的一次立即檢查（見 startDueTaskReminders()，
// 由 main.js 在 app.whenReady() 裡呼叫）。用 setInterval 而不是精準算好
// 「明天 00:00 再檢查」那種排程，是因為使用者電腦睡眠/喚醒時
// setTimeout/setInterval 排定的時間本來就會被系統延後執行，沒有真正的
// 精準保證；每小時檢查一次「夠即時」、實作也簡單可靠，犧牲一點準時性
// 換取更少的邊角案例。
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

function startDueTaskReminders() {
  checkDueTasksAndNotify();
  setInterval(checkDueTasksAndNotify, CHECK_INTERVAL_MS);
}

module.exports = {
  getDueSummary,
  checkDueTasksAndNotify,
  startDueTaskReminders,
};
