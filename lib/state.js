const { DEFAULT_UI_STATE } = require('./constants');

// main process 執行期間的共用可變狀態，集中放在這裡讓拆開後的各模組
// 讀寫同一份資料，不會因為搬到不同檔案就各自產生一份副本。
//
// 使用方式：永遠透過 `state.appState.xxx`、`state.mainWindow` 這種「每次都
// 重新讀取屬性」的寫法存取，不要在模組頂層 `const { appState } = state`
// 解構快取起來——appState 這個屬性本身會在 loadAppState() 被整個換掉
// （見 lib/stores.js），解構出來的那份參照會變成舊資料，跟著新版失去同步。
const state = {
  // --- 視窗參照 ---
  mainWindow: null,
  accountWindow: null,
  knowledgeWindow: null,
  settingsWindow: null,
  teamWindow: null,
  projectWindow: null,
  documentsWindow: null,
  conversationsWindow: null,
  logWindow: null,

  // --- 帳號 WebContentsView：accountId -> { view, platform, name } ---
  accountViews: new Map(),
  activeAccountId: null,

  // --- 應用程式狀態（記憶體內，開機時載入，變更時寫回磁碟，見 lib/stores.js） ---
  appState: {
    accounts: [], // { id, platform, name, roleId }
    ui: { ...DEFAULT_UI_STATE },
    extensions: [], // { id, path, name, version, enabled }
    roles: [], // { id, name, description, color } — 帳號角色機制
  },

  // --- 主控台（Console）即時緩衝區，見 lib/console.js ---
  consoleBuffer: [],

  // --- 日誌主控台 SQLite 連線（sql.js），見 lib/logs.js ---
  logsDb: null,
  logsDbReady: false,
  pendingLogEntries: [],
};

module.exports = state;
