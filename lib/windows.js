const path = require('path');
const { app, BrowserWindow, WebContentsView, session, net } = require('electron');
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

// 帳號要載入的網址：一般平台（Claude/ChatGPT/Gemini/Grok）是固定網址，
// 見 PLATFORM_URLS；本地端 AI 服務（platform === 'local'，例如 Ollama
// WebUI、LM Studio、Stable Diffusion WebUI、ComfyUI）沒有固定網址，
// 是使用者自訂的（帳號物件自己的 `url` 欄位，見 addAccount()）。
function resolveAccountUrl(account) {
  if (account.platform === 'local') return account.url || null;
  return PLATFORM_URLS[account.platform] || 'https://claude.ai';
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

  const url = resolveAccountUrl(account);
  if (!url) {
    // 本地服務帳號還沒設定網址（理論上新增時就會擋掉，這裡是最後一道防線），
    // 不要拿空字串去 loadURL，會直接讓 WebContentsView 炸掉。
    logError('account:load', `本地服務帳號「${account.name}」尚未設定網址，略過載入`);
  } else {
    view.webContents.loadURL(url);
  }

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

// 主視窗自己的 DOM（index.html，例如匯出對話框、命令面板這兩個全螢幕
// 遮罩）跟目前帳號的 WebContentsView 不是同一個堆疊層——WebContentsView
// 是用 contentView.addChildView() 加進去的原生畫面層，CSS 的 z-index
// 對它完全沒有作用，加了之後永遠蓋在主頁面的 DOM 上面。index.html 裡
// 任何需要「蓋在目前帳號畫面上面」的全螢幕遮罩，開啟前都要呼叫這個
// 函式把目前帳號的 view 暫時隱藏，關閉後再呼叫一次設回可見，否則遮罩
// 會被整個蓋住、看起來就像「點了沒反應」（1.37.0 修正的匯出對話框／
// 命令面板都是這個原因）。沒有帳號在用（activeAccountId 是 null）時
// 呼叫這個函式是安全的 no-op。
function setActiveAccountViewVisible(visible) {
  const entry = state.activeAccountId && state.accountViews.get(state.activeAccountId);
  if (entry && entry.view) entry.view.setVisible(visible);
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

function addAccount(platform, name, roleId, extra) {
  const account = { id: genId(), platform, name, roleId: roleId || null };
  // 本地端 AI 服務：多存自訂網址跟服務類型（llm / image / custom），
  // 見 lib/constants.js 的 LOCAL_SERVICE_TYPES。一般平台不需要這兩個欄位。
  if (platform === 'local') {
    account.url = (extra && extra.url) || '';
    account.serviceType = (extra && extra.serviceType) || 'custom';
  }
  state.appState.accounts.push(account);
  saveAppState();
  registerAccountMeta(account);
  switchAccount(account.id); // 新增帳號代表使用者現在就要用它，立刻載入並切過去
  return account;
}

// 編輯已存在的本地服務帳號（名稱／網址／服務類型），跟一般帳號不同，
// 本地服務的網址是可以事後修改的（例如 Ollama 換了 port）。網址若有
// 變更，且這個帳號的 WebContentsView 已經載入過，就重新導向過去，
// 不用整個帳號刪掉重建（會連 session 分區跟登入狀態都清掉，沒必要）。
function updateLocalService(accountId, patch) {
  const account = state.appState.accounts.find((a) => a.id === accountId);
  if (!account || account.platform !== 'local') return null;

  const prevUrl = account.url;
  if (typeof patch.name === 'string' && patch.name.trim())
    account.name = patch.name.trim();
  if (typeof patch.url === 'string') account.url = patch.url.trim();
  if (typeof patch.serviceType === 'string') account.serviceType = patch.serviceType;
  saveAppState();

  const entry = state.accountViews.get(accountId);
  if (entry) entry.name = account.name; // 側邊欄用 entry.name 顯示，一併同步

  if (entry && entry.view && account.url && account.url !== prevUrl) {
    entry.view.webContents.loadURL(account.url).catch((err) => {
      logError('account:load', `本地服務帳號「${account.name}」重新載入失敗`, err);
    });
  }
  return account;
}

// 測試本地服務網址是否連得上。用 Electron 的 net.request（走 Chromium
// 網路層，不受頁面 CORS 限制），純粹檢查「連得上、有回應」，不理會回應
// 內容或狀態碼是不是 200——本地服務常見的根路徑（例如 Ollama 沒特別設
// 路由的話會回 404）連得上就代表服務活著，擋在「非 2xx 就算失敗」反而
// 會誤判一堆正常在跑的服務。
function testLocalServiceConnection(url) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let request;
    try {
      request = net.request({ method: 'GET', url });
    } catch (err) {
      finish({ ok: false, error: String((err && err.message) || err) });
      return;
    }

    const timeout = setTimeout(() => {
      request.abort();
      finish({ ok: false, error: 'TIMEOUT' });
    }, 4000);

    request.on('response', (response) => {
      clearTimeout(timeout);
      response.on('data', () => {}); // 一定要消耗掉，不然連線不會正常結束
      response.on('end', () => finish({ ok: true, status: response.statusCode }));
    });
    request.on('error', (err) => {
      clearTimeout(timeout);
      finish({ ok: false, error: String((err && err.message) || err) });
    });
    request.end();
  });
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

  openTrayWindow(); // 右下角浮動小托盤，開機就常駐（見下方說明），不用使用者自己開
}

// ---------------------------------------------------------------------------
// 右下角浮動小托盤（1.37.0）：快速取用知識庫提示詞，不用開知識庫整個視窗。
//
// 跟其他子視窗（knowledge.html／settings.html 等）用的 openChildWindow()
// helper 不一樣——那些是「使用者按按鈕才開、置中、跟主視窗平行存在」的
// 一般對話框；這個是「跟著主視窗常駐、固定釘在主視窗右下角、永遠蓋在
// 最上面」的浮動小工具，所以是獨立的 BrowserWindow 設定：無邊框
// （frame:false）、透明背景（transparent:true，這樣收起狀態才能是圓形
// 而不是方形色塊）、不能被使用者拖動/縮放（movable/resizable:false，
// 位置完全由程式用 setBounds() 控制）、alwaysOnTop、不出現在工作列
// （skipTaskbar）。「收起（圓鈕）／展開（搜尋+清單面板）」兩種狀態不是
// CSS 切換，是整個 OS 視窗本身跟著變大變小（setTrayExpanded()），因為
// 收起狀態的視窗就只有一個圓鈕那麼大，沒有多餘的透明區域需要處理點擊
// 穿透問題。
const TRAY_MARGIN = 16;
const TRAY_COLLAPSED_SIZE = 56;
const TRAY_EXPANDED_WIDTH = 340;
const TRAY_EXPANDED_HEIGHT = 440;

function trayBoundsFor(expanded) {
  if (!state.mainWindow || state.mainWindow.isDestroyed()) return null;
  const mainBounds = state.mainWindow.getBounds();
  const width = expanded ? TRAY_EXPANDED_WIDTH : TRAY_COLLAPSED_SIZE;
  const height = expanded ? TRAY_EXPANDED_HEIGHT : TRAY_COLLAPSED_SIZE;
  return {
    x: Math.round(mainBounds.x + mainBounds.width - width - TRAY_MARGIN),
    y: Math.round(mainBounds.y + mainBounds.height - height - TRAY_MARGIN),
    width,
    height,
  };
}

// 主視窗移動/縮放、或托盤本身展開/收起時都要重新定位一次，讓托盤永遠
// 貼著主視窗的右下角——錨點是右下角那個角落本身：展開時視窗變大，要同時
// 往左、往上長，不能只長右下角（那樣會長到螢幕外面去）。
function repositionTrayWindow() {
  if (!state.trayWindow || state.trayWindow.isDestroyed()) return;
  const bounds = trayBoundsFor(state.trayExpanded);
  if (bounds) state.trayWindow.setBounds(bounds);
}

function setTrayExpanded(expanded) {
  state.trayExpanded = !!expanded;
  repositionTrayWindow();
}

function openTrayWindow() {
  if (state.trayWindow && !state.trayWindow.isDestroyed()) return state.trayWindow;
  state.trayExpanded = false;
  const initialBounds = trayBoundsFor(false) || {
    x: 100,
    y: 100,
    width: TRAY_COLLAPSED_SIZE,
    height: TRAY_COLLAPSED_SIZE,
  };

  const win = new BrowserWindow({
    ...initialBounds,
    parent: state.mainWindow,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    // 不再設 alwaysOnTop：這個旗標是「蓋過所有應用程式」，Platter 退到背景
    // 時托盤圓鈕會浮在其他前景應用前面。改成只在 Platter 自己的視窗有焦點
    // 時才顯示（見下方 syncTrayVisibility），平常靠 parent 關係蓋在主視窗上。
    alwaysOnTop: false,
    skipTaskbar: true,
    focusable: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'tray.html'));
  win.on('closed', () => {
    state.trayWindow = null;
  });
  state.trayWindow = win;

  if (state.mainWindow) {
    state.mainWindow.on('move', repositionTrayWindow);
    state.mainWindow.on('resize', repositionTrayWindow);
    // 主視窗被最小化/還原時托盤要跟著隱藏/出現，不然會留一個浮在桌面上、
    // 跟丟了主視窗的小圓鈕，使用者會搞不清楚那是什麼。
    state.mainWindow.on('minimize', () => {
      if (!win.isDestroyed()) win.hide();
    });
    state.mainWindow.on('restore', () => syncTrayVisibility());
    state.mainWindow.on('show', () => syncTrayVisibility());
    state.mainWindow.on('hide', () => syncTrayVisibility());
  }
  // Platter 任一視窗取得/失去焦點時，重新判斷托盤該顯示還是隱藏
  win.on('focus', () => syncTrayVisibility());
  app.on('browser-window-focus', () => syncTrayVisibility());
  app.on('browser-window-blur', () => {
    // blur 與下一個 focus 之間（例如從主視窗切到托盤、或切到子視窗）會有
    // 短暫「沒有任何焦點視窗」的瞬間，延遲一下再判斷，避免托盤閃爍。
    setTimeout(syncTrayVisibility, 80);
  });
  return win;
}

// 托盤只在「Platter 自己的某個視窗是目前焦點視窗、且主視窗可見未最小化」時
// 顯示；Platter 退到背景（使用者切去別的應用程式）就隱藏，不蓋在別人前面。
function syncTrayVisibility() {
  const tray = state.trayWindow;
  if (!tray || tray.isDestroyed()) return;
  const main = state.mainWindow;
  const mainUsable =
    main && !main.isDestroyed() && main.isVisible() && !main.isMinimized();
  const appFocused = BrowserWindow.getFocusedWindow() !== null;
  if (mainUsable && appFocused) {
    if (!tray.isVisible()) tray.showInactive();
  } else if (tray.isVisible()) {
    tray.hide();
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
  query,
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
  win.loadFile(
    path.join(__dirname, '..', 'renderer', htmlFile),
    query ? { query } : undefined
  );
  win.on('closed', () => setWindow(null));
  setWindow(win);
  return win;
}

function openAccountWindow(presetPlatform) {
  return openChildWindow({
    getWindow: () => state.accountWindow,
    setWindow: (w) => (state.accountWindow = w),
    htmlFile: 'account.html',
    width: 420,
    height: 320,
    // 側邊欄「本地服務」群組的「新增本地服務」按鈕會帶 presetPlatform='local'
    // 過來，讓新增帳號視窗開啟時直接選好「本地服務」，不用使用者自己選。
    query: presetPlatform ? { platform: presetPlatform } : undefined,
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
  setActiveAccountViewVisible,
  setTrayExpanded,
  addAccount,
  updateLocalService,
  testLocalServiceConnection,
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
