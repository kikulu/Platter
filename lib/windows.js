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
  if (!entry) return;
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

function createAccountView(account) {
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

  state.accountViews.set(account.id, {
    view,
    platform: account.platform,
    name: account.name,
  });
}

function rebuildAllAccountViews() {
  state.appState.accounts.forEach((account) => createAccountView(account));
}

function switchAccount(accountId) {
  if (!state.accountViews.has(accountId)) return false;
  state.accountViews.forEach((entry, id) => {
    entry.view.setVisible(id === accountId);
  });
  state.activeAccountId = accountId;
  layoutActiveView();
  return true;
}

function addAccount(platform, name, roleId) {
  const account = { id: genId(), platform, name, roleId: roleId || null };
  state.appState.accounts.push(account);
  saveAppState();
  createAccountView(account);
  switchAccount(account.id);
  return account;
}

function removeAccount(accountId) {
  const entry = state.accountViews.get(accountId);
  if (entry) {
    state.mainWindow.contentView.removeChildView(entry.view);
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

  rebuildAllAccountViews();
  if (state.appState.accounts.length > 0) {
    switchAccount(state.appState.accounts[0].id);
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
  const win = new BrowserWindow({
    width,
    height,
    minWidth: minWidth || 360,
    minHeight: minHeight || 400,
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
  createAccountView,
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
