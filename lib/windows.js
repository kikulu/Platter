const path = require('path');
const { app, BrowserWindow, WebContentsView, session } = require('electron');
const { genId } = require('./utils');
const {
  PLATFORM_URLS,
  SIDEBAR_WIDTH_EXPANDED,
  SIDEBAR_WIDTH_COLLAPSED,
} = require('./constants');
const state = require('./state');
const { saveAppState } = require('./stores');
const { logError } = require('./logs');
const { captureConsole } = require('./console');

// ---------------------------------------------------------------------------
// 視窗 / View 管理
// ---------------------------------------------------------------------------

function getContentBounds() {
  if (!state.mainWindow) return { x: 0, y: 0, width: 0, height: 0 };
  const [winWidth, winHeight] = state.mainWindow.getContentSize();
  const sidebarWidth = state.appState.ui.sidebarCollapsed
    ? SIDEBAR_WIDTH_COLLAPSED
    : SIDEBAR_WIDTH_EXPANDED;
  return {
    x: sidebarWidth,
    y: 0,
    width: Math.max(0, winWidth - sidebarWidth),
    height: winHeight,
  };
}

function layoutActiveView() {
  if (!state.activeAccountId) return;
  const entry = state.accountViews.get(state.activeAccountId);
  if (!entry || !entry.view) return;
  entry.view.setBounds(getContentBounds());
}

function applyExtensionsToSession(ses) {
  state.appState.extensions
    .filter((ext) => ext.enabled)
    .forEach((ext) => {
      ses.loadExtension(ext.path, { allowFileAccess: true }).catch((err) => {
        logError('extensions:load', `載入擴充功能失敗: ${ext.path}`, err);
      });
    });
}

// 只登記帳號的中繼資料（平台/名稱），不建立真正的 WebContentsView、
// 也不去 loadURL——WebContentsView 本身很輕，但 loadURL() 之後那個
// Chromium renderer process 就會開始跑一整個 Claude/ChatGPT 等級的
// React SPA，記憶體、CPU、GPU 合成都要吃資源。這裡刻意延後到真的
// 切換過去那一刻才建立（見 ensureAccountViewLoaded），這就是「懶
// 載入」的核心：開機時只有一個帳號會真的載入頁面，帳號數量不會直接
// 拖垮開機速度跟背景資源佔用（見 PROJECT_SPEC.md 第 3 節「懶載入」）。
function registerAccountMeta(account) {
  state.accountViews.set(account.id, {
    view: null,
    platform: account.platform,
    name: account.name,
  });
}

// 帳號第一次被切換過去時才真的建立 WebContentsView + loadURL，之後
// 這個帳號的 entry.view 就會一直存在（不會因為切到別的帳號就銷毀重
// 建），只是用 setVisible() 隱藏——這樣切換帳號時不用整頁重新載入，
// 跟原本的行為一致，只是「第一次」延後到真正需要的時候。
function ensureAccountViewLoaded(accountId) {
  const entry = state.accountViews.get(accountId);
  if (!entry || entry.view) return entry; // 找不到這個帳號，或已經載入過了

  const account = state.appState.accounts.find((a) => a.id === accountId);
  if (!account) return entry;

  const partition = `persist:${account.id}`;
  const ses = session.fromPartition(partition);
  applyExtensionsToSession(ses);

  const view = new WebContentsView({
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const url = PLATFORM_URLS[account.platform] || 'https://claude.ai';
  view.webContents.loadURL(url);

  // 診斷用：頁面載入失敗、頁面自己的 console 輸出，都餵進「主控台」即時日誌，
  // 方便排查「為什麼這個平台匯出/擷取不到對話」（例如頁面根本沒載入成功、
  // 或頁面本身噴了 JS 錯誤）。
  view.webContents.on(
    'did-fail-load',
    (event, errorCode, errorDescription, validatedURL) => {
      if (errorCode === -3) return; // ERR_ABORTED，通常是使用者自己導覽到別的頁面，不算錯誤
      logError(
        'account:load',
        `帳號「${account.name}」(${account.platform}) 頁面載入失敗: ${errorDescription} (${errorCode}) ${validatedURL}`
      );
    }
  );
  view.webContents.on('console-message', (...args) => {
    // Electron 版本間簽章不完全一致，這裡同時容錯處理舊版跟新版的參數形狀：
    //   舊版: (event, level, message, line, sourceId)
    //   新版: (event) 其中 event 本身帶 level/message/lineNumber/sourceId 屬性
    let message = null;
    if (args.length >= 3 && typeof args[2] === 'string') {
      message = args[2];
    } else if (
      args[0] &&
      typeof args[0] === 'object' &&
      typeof args[0].message === 'string'
    ) {
      message = args[0].message;
    }
    if (message) {
      captureConsole('page', [`[${account.platform}/${account.name}] ${message}`]);
    }
  });

  state.mainWindow.contentView.addChildView(view);
  view.setVisible(false);

  entry.view = view;
  return entry;
}

function rebuildAllAccountViews() {
  state.appState.accounts.forEach((account) => registerAccountMeta(account));
}

function switchAccount(accountId) {
  if (!state.accountViews.has(accountId)) return false;
  ensureAccountViewLoaded(accountId); // 第一次切過去才真的載入頁面
  state.accountViews.forEach((entry, id) => {
    if (entry.view) entry.view.setVisible(id === accountId);
  });
  state.activeAccountId = accountId;
  // 記住最後使用的帳號，下次開機直接懶載入回這個帳號，不是每次都固定
  // 回到清單第一個。
  state.appState.ui.lastActiveAccountId = accountId;
  saveAppState();
  layoutActiveView();
  return true;
}

function addAccount(platform, name, roleId) {
  const account = { id: genId(), platform, name, roleId: roleId || null };
  state.appState.accounts.push(account);
  saveAppState();
  registerAccountMeta(account);
  switchAccount(account.id); // 新增帳號代表使用者現在就要用它，立刻載入並切過去
  return account;
}

function removeAccount(accountId) {
  const entry = state.accountViews.get(accountId);
  if (entry) {
    if (entry.view) {
      state.mainWindow.contentView.removeChildView(entry.view);
    }
    const partition = `persist:${accountId}`;
    session
      .fromPartition(partition)
      .clearStorageData()
      .catch((err) => {
        logError('account:remove', `清除帳號 session 資料失敗: ${partition}`, err);
      });
    state.accountViews.delete(accountId);
  }
  state.appState.accounts = state.appState.accounts.filter((a) => a.id !== accountId);
  saveAppState();
  if (state.activeAccountId === accountId) {
    state.activeAccountId = null;
    const next = state.appState.accounts[0];
    if (next) switchAccount(next.id);
  }
}

// ---------------------------------------------------------------------------
// 主視窗
// ---------------------------------------------------------------------------

function createMainWindow() {
  state.mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  state.mainWindow.setMenuBarVisibility(false);
  state.mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  state.mainWindow.on('resize', layoutActiveView);

  state.mainWindow.on('closed', () => {
    state.mainWindow = null;
    app.quit();
  });

  rebuildAllAccountViews(); // 只登記所有帳號的 metadata，不建立/載入任何頁面（見上方懶載入說明）
  if (state.appState.accounts.length > 0) {
    const lastId = state.appState.ui.lastActiveAccountId;
    const initialAccount =
      (lastId && state.appState.accounts.find((a) => a.id === lastId)) ||
      state.appState.accounts[0];
    // 只有這一個帳號會在開機時真的載入頁面，其他帳號要等使用者點了
    // 才會建立 WebContentsView（ensureAccountViewLoaded）。
    switchAccount(initialAccount.id);
  }
}

// ---------------------------------------------------------------------------
// 共用子視窗 helper
// ---------------------------------------------------------------------------

function openChildWindow({
  getWindow,
  setWindow,
  htmlFile,
  width,
  height,
  minWidth,
  minHeight,
}) {
  const existing = getWindow();
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return existing;
  }

  const effectiveMinWidth = minWidth || 360;
  const effectiveMinHeight = minHeight || 400;

  // 子視窗的寬度不超過主視窗寬度的 80%：主視窗開得比較小的時候，沿用
  // 各視窗原本設計的固定寬度（例如專案計畫視窗設計寬度 1040）反而會比
  // 主視窗還寬，看起來很不協調；主視窗開得很大的時候，也不需要把單純
  // 的小表單（例如新增帳號）硬撐開。所以這裡是「設計寬度跟 80% 主視窗
  // 寬度兩者取較小值」，不是無條件套用 80%——minWidth 仍然是最終下限，
  // 不會因為主視窗開得太小就把子視窗縮到不能用（這種情況下子視窗會
  // 比主視窗的 80% 寬一點，是刻意接受的取捨，總比擠爆版面好）。
  let effectiveWidth = width;
  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    const cappedByMainWindow = Math.round(state.mainWindow.getBounds().width * 0.8);
    effectiveWidth = Math.max(effectiveMinWidth, Math.min(width, cappedByMainWindow));
  }

  const win = new BrowserWindow({
    width: effectiveWidth,
    height,
    minWidth: effectiveMinWidth,
    minHeight: effectiveMinHeight,
    parent: state.mainWindow,
    modal: false,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', htmlFile));
  win.on('closed', () => setWindow(null));
  setWindow(win);
  return win;
}

function openAccountWindow() {
  return openChildWindow({
    getWindow: () => state.accountWindow,
    setWindow: (w) => (state.accountWindow = w),
    htmlFile: 'account.html',
    width: 420,
    height: 320,
  });
}

function openKnowledgeWindow() {
  return openChildWindow({
    getWindow: () => state.knowledgeWindow,
    setWindow: (w) => (state.knowledgeWindow = w),
    htmlFile: 'knowledge.html',
    width: 960,
    height: 640,
    minWidth: 640,
    minHeight: 420,
  });
}

function openSettingsWindow() {
  return openChildWindow({
    getWindow: () => state.settingsWindow,
    setWindow: (w) => (state.settingsWindow = w),
    htmlFile: 'settings.html',
    width: 720,
    height: 720,
    minWidth: 520,
    minHeight: 480,
  });
}

function openTeamWindow() {
  return openChildWindow({
    getWindow: () => state.teamWindow,
    setWindow: (w) => (state.teamWindow = w),
    htmlFile: 'team.html',
    width: 960,
    height: 640,
    minWidth: 640,
    minHeight: 420,
  });
}

function openProjectWindow() {
  return openChildWindow({
    getWindow: () => state.projectWindow,
    setWindow: (w) => (state.projectWindow = w),
    htmlFile: 'project.html',
    width: 1040,
    height: 680,
    minWidth: 680,
    minHeight: 460,
  });
}

function openDocumentsWindow() {
  return openChildWindow({
    getWindow: () => state.documentsWindow,
    setWindow: (w) => (state.documentsWindow = w),
    htmlFile: 'documents.html',
    width: 960,
    height: 640,
    minWidth: 640,
    minHeight: 420,
  });
}

function openConversationsWindow() {
  return openChildWindow({
    getWindow: () => state.conversationsWindow,
    setWindow: (w) => (state.conversationsWindow = w),
    htmlFile: 'conversation.html',
    width: 1000,
    height: 680,
    minWidth: 680,
    minHeight: 460,
  });
}

function openLogWindow() {
  return openChildWindow({
    getWindow: () => state.logWindow,
    setWindow: (w) => (state.logWindow = w),
    htmlFile: 'log.html',
    width: 900,
    height: 640,
    minWidth: 620,
    minHeight: 420,
  });
}

module.exports = {
  getContentBounds,
  layoutActiveView,
  applyExtensionsToSession,
  registerAccountMeta,
  ensureAccountViewLoaded,
  rebuildAllAccountViews,
  switchAccount,
  addAccount,
  removeAccount,
  createMainWindow,
  openChildWindow,
  openAccountWindow,
  openKnowledgeWindow,
  openSettingsWindow,
  openTeamWindow,
  openProjectWindow,
  openDocumentsWindow,
  openConversationsWindow,
  openLogWindow,
};
