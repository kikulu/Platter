const { app, ipcMain, Menu, BrowserWindow } = require('electron');
// 覆蓋全域 console.*（見 lib/console.js 內的說明）：這行必須在最前面就
// require，讓之後所有模組（含下面這些 lib/** 的 require）的 console.log
// 都會被攔截記錄進「主控台」即時緩衝區。
require('./lib/console');

const state = require('./lib/state');
const { initLogsDatabase, saveLogsDatabase, logError } = require('./lib/logs');
const { loadAppState } = require('./lib/stores');
const { createMainWindow } = require('./lib/windows');
const { registerIpcHandlers } = require('./lib/ipc');
const { startDueTaskReminders } = require('./lib/reminders');

// ---------------------------------------------------------------------------
// main.js（App 入口）
//
// 常數、共用狀態、資料層、視窗管理、對話擷取/匯出、IPC handlers 都已經
// 拆進 lib/**，main.js 只保留 App 生命週期本身。各檔案的職責分工見
// PROJECT_SPEC.md 第 15 節「檔案結構」。
// ---------------------------------------------------------------------------

// 單一實例鎖：兩個 Platter 進程同時指向同一個 userData 資料夾（同一份
// Chromium 磁碟快取/service worker/quota 資料庫）時，其中一個對快取檔案
// 的讀寫會被另一個鎖住，就是這類 "Unable to create cache" / "Unable to
// move the cache"（Windows 上常見錯誤碼 0x5 = 存取被拒）/ "Could not open
// the quota database, resetting" 錯誤最常見的起因。拿不到鎖就直接退出，
// 並把「使用者又點了一次啟動」導向已經開著的那個視窗，而不是真的再開一個
// 進程出來搶同一份快取。
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (state.mainWindow) {
      if (state.mainWindow.isMinimized()) state.mainWindow.restore();
      state.mainWindow.focus();
    }
  });

  // 全域錯誤保護網：main process 沒被 try/catch 接住的例外都會記錄進錯誤
  // 日誌，方便在「日誌主控台」裡回溯，而不是只留在終端機/使用者根本看不到。
  process.on('uncaughtException', (err) => {
    logError('process', '未捕捉的例外 (uncaughtException)', err);
  });
  process.on('unhandledRejection', (reason) => {
    logError(
      'process',
      '未處理的 Promise rejection (unhandledRejection)',
      reason instanceof Error ? reason : new Error(String(reason))
    );
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    await initLogsDatabase();
    loadAppState();
    registerIpcHandlers(ipcMain);
    createMainWindow();
    // 開機先立刻檢查一次到期任務/issue，之後每小時再檢查一次（見
    // lib/reminders.js），不用等使用者去開專案視窗才知道有東西過期了。
    startDueTaskReminders();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // sql.js 的資料庫整個活在記憶體裡，退出前多存一次檔當保險（appendLogEntry
  // 每次寫入其實已經立刻存檔了，這裡只是防呆，理論上不會真的補到東西）。
  app.on('before-quit', () => {
    saveLogsDatabase();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
}
