const path = require('path');
const {
  app,
  BrowserWindow,
  WebContentsView,
  session,
  net,
  screen,
  dialog,
} = require('electron');
const { genId } = require('./utils');
const {
  PLATFORM_URLS,
  SIDEBAR_WIDTH_EXPANDED,
  SIDEBAR_WIDTH_COLLAPSED,
} = require('./constants');
const state = require('./state');
const { saveAppState, getTrayPrefs, updateTrayPrefs } = require('./stores');
const trayLayout = require('./trayLayout');
const startupPolicy = require('./startupPolicy');
const { applyPermissionPolicy } = require('./permissions');
const { broadcastToAllWindows } = require('./broadcast');
const { logError } = require('./logs');
const { t } = require('./i18n');
const { captureConsole } = require('./console');
const {
  hardenAppWebContents,
  hardenAccountWebContents,
  normalizeServiceUrl,
} = require('./security');

// 資安加固（1.42.0）：自己的視窗只能待在 renderer/ 底下的頁面、不能開新視窗；
// 帳號視圖（第三方網站）擋掉 file: 等非網頁協定。被擋下的嘗試寫進錯誤日誌。
const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
function reportBlockedNavigation(kind, url) {
  logError(
    'security:navigation',
    t(
      kind === 'open'
        ? 'main.windows.log.blockedOpen'
        : 'main.windows.log.blockedNavigate',
      { url }
    )
  );
}
function hardenOwnWindow(win) {
  hardenAppWebContents(win.webContents, {
    rendererDir: RENDERER_DIR,
    onBlock: reportBlockedNavigation,
  });
  watchOwnWindowCrash(win);
}

// 自己的視窗（主視窗、子視窗、托盤）渲染行程消失（記憶體不足被系統結束、崩潰）時：
// 寫進錯誤日誌，先自動重載一次（本機 HTML，成本很低）；短時間內又崩潰就跳對話框讓使用者選，
// 避免「畫面永遠空白、只能重開 App」，也避免無限重載迴圈。規則見 lib/startupPolicy.js。
function watchOwnWindowCrash(win) {
  let lastAutoReloadAt = 0;
  win.webContents.on('render-process-gone', (event, details) => {
    const reason = (details && details.reason) || 'unknown';
    const action = startupPolicy.decideCrashAction(reason, {
      now: Date.now(),
      lastAutoReloadAt,
      isOwnWindow: true,
    });
    if (action === 'ignore') return;
    logError('window:crash', t('main.windows.log.windowRendererGone', { reason }));
    if (win.isDestroyed()) return;
    if (action === 'auto-reload') {
      lastAutoReloadAt = Date.now();
      win.webContents.reload();
      return;
    }
    dialog
      .showMessageBox(win.isVisible() ? win : null, {
        type: 'error',
        message: t('main.windows.crash.message', { reason }),
        buttons: [t('main.windows.crash.reload'), t('main.windows.crash.close')],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (win.isDestroyed()) return;
        if (response === 0) {
          lastAutoReloadAt = Date.now();
          win.webContents.reload();
        } else {
          win.close();
        }
      })
      .catch(() => {});
  });
}

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
      ses.loadExtension(ext.path, { allowFileAccess: false }).catch((err) => {
        logError(
          'extensions:load',
          t('main.windows.log.extLoadFailed', { path: ext.path }),
          err
        );
      });
    });
}

// 帳號要載入的網址：一般平台（Claude/ChatGPT/Gemini/Grok/Copilot）是固定網址，
// 見 PLATFORM_URLS；本地端 AI 服務（platform === 'local'，例如 Ollama
// WebUI、LM Studio、Stable Diffusion WebUI、ComfyUI）沒有固定網址，
// 是使用者自訂的（帳號物件自己的 `url` 欄位，見 addAccount()）。
function resolveAccountUrl(account) {
  // 本地服務網址必須是 http(s)（1.42.0）：就算 app-state.json 或備份被改過，也不會載入 file: 等網址
  if (account.platform === 'local') return normalizeServiceUrl(account.url);
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
    status: 'unloaded', // unloaded | loading | ready | unresponsive | crashed | failed，見下方 setAccountStatus()
    statusReason: null,
  });
}

// ---------------------------------------------------------------------------
// 帳號頁面的狀態（開機載入中／尚未載入／無回應／崩潰／載入失敗）
//
// 帳號頁面是原生 WebContentsView，蓋在主視窗 DOM 之上，網站還沒畫出來（或渲染行程被系統
// 結束）時使用者只會看到一片空白。所以：頁面不是 ready 的時候把 view 藏起來，由主視窗自己的
// DOM（index.html 的 #account-status）顯示「載入中／記憶體不足／重新載入」等提示與按鈕。
// 狀態變化用 'account:status' 廣播，主視窗收到後更新提示。
// ---------------------------------------------------------------------------
const ACCOUNT_REVEAL_TIMEOUT_MS = 8000;
let accountViewOverlayHidden = false;

function accountStatusPayload(accountId, entry) {
  return {
    accountId,
    name: entry.name,
    status: entry.status || 'unloaded',
    reason: entry.statusReason || null,
  };
}

function getAccountStatusSnapshot() {
  const statuses = {};
  state.accountViews.forEach((entry, id) => {
    statuses[id] = accountStatusPayload(id, entry);
  });
  return { activeAccountId: state.activeAccountId, statuses };
}

// 只有「目前帳號、狀態是 ready、沒有被全螢幕遮罩暫時隱藏」的 view 才顯示
function applyViewVisibility() {
  state.accountViews.forEach((entry, id) => {
    if (!entry.view) return;
    const show =
      id === state.activeAccountId && !accountViewOverlayHidden && entry.status === 'ready';
    entry.view.setVisible(show);
  });
}

function setAccountStatus(accountId, status, reason) {
  const entry = state.accountViews.get(accountId);
  if (!entry) return;
  entry.status = status;
  entry.statusReason = reason || null;
  applyViewVisibility();
  broadcastToAllWindows('account:status', accountStatusPayload(accountId, entry));
}

// 網站載入很慢（資源吃緊時常見）時，不要讓使用者一直盯著「載入中」：到時間就先把頁面亮出來，
// 讓它自己邊載邊顯示。
function startRevealTimer(accountId) {
  setTimeout(() => {
    const entry = state.accountViews.get(accountId);
    if (entry && entry.view && entry.status === 'loading') setAccountStatus(accountId, 'ready');
  }, ACCOUNT_REVEAL_TIMEOUT_MS);
}

function watchAccountView(accountId, account, view) {
  const wc = view.webContents;
  wc.on('dom-ready', () => {
    const entry = state.accountViews.get(accountId);
    if (entry && entry.view === view && entry.status !== 'ready') setAccountStatus(accountId, 'ready');
  });
  wc.on('unresponsive', () => {
    const entry = state.accountViews.get(accountId);
    if (entry && entry.view === view && entry.status === 'ready') {
      setAccountStatus(accountId, 'unresponsive');
    }
  });
  wc.on('responsive', () => {
    const entry = state.accountViews.get(accountId);
    if (entry && entry.view === view && entry.status === 'unresponsive') {
      setAccountStatus(accountId, 'ready');
    }
  });
  wc.on('render-process-gone', (event, details) => {
    const entry = state.accountViews.get(accountId);
    if (!entry || entry.view !== view) return;
    const reason = (details && details.reason) || 'unknown';
    const action = startupPolicy.decideCrashAction(reason, {
      now: Date.now(),
      lastAutoReloadAt: entry.lastAutoReloadAt || 0,
    });
    if (action === 'ignore') return;
    logError(
      'account:crash',
      t('main.windows.log.rendererGone', {
        name: account.name,
        platform: account.platform,
        reason,
      })
    );
    if (action === 'auto-reload') {
      entry.lastAutoReloadAt = Date.now();
      setAccountStatus(accountId, 'loading');
      startRevealTimer(accountId);
      wc.reload();
    } else {
      setAccountStatus(accountId, 'crashed', startupPolicy.crashKind(reason));
    }
  });
}

// 「重新載入」按鈕：還沒載入過就載入；崩潰過就整個 view 重建；其餘直接 reload。
function reloadAccount(accountId) {
  const entry = state.accountViews.get(accountId);
  if (!entry) return false;
  if (!entry.view) {
    ensureAccountViewLoaded(accountId);
  } else if (entry.status === 'crashed' || entry.view.webContents.isCrashed()) {
    try {
      state.mainWindow.contentView.removeChildView(entry.view);
    } catch (err) {
      // view 已經不在了就算了
    }
    try {
      entry.view.webContents.close();
    } catch (err) {
      // 行程已經消失，關不掉也沒關係
    }
    entry.view = null;
    ensureAccountViewLoaded(accountId);
  } else {
    setAccountStatus(accountId, 'loading');
    startRevealTimer(accountId);
    entry.view.webContents.reload();
  }
  layoutActiveView();
  return true;
}

// 「繼續等待」：頁面沒有回應時，使用者選擇把頁面亮出來繼續等
function continueWaitingAccount(accountId) {
  const entry = state.accountViews.get(accountId);
  if (!entry || !entry.view) return false;
  setAccountStatus(accountId, 'ready');
  return true;
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
  applyPermissionPolicy(ses); // 資安稽核 N-3：預設拒絕第三方網頁的權限請求
  applyExtensionsToSession(ses);

  const view = new WebContentsView({
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  hardenAccountWebContents(view.webContents, { onBlock: reportBlockedNavigation });

  const url = resolveAccountUrl(account);
  if (!url) {
    // 本地服務帳號還沒設定網址（理論上新增時就會擋掉，這裡是最後一道防線），
    // 不要拿空字串去 loadURL，會直接讓 WebContentsView 炸掉。
    logError('account:load', t('main.windows.log.localNoUrl', { name: account.name }));
  } else {
    view.webContents.loadURL(url);
  }

  // 診斷用：頁面載入失敗、頁面自己的 console 輸出，都餵進「主控台」即時日誌，
  // 方便排查「為什麼這個平台匯出/擷取不到對話」（例如頁面根本沒載入成功、
  // 或頁面本身噴了 JS 錯誤）。
  view.webContents.on(
    'did-fail-load',
    (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (errorCode === -3) return; // ERR_ABORTED，通常是使用者自己導覽到別的頁面，不算錯誤
      if (isMainFrame !== false) setAccountStatus(accountId, 'failed', errorDescription);
      logError(
        'account:load',
        t('main.windows.log.pageLoadFailed', {
          name: account.name,
          platform: account.platform,
          description: errorDescription,
          code: errorCode,
          url: validatedURL,
        })
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
    // 第三方頁面的 console 輸出可能含對話內容或 token，預設不收（設定 → 疑難排解可開啟）
    if (message && state.appState.ui && state.appState.ui.capturePageConsole === true) {
      captureConsole('page', [`[${account.platform}/${account.name}] ${message}`]);
    }
  });

  state.mainWindow.contentView.addChildView(view);
  view.setVisible(false);

  entry.view = view;
  watchAccountView(accountId, account, view);
  if (url) {
    setAccountStatus(accountId, 'loading');
    startRevealTimer(accountId);
  } else {
    setAccountStatus(accountId, 'failed', 'NO_URL');
  }
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
  accountViewOverlayHidden = !visible;
  applyViewVisibility();
}

// opts.deferLoad：開機時記憶體吃緊，先不載入這個帳號的頁面（只切成目前帳號），
// 主視窗會顯示「尚未載入，按一下載入」，使用者按了才真的載入（reloadAccount）。
function switchAccount(accountId, opts) {
  const entry = state.accountViews.get(accountId);
  if (!entry) return false;
  const deferLoad = !!(opts && opts.deferLoad) && !entry.view;
  if (!deferLoad) ensureAccountViewLoaded(accountId); // 第一次切過去才真的載入頁面
  state.activeAccountId = accountId;
  // 記住最後使用的帳號，下次開機直接懶載入回這個帳號，不是每次都固定
  // 回到清單第一個。沒變就不用重寫整個設定檔。
  if (state.appState.ui.lastActiveAccountId !== accountId) {
    state.appState.ui.lastActiveAccountId = accountId;
    saveAppState();
  }
  applyViewVisibility();
  layoutActiveView();
  broadcastToAllWindows('account:status', accountStatusPayload(accountId, entry));
  return true;
}

// 把主視窗帶到前景（最小化就還原、隱藏就顯示）。專案頁「派發」切換帳號後用——
// 帳號畫面在主視窗裡，使用者要馬上看到並貼上提示詞。
function bringMainWindowToFront() {
  const main = state.mainWindow;
  if (!main || main.isDestroyed()) return;
  if (main.isMinimized()) main.restore();
  if (!main.isVisible()) main.show();
  main.focus();
}

function addAccount(platform, name, roleId, extra) {
  // 主程序自己再驗一次（renderer 的檢查可以被繞過）：平台必須已知，本地服務網址必須是 http(s)
  if (
    platform !== 'local' &&
    !Object.prototype.hasOwnProperty.call(PLATFORM_URLS, platform)
  ) {
    return null;
  }
  if (platform === 'local' && !normalizeServiceUrl(extra && extra.url)) return null;
  const account = { id: genId(), platform, name, roleId: roleId || null };
  // 本地端 AI 服務：多存自訂網址跟服務類型（llm / image / custom），
  // 見 lib/constants.js 的 LOCAL_SERVICE_TYPES。一般平台不需要這兩個欄位。
  if (platform === 'local') {
    account.url = normalizeServiceUrl(extra && extra.url);
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
  // 不合法的網址（非 http／https）忽略，保留原本的
  const nextUrl = normalizeServiceUrl(patch.url);
  if (nextUrl) account.url = nextUrl;
  if (typeof patch.serviceType === 'string') account.serviceType = patch.serviceType;
  saveAppState();

  const entry = state.accountViews.get(accountId);
  if (entry) entry.name = account.name; // 側邊欄用 entry.name 顯示，一併同步

  if (entry && entry.view && account.url && account.url !== prevUrl) {
    entry.view.webContents.loadURL(account.url).catch((err) => {
      logError(
        'account:load',
        t('main.windows.log.localReloadFailed', { name: account.name }),
        err
      );
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

    if (!normalizeServiceUrl(url)) {
      finish({ ok: false, error: 'INVALID_URL' });
      return;
    }

    let request;
    try {
      request = net.request({ method: 'GET', url: String(url).trim() });
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
        logError(
          'account:remove',
          t('main.windows.log.clearSessionFailed', { partition }),
          err
        );
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
    show: false, // 等第一次畫面畫好（ready-to-show）再顯示，避免先跳出一個空白視窗
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  hardenOwnWindow(state.mainWindow);
  state.mainWindow.setMenuBarVisibility(false);
  state.mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  let mainShown = false;
  const showMainWindow = () => {
    if (mainShown) return;
    mainShown = true;
    if (state.mainWindow && !state.mainWindow.isDestroyed()) state.mainWindow.show();
  };
  state.mainWindow.once('ready-to-show', showMainWindow);
  setTimeout(showMainWindow, 3000); // 保險：萬一 ready-to-show 一直不來，3 秒後還是要顯示

  state.mainWindow.on('resize', layoutActiveView);

  state.mainWindow.on('closed', () => {
    state.mainWindow = null;
    app.quit();
  });

  rebuildAllAccountViews(); // 只登記所有帳號的 metadata，不建立/載入任何頁面（見上方懶載入說明）

  // 開機時記憶體吃緊就不自動載入上次使用的帳號頁面（設定 → 疑難排解可改成一律載入）
  let memoryInfo = null;
  try {
    memoryInfo = process.getSystemMemoryInfo();
  } catch (err) {
    // 讀不到就當作沒問題
  }
  const deferLoad = startupPolicy.shouldDeferAccountLoad(
    state.appState.ui.startupLoad,
    memoryInfo
  );
  if (deferLoad) {
    console.log(
      `[startup] deferring account page load (mode=${state.appState.ui.startupLoad || 'auto'}, freeMemKB=${memoryInfo && memoryInfo.free})`
    );
  }
  if (state.appState.accounts.length > 0) {
    const lastId = state.appState.ui.lastActiveAccountId;
    const initialAccount =
      (lastId && state.appState.accounts.find((a) => a.id === lastId)) ||
      state.appState.accounts[0];
    // 只有這一個帳號會在開機時真的載入頁面，其他帳號要等使用者點了
    // 才會建立 WebContentsView（ensureAccountViewLoaded）。
    switchAccount(initialAccount.id, { deferLoad });
  }

  // 右下角浮動小托盤（見下方說明）改成主視窗載入完成後才建立：它是另一個渲染行程，
  // 不要跟主視窗、帳號頁面搶開機那一刻的記憶體與 CPU。
  const startTray = () =>
    setTimeout(() => {
      if (state.mainWindow && !state.mainWindow.isDestroyed()) openTrayWindow();
    }, startupPolicy.trayStartDelayMs(deferLoad));
  if (state.mainWindow.webContents.isLoading()) {
    state.mainWindow.webContents.once('did-finish-load', startTray);
  } else {
    startTray();
  }
}

// ---------------------------------------------------------------------------
// 右下角浮動小托盤（1.37.0）：快速取用知識庫提示詞，不用開知識庫整個視窗。
//
// 跟其他子視窗（knowledge.html／settings.html 等）用的 openChildWindow()
// helper 不一樣——那些是「使用者按按鈕才開、置中、跟主視窗平行存在」的
// 一般對話框；這個是「跟著主視窗常駐、固定釘在主視窗右下角、永遠蓋在
// 最上面」的浮動小工具，所以是獨立的 BrowserWindow 設定：無邊框
// （frame:false）、透明背景（transparent:true，這樣收起狀態才能是圓形
// 而不是方形色塊）、不能被 OS 拖動/縮放（movable/resizable:false，
// 位置完全由程式用 setBounds() 控制；使用者拖曳圓鈕時由 renderer 通知
// main process 自己移動，見下方 startTrayDrag()）、不出現在工作列
// （skipTaskbar）。「收起（圓鈕）／展開（搜尋+清單面板）」兩種狀態不是
// CSS 切換，是整個 OS 視窗本身跟著變大變小（setTrayExpanded()），因為
// 收起狀態的視窗就只有一個圓鈕那麼大，沒有多餘的透明區域需要處理點擊
// 穿透問題。
// 托盤的位置（收起圓鈕相對容器右下角的距離）存在 appState.ui.tray.position，
// 沒設定就是預設右下角；實際計算見 lib/trayLayout.js。使用者可以拖曳圓鈕（或展開後的
// 標題列）到任何位置，位置會記住，而且會跟著主視窗移動／縮放。
//
// 容器 = 主視窗「內容區」（不含 Windows 看不見的縮放邊框、最大化時超出螢幕的那幾 px）
// ∩ 該螢幕的工作區（不含工作列），確保圓鈕永遠完整落在看得到、點得到的範圍內。
function trayContainer() {
  const main = state.mainWindow;
  if (!main || main.isDestroyed()) return null;
  const content = main.getContentBounds();
  let container = content;
  try {
    const area = screen.getDisplayMatching(content).workArea;
    container = trayLayout.intersectRects(content, area) || area;
  } catch (err) {
    // screen 不可用時就只用主視窗內容區
  }
  return container;
}

function trayBoundsFor(expanded) {
  const container = trayContainer();
  if (!container) return null;
  return trayLayout.computeTrayBounds(container, getTrayPrefs().position, expanded);
}

// 主視窗移動/縮放、或托盤本身展開/收起時都要重新定位一次，讓托盤維持在
// 使用者設定的相對位置（預設右下角）。
function repositionTrayWindow() {
  if (!state.trayWindow || state.trayWindow.isDestroyed()) return;
  if (trayDrag) return; // 拖曳中由拖曳邏輯自己控制位置
  const bounds = trayBoundsFor(state.trayExpanded);
  if (bounds) state.trayWindow.setBounds(bounds);
}

function setTrayExpanded(expanded) {
  state.trayExpanded = !!expanded;
  repositionTrayWindow();
}

// --- 拖曳（renderer 在圓鈕／展開面板標題列上按住滑鼠時呼叫） ---
// 位置完全由 main process 用游標的螢幕座標算，避免 renderer 座標在高 DPI／多螢幕下漂移。
let trayDrag = null;

function startTrayDrag() {
  const win = state.trayWindow;
  if (!win || win.isDestroyed()) return;
  const cursor = screen.getCursorScreenPoint();
  const b = win.getBounds();
  trayDrag = { dx: cursor.x - b.x, dy: cursor.y - b.y, width: b.width, height: b.height, moved: false };
}

function moveTrayDrag() {
  const win = state.trayWindow;
  if (!trayDrag || !win || win.isDestroyed()) return;
  const container = trayContainer();
  if (!container) return;
  const cursor = screen.getCursorScreenPoint();
  trayDrag.moved = true;
  // 一律明確帶寬高：Windows 縮放比例非 100% 時，只 setPosition 可能讓透明視窗尺寸慢慢漂移
  win.setBounds(
    trayLayout.clampBoundsToContainer(container, {
      x: cursor.x - trayDrag.dx,
      y: cursor.y - trayDrag.dy,
      width: trayDrag.width,
      height: trayDrag.height,
    })
  );
}

function endTrayDrag() {
  const win = state.trayWindow;
  const drag = trayDrag;
  trayDrag = null;
  if (!drag || !drag.moved || !win || win.isDestroyed()) return;
  const container = trayContainer();
  if (!container) return;
  const position = trayLayout.positionFromBounds(
    container,
    win.getBounds(),
    state.trayExpanded
  );
  updateTrayPrefs({ position });
  repositionTrayWindow(); // 吸附到存起來的位置（展開時也會修正方向）
}

function resetTrayPosition() {
  trayDrag = null;
  updateTrayPrefs({ position: null });
  repositionTrayWindow();
}

// 這些監聽只綁一次（托盤視窗被關掉重開時不會重複綁、也不會留著指向舊視窗的 closure），
// 一律透過 state.trayWindow 取得目前的托盤視窗。
let trayListenersBound = false;
function bindTrayListeners() {
  if (trayListenersBound) return;
  trayListenersBound = true;
  const main = state.mainWindow;
  if (main) {
    ['move', 'resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'].forEach(
      (evt) => main.on(evt, repositionTrayWindow)
    );
    // 主視窗被最小化/還原時托盤要跟著隱藏/出現，不然會留一個浮在桌面上、
    // 跟丟了主視窗的小圓鈕，使用者會搞不清楚那是什麼。
    main.on('minimize', () => {
      const tray = state.trayWindow;
      if (tray && !tray.isDestroyed()) tray.hide();
    });
    main.on('restore', () => syncTrayVisibility());
    main.on('show', () => syncTrayVisibility());
    main.on('hide', () => syncTrayVisibility());
  }
  // 螢幕解析度／縮放／工作列改變：重新夾回可視範圍
  screen.on('display-metrics-changed', repositionTrayWindow);
  screen.on('display-removed', repositionTrayWindow);
  // Platter 任一視窗取得/失去焦點時，重新判斷托盤該顯示還是隱藏
  app.on('browser-window-focus', () => syncTrayVisibility());
  app.on('browser-window-blur', () => {
    // blur 與下一個 focus 之間（例如從主視窗切到托盤、或切到子視窗）會有
    // 短暫「沒有任何焦點視窗」的瞬間，延遲一下再判斷，避免托盤閃爍。
    setTimeout(syncTrayVisibility, 80);
  });
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
      // macOS：托盤是用 showInactive() 顯示、平常不是 key window，預設情況下第一下點擊
      // 只會「啟用視窗」而不會送給頁面，看起來就是「按了沒反應」。讓第一下點擊直接生效。
      acceptFirstMouse: true,
    },
  });
  hardenOwnWindow(win);
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'tray.html'));
  win.on('closed', () => {
    state.trayWindow = null;
    trayDrag = null;
  });
  state.trayWindow = win;

  bindTrayListeners();
  return win;
}

// 托盤只在「Platter 自己的某個視窗是目前焦點視窗、且主視窗可見未最小化」時
// 顯示；Platter 退到背景（使用者切去別的應用程式）就隱藏，不蓋在別人前面。
// 全域快捷鍵觸發（lib/trayHotkey.js）：
//   - Platter 有焦點視窗：切換托盤展開／收合；
//   - Platter 在背景（或主視窗最小化/隱藏）：先把主視窗帶到前景再展開托盤。托盤本身
//     仍然只在 Platter 有焦點時才顯示（syncTrayVisibility 的規則不變），所以不會蓋在其他應用前面。
function toggleTrayFromHotkey() {
  const main = state.mainWindow;
  if (!main || main.isDestroyed()) return;
  const tray = openTrayWindow();
  const appFocused = BrowserWindow.getFocusedWindow() !== null;
  const mainUsable = main.isVisible() && !main.isMinimized();
  let action = 'toggle';
  if (!appFocused || !mainUsable) {
    if (main.isMinimized()) main.restore();
    if (!main.isVisible()) main.show();
    main.focus();
    action = 'expand';
  }
  const send = () => {
    if (tray.isDestroyed()) return;
    syncTrayVisibility();
    tray.webContents.send('tray:hotkey', action);
  };
  if (tray.webContents.isLoading()) tray.webContents.once('did-finish-load', send);
  else setTimeout(send, action === 'expand' ? 120 : 0);
}

function syncTrayVisibility() {
  const tray = state.trayWindow;
  if (!tray || tray.isDestroyed()) return;
  const main = state.mainWindow;
  const mainUsable =
    main && !main.isDestroyed() && main.isVisible() && !main.isMinimized();
  const appFocused = BrowserWindow.getFocusedWindow() !== null;
  if (mainUsable && appFocused) {
    if (!tray.isVisible()) {
      repositionTrayWindow(); // 隱藏期間主視窗可能動過，顯示前先校正位置
      tray.showInactive();
      tray.moveTop(); // 確保蓋在帳號頁面（WebContentsView）之上，不會被擋住點不到
    }
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
  hardenOwnWindow(win);
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
  bringMainWindowToFront,
  setActiveAccountViewVisible,
  getAccountStatusSnapshot,
  reloadAccount,
  continueWaitingAccount,
  setTrayExpanded,
  startTrayDrag,
  moveTrayDrag,
  endTrayDrag,
  resetTrayPosition,
  toggleTrayFromHotkey,
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
