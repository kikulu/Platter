const {
  app,
  BrowserWindow,
  WebContentsView,
  session,
  ipcMain,
  dialog,
  Menu,
  shell,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { genId, ensureUniqueFilePath, toMarkdown, deriveSelectorFromSamples } = require('./lib/utils');
const { openDatabaseFile, saveDatabaseFile, queryAll } = require('./lib/sqlite');

// ---------------------------------------------------------------------------
// 常數 / 平台設定
// ---------------------------------------------------------------------------

const PLATFORM_URLS = {
  claude: 'https://claude.ai',
  chatgpt: 'https://chatgpt.com',
  gemini: 'https://gemini.google.com',
  grok: 'https://grok.com',
};

const SIDEBAR_WIDTH_EXPANDED = 220;
const SIDEBAR_WIDTH_COLLAPSED = 56;

const DEFAULT_UI_STATE = {
  language: 'zh-TW',
  sidebarCollapsed: false,
  sidebarGroups: { accounts: true, prompts: true, content: true, team: true }, // 側邊欄多層清單各群組的展開狀態
  defaultSavePath: null, // null -> app.getPath('documents')
  skipSaveDialog: false,
};

// ---------------------------------------------------------------------------
// 資料目錄（可由使用者搬到外部資料夾；指標檔永遠留在 Electron 預設 userData）
// ---------------------------------------------------------------------------

const DEFAULT_USER_DATA_DIR = app.getPath('userData');
const DATA_DIR_POINTER_FILE = path.join(DEFAULT_USER_DATA_DIR, 'data-dir-pointer.json');

function readJSONSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('讀取 JSON 失敗:', filePath, err);
    return fallback;
  }
}

function writeJSONSafe(filePath, data) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('寫入 JSON 失敗:', filePath, err);
    return false;
  }
}

function getDataDir() {
  const pointer = readJSONSafe(DATA_DIR_POINTER_FILE, null);
  if (pointer && pointer.dataDir && fs.existsSync(pointer.dataDir)) {
    return pointer.dataDir;
  }
  return DEFAULT_USER_DATA_DIR;
}

function setDataDir(newDir) {
  writeJSONSafe(DATA_DIR_POINTER_FILE, { dataDir: newDir });
}

function resetDataDir() {
  if (fs.existsSync(DATA_DIR_POINTER_FILE)) {
    fs.unlinkSync(DATA_DIR_POINTER_FILE);
  }
}

function isDefaultDataDir() {
  return getDataDir() === DEFAULT_USER_DATA_DIR;
}

function statePath() {
  return path.join(getDataDir(), 'app-state.json');
}
function knowledgePath() {
  return path.join(getDataDir(), 'knowledge-base.json');
}
function selectorsPath() {
  return path.join(getDataDir(), 'selectors.json');
}
function projectsPath() {
  return path.join(getDataDir(), 'projects.json');
}
function documentsMetaPath() {
  return path.join(getDataDir(), 'documents.json');
}
function documentsDir() {
  return path.join(getDataDir(), 'documents');
}
function conversationsMetaPath() {
  return path.join(getDataDir(), 'conversations.json');
}
function legacyLogsJsonPath() {
  return path.join(getDataDir(), 'logs.json');
}
function logsDbPath() {
  return path.join(getDataDir(), 'logs.sqlite');
}

// ---------------------------------------------------------------------------
// 日誌主控台：錯誤日誌 + 稽核日誌，存在 DATA_DIR/logs.sqlite（sql.js，
// 純 WebAssembly 版 SQLite，見 lib/sqlite.js 開頭的取捨說明），各自最多
// 保留最新 LOG_MAX_ENTRIES 筆（超過自動裁掉最舊的），避免無限成長。
//   errors 資料表: id, timestamp, scope, message, stack
//   audits 資料表: id, timestamp, category, action, detail
// 注意：readJSONSafe / writeJSONSafe 內部的 catch 刻意不呼叫 logError，避免
// 「寫日誌本身失敗」造成無窮遞迴。
//
// sql.js 的資料庫整個活在記憶體裡，每次寫入後都要手動呼叫
// saveLogsDatabase() 把整份資料庫匯出寫回硬碟，才不會在 App 意外關閉時
// 遺失最新的幾筆紀錄——這裡選擇「每次寫入就立刻存檔」，用效能換資料
// 安全（日誌寫入頻率對單機單人使用情境來說不高，這樣做完全夠用）。
// ---------------------------------------------------------------------------

const LOG_MAX_ENTRIES = 500;

let logsDb = null;
let logsDbReady = false;
// DB 還在非同步載入 WASM 模組的極短暫時間內，如果剛好有 logError/logAudit
// 被呼叫，先排進這裡，等 DB 準備好再一次補寫進去，避免直接漏記。
const pendingLogEntries = [];

async function initLogsDatabase() {
  logsDb = await openDatabaseFile(logsDbPath());
  logsDb.run(`
    CREATE TABLE IF NOT EXISTS errors (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      scope TEXT,
      message TEXT,
      stack TEXT
    );
    CREATE TABLE IF NOT EXISTS audits (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      category TEXT,
      action TEXT,
      detail TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_errors_timestamp ON errors(timestamp);
    CREATE INDEX IF NOT EXISTS idx_audits_timestamp ON audits(timestamp);
  `);

  migrateLegacyJsonLogsIfNeeded();

  logsDbReady = true;
  saveLogsDatabase();
  pendingLogEntries.splice(0).forEach(({ kind, entry }) => appendLogEntry(kind, entry));
}

function saveLogsDatabase() {
  if (!logsDb) return;
  saveDatabaseFile(logsDb, logsDbPath());
}

// 舊版（1.11 以前）把日誌存在 logs.json，第一次升級啟動、偵測到舊檔而且
// 新的 SQLite 資料庫還是空的，就搬過去一次，避免使用者原本的日誌歷史
// 憑空消失；搬完把舊檔改名成 .migrated 留底，不直接刪除。
function migrateLegacyJsonLogsIfNeeded() {
  const legacyPath = legacyLogsJsonPath();
  if (!fs.existsSync(legacyPath)) return;

  const errorCountRows = queryAll(logsDb, 'SELECT COUNT(*) AS c FROM errors');
  const auditCountRows = queryAll(logsDb, 'SELECT COUNT(*) AS c FROM audits');
  const hasExistingRows =
    (errorCountRows[0] && errorCountRows[0].c > 0) || (auditCountRows[0] && auditCountRows[0].c > 0);
  if (hasExistingRows) return; // 新資料庫已經有資料了，不要覆蓋

  try {
    const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf-8'));
    (Array.isArray(legacy.errors) ? legacy.errors : []).forEach((e) => {
      logsDb.run('INSERT OR IGNORE INTO errors (id, timestamp, scope, message, stack) VALUES (?, ?, ?, ?, ?)', [
        e.id || genId('log'),
        e.timestamp || new Date().toISOString(),
        e.scope || null,
        e.message || null,
        e.stack || null,
      ]);
    });
    (Array.isArray(legacy.audits) ? legacy.audits : []).forEach((a) => {
      logsDb.run('INSERT OR IGNORE INTO audits (id, timestamp, category, action, detail) VALUES (?, ?, ?, ?, ?)', [
        a.id || genId('log'),
        a.timestamp || new Date().toISOString(),
        a.category || null,
        a.action || null,
        a.detail || null,
      ]);
    });
    fs.renameSync(legacyPath, `${legacyPath}.migrated`);
    console.log('[logs] 已把舊版 logs.json 搬進 SQLite，原始檔案改名為 logs.json.migrated 留底');
  } catch (err) {
    console.error('[logs] 搬移舊版 logs.json 失敗', err);
  }
}

function loadLogs() {
  if (!logsDbReady) return { errors: [], audits: [] };
  return {
    errors: queryAll(logsDb, 'SELECT id, timestamp, scope, message, stack FROM errors ORDER BY timestamp ASC'),
    audits: queryAll(logsDb, 'SELECT id, timestamp, category, action, detail FROM audits ORDER BY timestamp ASC'),
  };
}

function trimLogTable(table) {
  logsDb.run(
    `DELETE FROM ${table} WHERE id NOT IN (SELECT id FROM ${table} ORDER BY timestamp DESC LIMIT ${LOG_MAX_ENTRIES})`
  );
}

function clearLogs(kind) {
  if (!logsDbReady) return;
  if (kind === 'errors' || kind === 'audits') {
    logsDb.run(`DELETE FROM ${kind}`);
  } else {
    logsDb.run('DELETE FROM errors');
    logsDb.run('DELETE FROM audits');
  }
  saveLogsDatabase();
  broadcastToAllWindows('logs:changed');
}

function appendLogEntry(kind, entry) {
  if (!logsDbReady) {
    // 極早期（initLogsDatabase 的 await 還沒完成）就有人呼叫，先排隊
    pendingLogEntries.push({ kind, entry });
    return;
  }
  const id = genId('log');
  const timestamp = new Date().toISOString();
  if (kind === 'errors') {
    logsDb.run('INSERT INTO errors (id, timestamp, scope, message, stack) VALUES (?, ?, ?, ?, ?)', [
      id,
      timestamp,
      entry.scope || null,
      entry.message || null,
      entry.stack || null,
    ]);
    trimLogTable('errors');
  } else if (kind === 'audits') {
    logsDb.run('INSERT INTO audits (id, timestamp, category, action, detail) VALUES (?, ?, ?, ?, ?)', [
      id,
      timestamp,
      entry.category || null,
      entry.action || null,
      entry.detail || null,
    ]);
    trimLogTable('audits');
  }
  saveLogsDatabase();
  broadcastToAllWindows('logs:changed');
}

// scope 例如 'documents:import'、'extensions:load'、'process'；err 可以是 Error 或字串或 undefined
function logError(scope, message, err) {
  console.error(`[${scope}]`, message, err || '');
  appendLogEntry('errors', {
    scope,
    message,
    stack: err && err.stack ? err.stack : err ? String(err) : null,
  });
}

// category 例如 'account'|'project'|'document'|'conversation'|'backup'|'settings'|'extension'
function logAudit(category, action, detail) {
  appendLogEntry('audits', { category, action, detail: detail || '' });
}

// ---------------------------------------------------------------------------
// 主控台（Console）：即時攔截 console.log/info/warn/error（含 WebContentsView
// 頁面自己的 console-message，見 createAccountView），存一份記憶體內的環狀
// 緩衝區即時廣播給日誌主控台視窗。這是「當下發生什麼事」的原始逐行輸出，
// 跟上面結構化、會落地存檔的錯誤/稽核日誌是互補關係：
//   - 錯誤/稽核日誌：篩選過的重點事件，存 logs.json，重開 App 還在。
//   - 主控台：完整的原始 console 輸出（含除錯用的細節，例如「這次擷取
//     matched 幾個節點」），只留在記憶體裡，App 關掉就沒了，不佔硬碟空間。
// ---------------------------------------------------------------------------

const CONSOLE_BUFFER_MAX = 300;
const consoleBuffer = [];
const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

function formatConsoleArg(arg) {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.stack || arg.message;
  try {
    return JSON.stringify(arg);
  } catch (err) {
    return String(arg);
  }
}

function captureConsole(level, args) {
  const entry = {
    id: genId('cl'),
    timestamp: new Date().toISOString(),
    level,
    text: args.map(formatConsoleArg).join(' '),
  };
  consoleBuffer.push(entry);
  if (consoleBuffer.length > CONSOLE_BUFFER_MAX) consoleBuffer.shift();
  broadcastToAllWindows('console:entry', entry);
  return entry;
}

['log', 'info', 'warn', 'error'].forEach((level) => {
  console[level] = (...args) => {
    originalConsole[level](...args);
    captureConsole(level, args);
  };
});

// ---------------------------------------------------------------------------
// 應用程式狀態（記憶體內，開機時載入，變更時寫回磁碟）
// ---------------------------------------------------------------------------

let appState = {
  accounts: [], // { id, platform, name, roleId }
  ui: { ...DEFAULT_UI_STATE },
  extensions: [], // { id, path, name, version, enabled }
  roles: [], // { id, name, description, color } — 帳號角色機制
};

function loadAppState() {
  const loaded = readJSONSafe(statePath(), null);
  if (loaded) {
    appState = {
      accounts: loaded.accounts || [],
      ui: {
        ...DEFAULT_UI_STATE,
        ...(loaded.ui || {}),
        // 深合併 sidebarGroups，避免舊資料檔缺少新群組時整個物件被覆蓋掉
        sidebarGroups: {
          ...DEFAULT_UI_STATE.sidebarGroups,
          ...((loaded.ui && loaded.ui.sidebarGroups) || {}),
        },
      },
      extensions: loaded.extensions || [],
      roles: loaded.roles || [],
    };
  } else {
    appState = { accounts: [], ui: { ...DEFAULT_UI_STATE }, extensions: [], roles: [] };
  }
}

function saveAppState() {
  writeJSONSafe(statePath(), appState);
}

// 知識庫資料結構：
//   items:  一般提示詞項目，可選擇附帶一份獨立檢核表 checklist，
//     以及一份「角色配置」roleIds（這個提示詞要當成哪些角色的預設提示詞，
//     對應側邊欄「預設提示詞」區塊，會依目前選中帳號的角色列出來）
//     { id, title, content, tags: string[],
//       checklist: [{ id, text, checked }],
//       roleIds: string[],
//       createdAt, updatedAt }
//   groups: 群組順序提示詞套餐，steps 依序引用 items 的 id，
//     每個 step 本身就是「檢核表機制」的一格（追蹤這個步驟是否已使用/完成）
//     { id, title, description, tags: string[],
//       steps: [{ id, itemId, checked }],
//       createdAt, updatedAt }
function loadKnowledgeBase() {
  const loaded = readJSONSafe(knowledgePath(), null);
  if (!loaded) return { items: [], groups: [] };
  // 相容舊版格式（loaded 本身可能只有 items，沒有 groups）
  const items = Array.isArray(loaded.items) ? loaded.items : [];
  const groups = Array.isArray(loaded.groups) ? loaded.groups : [];
  // 補齊舊資料缺少的欄位
  items.forEach((it) => {
    if (!Array.isArray(it.checklist)) it.checklist = [];
    if (!Array.isArray(it.roleIds)) it.roleIds = [];
  });
  return { items, groups };
}

function saveKnowledgeBase(data) {
  writeJSONSafe(knowledgePath(), { items: data.items || [], groups: data.groups || [] });
}

function loadSelectors() {
  let loaded = readJSONSafe(selectorsPath(), null);
  if (!loaded) {
    const defaults = readJSONSafe(
      path.join(__dirname, 'extractors', 'default-selectors.json'),
      {}
    );
    writeJSONSafe(selectorsPath(), defaults);
    loaded = defaults;
  }
  return loaded;
}

function saveSelectors(selectors) {
  writeJSONSafe(selectorsPath(), selectors);
}

// 專案計畫管理：
//   project: { id, name, description, status ('planning'|'active'|'onhold'|'done'),
//              startDate, endDate, tasks: [...], issues: [...], createdAt, updatedAt }
//   task:    { id, title, description, assigneeId (帳號 id 或 null),
//              status ('todo'|'doing'|'done'), startDate, dueDate, createdAt, updatedAt }
//   issue:   { id, title, description, type ('bug'|'feature'|'task'|'improvement'),
//              priority ('low'|'medium'|'high'|'urgent'),
//              status ('open'|'inprogress'|'resolved'|'closed'),
//              assigneeId, dueDate, tags: string[], createdAt, updatedAt }
// 甘特圖、月曆檢視都是前端 (project.js) 純用 tasks/issues 裡的日期欄位即時
// 算出來顯示，不另外存衍生資料。
function loadProjects() {
  const loaded = readJSONSafe(projectsPath(), null);
  const projects = loaded && Array.isArray(loaded.projects) ? loaded.projects : [];
  projects.forEach((p) => {
    if (!Array.isArray(p.tasks)) p.tasks = [];
    if (!Array.isArray(p.issues)) p.issues = [];
  });
  return projects;
}

function saveProjects(projects) {
  writeJSONSafe(projectsPath(), { projects });
}

// 文件管理：儲存對話中產生的文件或手動匯入的檔案
//   doc: { id, name, tags: string[], notes, filePath, originalName,
//          size, managed (bool，true 表示檔案實體複製存在 documentsDir 裡，
//          false 表示只是引用使用者原本存放的路徑，例如匯出對話時產生的檔案),
//          sourceAccountId, sourcePlatform, createdAt }
function loadDocuments() {
  const loaded = readJSONSafe(documentsMetaPath(), null);
  return loaded && Array.isArray(loaded.documents) ? loaded.documents : [];
}

function saveDocuments(documents) {
  writeJSONSafe(documentsMetaPath(), { documents });
}

function registerDocument(meta) {
  const documents = loadDocuments();
  const now = new Date().toISOString();
  documents.push({
    id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tags: [],
    notes: '',
    sourceAccountId: null,
    sourcePlatform: null,
    managed: false,
    createdAt: now,
    ...meta,
  });
  saveDocuments(documents);
  broadcastToAllWindows('documents:changed');
  return documents;
}

// 對話庫：手動建立/擷取的對話 Markdown 內容，可匯出成檔案（自動登記進文件庫），
// 也可以手動跟文件庫既有的文件互相關聯（多對多，存 linkedDocumentIds）。
//   conversation: { id, title, tags: string[], content (markdown),
//                   sourceAccountId, sourcePlatform, linkedDocumentIds: string[],
//                   createdAt, updatedAt }
function loadConversations() {
  const loaded = readJSONSafe(conversationsMetaPath(), null);
  const conversations = loaded && Array.isArray(loaded.conversations) ? loaded.conversations : [];
  conversations.forEach((c) => {
    if (!Array.isArray(c.tags)) c.tags = [];
    if (!Array.isArray(c.linkedDocumentIds)) c.linkedDocumentIds = [];
  });
  return conversations;
}

function saveConversations(conversations) {
  writeJSONSafe(conversationsMetaPath(), { conversations });
}

// ---------------------------------------------------------------------------
// 視窗 / View 管理
// ---------------------------------------------------------------------------

let mainWindow = null;
let accountWindow = null;
let knowledgeWindow = null;
let settingsWindow = null;
let teamWindow = null;
let projectWindow = null;
let documentsWindow = null;
let conversationsWindow = null;
let logWindow = null;

// accountId -> { view, platform, name }
const accountViews = new Map();
let activeAccountId = null;

function getContentBounds() {
  if (!mainWindow) return { x: 0, y: 0, width: 0, height: 0 };
  const [winWidth, winHeight] = mainWindow.getContentSize();
  const sidebarWidth = appState.ui.sidebarCollapsed
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
  if (!activeAccountId) return;
  const entry = accountViews.get(activeAccountId);
  if (!entry) return;
  entry.view.setBounds(getContentBounds());
}

function applyExtensionsToSession(ses) {
  appState.extensions
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
  view.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3) return; // ERR_ABORTED，通常是使用者自己導覽到別的頁面，不算錯誤
    logError(
      'account:load',
      `帳號「${account.name}」(${account.platform}) 頁面載入失敗: ${errorDescription} (${errorCode}) ${validatedURL}`
    );
  });
  view.webContents.on('console-message', (...args) => {
    // Electron 版本間簽章不完全一致，這裡同時容錯處理舊版跟新版的參數形狀：
    //   舊版: (event, level, message, line, sourceId)
    //   新版: (event) 其中 event 本身帶 level/message/lineNumber/sourceId 屬性
    let message = null;
    if (args.length >= 3 && typeof args[2] === 'string') {
      message = args[2];
    } else if (args[0] && typeof args[0] === 'object' && typeof args[0].message === 'string') {
      message = args[0].message;
    }
    if (message) {
      captureConsole('page', [`[${account.platform}/${account.name}] ${message}`]);
    }
  });

  mainWindow.contentView.addChildView(view);
  view.setVisible(false);

  accountViews.set(account.id, { view, platform: account.platform, name: account.name });
}

function rebuildAllAccountViews() {
  appState.accounts.forEach((account) => createAccountView(account));
}

function switchAccount(accountId) {
  if (!accountViews.has(accountId)) return false;
  accountViews.forEach((entry, id) => {
    entry.view.setVisible(id === accountId);
  });
  activeAccountId = accountId;
  layoutActiveView();
  return true;
}

function addAccount(platform, name, roleId) {
  const account = { id: genId(), platform, name, roleId: roleId || null };
  appState.accounts.push(account);
  saveAppState();
  createAccountView(account);
  switchAccount(account.id);
  return account;
}

function removeAccount(accountId) {
  const entry = accountViews.get(accountId);
  if (entry) {
    mainWindow.contentView.removeChildView(entry.view);
    const partition = `persist:${accountId}`;
    session.fromPartition(partition).clearStorageData().catch(() => {});
    accountViews.delete(accountId);
  }
  appState.accounts = appState.accounts.filter((a) => a.id !== accountId);
  saveAppState();
  if (activeAccountId === accountId) {
    activeAccountId = null;
    const next = appState.accounts[0];
    if (next) switchAccount(next.id);
  }
}

// ---------------------------------------------------------------------------
// 主視窗
// ---------------------------------------------------------------------------

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('resize', layoutActiveView);

  mainWindow.on('closed', () => {
    mainWindow = null;
    app.quit();
  });

  rebuildAllAccountViews();
  if (appState.accounts.length > 0) {
    switchAccount(appState.accounts[0].id);
  }
}

// ---------------------------------------------------------------------------
// 共用子視窗 helper
// ---------------------------------------------------------------------------

function openChildWindow({ getWindow, setWindow, htmlFile, width, height, minWidth, minHeight }) {
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
    parent: mainWindow,
    modal: false,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', htmlFile));
  win.on('closed', () => setWindow(null));
  setWindow(win);
  return win;
}

function openAccountWindow() {
  return openChildWindow({
    getWindow: () => accountWindow,
    setWindow: (w) => (accountWindow = w),
    htmlFile: 'account.html',
    width: 420,
    height: 320,
  });
}

function openKnowledgeWindow() {
  return openChildWindow({
    getWindow: () => knowledgeWindow,
    setWindow: (w) => (knowledgeWindow = w),
    htmlFile: 'knowledge.html',
    width: 960,
    height: 640,
    minWidth: 640,
    minHeight: 420,
  });
}

function openSettingsWindow() {
  return openChildWindow({
    getWindow: () => settingsWindow,
    setWindow: (w) => (settingsWindow = w),
    htmlFile: 'settings.html',
    width: 720,
    height: 720,
    minWidth: 520,
    minHeight: 480,
  });
}

function openTeamWindow() {
  return openChildWindow({
    getWindow: () => teamWindow,
    setWindow: (w) => (teamWindow = w),
    htmlFile: 'team.html',
    width: 960,
    height: 640,
    minWidth: 640,
    minHeight: 420,
  });
}

function openProjectWindow() {
  return openChildWindow({
    getWindow: () => projectWindow,
    setWindow: (w) => (projectWindow = w),
    htmlFile: 'project.html',
    width: 1040,
    height: 680,
    minWidth: 680,
    minHeight: 460,
  });
}

function openDocumentsWindow() {
  return openChildWindow({
    getWindow: () => documentsWindow,
    setWindow: (w) => (documentsWindow = w),
    htmlFile: 'documents.html',
    width: 960,
    height: 640,
    minWidth: 640,
    minHeight: 420,
  });
}

function openConversationsWindow() {
  return openChildWindow({
    getWindow: () => conversationsWindow,
    setWindow: (w) => (conversationsWindow = w),
    htmlFile: 'conversation.html',
    width: 1000,
    height: 680,
    minWidth: 680,
    minHeight: 460,
  });
}

function openLogWindow() {
  return openChildWindow({
    getWindow: () => logWindow,
    setWindow: (w) => (logWindow = w),
    htmlFile: 'log.html',
    width: 900,
    height: 640,
    minWidth: 620,
    minHeight: 420,
  });
}

function broadcastToAllWindows(channel, ...args) {
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed()) w.webContents.send(channel, ...args);
  });
}

// ---------------------------------------------------------------------------
// 對話匯出
// ---------------------------------------------------------------------------

async function captureCurrentConversation() {
  if (!activeAccountId) return { ok: false, error: 'NO_ACTIVE_ACCOUNT' };
  const entry = accountViews.get(activeAccountId);
  if (!entry) return { ok: false, error: 'NO_ACTIVE_ACCOUNT' };

  const selectors = loadSelectors();
  const selectorConfig = selectors[entry.platform] || {};
  const domCaptureSrc = fs.readFileSync(
    path.join(__dirname, 'extractors', 'domCapture.js'),
    'utf-8'
  );
  const script = `${domCaptureSrc}\ncapturePlatformConversation(${JSON.stringify(
    entry.platform
  )}, ${JSON.stringify(selectorConfig)});`;

  try {
    const result = await entry.view.webContents.executeJavaScript(script);
    const debug = result && result.debug;
    console.log(
      `[conversation:capture] platform=${entry.platform} ok=${result ? result.ok : false} ` +
        `matchedNodes=${debug ? debug.matchedNodeCount : '?'} nonEmptyMessages=${
          debug ? debug.nonEmptyMessageCount : '?'
        } selector="${debug ? debug.selectorUsed : selectorConfig.turn || '(未設定)'}" ` +
        `error=${result && result.error ? result.error : 'none'}`
    );
    if (!result || !result.ok) {
      logError(
        'conversation:capture',
        `擷取對話失敗 (${entry.platform}): ${result ? result.error : 'UNKNOWN'}` +
          (debug ? `，符合 selector 的節點數=${debug.matchedNodeCount}，有內容的訊息數=${debug.nonEmptyMessageCount}` : '')
      );
    }
    return result;
  } catch (err) {
    logError('conversation:capture', `擷取對話失敗 (${entry.platform})`, err);
    return { ok: false, error: 'EXECUTE_FAILED: ' + err.message };
  }
}

async function exportCurrentConversation(format) {
  const result = await captureCurrentConversation();
  if (!result || !result.ok) {
    // captureCurrentConversation() 內部已經記過詳細的 logError，這裡不重複記錄，
    // 只把「使用者當下按了匯出，但因為擷取失敗所以整個匯出動作沒有成功」這件
    // 事實補記一筆稽核紀錄，方便回頭對照時間點。
    logAudit('conversation', 'exportFailed', `匯出當前對話失敗：${result ? result.error : 'UNKNOWN'}`);
    return { ok: false, error: result ? result.error : 'UNKNOWN', debug: result ? result.debug : undefined };
  }

  const ext = format === 'json' ? 'json' : 'md';
  const content =
    format === 'json' ? JSON.stringify(result, null, 2) : toMarkdown(result);
  const baseName = (result.title || 'conversation').replace(/[\\/:*?"<>|]/g, '_');

  const defaultDir = appState.ui.defaultSavePath || app.getPath('documents');
  const currentEntry = activeAccountId ? accountViews.get(activeAccountId) : null;

  function registerExportedFile(filePath) {
    let size = 0;
    try {
      size = fs.statSync(filePath).size;
    } catch (err) {
      // 忽略，size 只是附加資訊
    }
    registerDocument({
      name: path.basename(filePath),
      originalName: path.basename(filePath),
      filePath,
      size,
      managed: false, // 檔案留在使用者選擇/預設的儲存位置，文件庫只是登記引用
      sourceAccountId: activeAccountId,
      sourcePlatform: currentEntry ? currentEntry.platform : null,
      tags: currentEntry ? [currentEntry.platform] : [],
    });
    logAudit(
      'conversation',
      'export',
      `匯出目前對話「${result.title || ''}」(${currentEntry ? currentEntry.platform : '未知平台'}) 至：${filePath}`
    );
  }

  try {
    if (appState.ui.skipSaveDialog) {
      const filePath = ensureUniqueFilePath(defaultDir, baseName, ext);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, 'utf-8');
      registerExportedFile(filePath);
      return { ok: true, filePath };
    }

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: '匯出對話',
      defaultPath: path.join(defaultDir, `${baseName}.${ext}`),
      filters:
        format === 'json'
          ? [{ name: 'JSON', extensions: ['json'] }]
          : [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (canceled || !filePath) return { ok: false, error: 'CANCELLED' };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
    registerExportedFile(filePath);
    return { ok: true, filePath };
  } catch (err) {
    logError('conversation:export', '寫入匯出檔案失敗', err);
    return { ok: false, error: 'WRITE_FAILED: ' + err.message };
  }
}

// ---------------------------------------------------------------------------
// 對話庫：把庫裡的一則對話匯出成檔案，並自動登記進文件庫、跟這則對話互相關聯
// ---------------------------------------------------------------------------

async function exportConversationEntry(id, format) {
  const conversations = loadConversations();
  const conv = conversations.find((c) => c.id === id);
  if (!conv) return { ok: false, error: 'NOT_FOUND' };

  const ext = format === 'json' ? 'json' : 'md';
  const content =
    format === 'json'
      ? JSON.stringify(
          { title: conv.title, tags: conv.tags, content: conv.content },
          null,
          2
        )
      : conv.content || '';
  const baseName = (conv.title || 'conversation').replace(/[\\/:*?"<>|]/g, '_');
  const defaultDir = appState.ui.defaultSavePath || app.getPath('documents');

  let filePath;
  if (appState.ui.skipSaveDialog) {
    filePath = ensureUniqueFilePath(defaultDir, baseName, ext);
  } else {
    const parentWin = conversationsWindow && !conversationsWindow.isDestroyed() ? conversationsWindow : mainWindow;
    const result = await dialog.showSaveDialog(parentWin, {
      title: '匯出對話',
      defaultPath: path.join(defaultDir, `${baseName}.${ext}`),
      filters:
        format === 'json'
          ? [{ name: 'JSON', extensions: ['json'] }]
          : [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, error: 'CANCELLED' };
    filePath = result.filePath;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
  } catch (err) {
    logError('conversation:export', `寫入匯出檔案失敗: ${filePath}`, err);
    return { ok: false, error: 'WRITE_FAILED: ' + err.message };
  }

  let size = 0;
  try {
    size = fs.statSync(filePath).size;
  } catch (err) {
    // 忽略，size 只是附加資訊
  }

  // 自動登記進文件庫（只記錄路徑引用，不複製），並跟來源對話互相關聯
  const documents = registerDocument({
    name: path.basename(filePath),
    originalName: path.basename(filePath),
    filePath,
    size,
    managed: false,
    sourceAccountId: conv.sourceAccountId || null,
    sourcePlatform: conv.sourcePlatform || null,
    tags: conv.tags && conv.tags.length ? conv.tags : ['對話庫'],
  });
  const newDoc = documents[documents.length - 1];

  conv.linkedDocumentIds = Array.isArray(conv.linkedDocumentIds) ? conv.linkedDocumentIds : [];
  if (newDoc && !conv.linkedDocumentIds.includes(newDoc.id)) {
    conv.linkedDocumentIds.push(newDoc.id);
  }
  conv.updatedAt = new Date().toISOString();
  saveConversations(conversations);
  broadcastToAllWindows('conversations:changed');
  logAudit('conversation', 'export', `匯出對話「${conv.title || ''}」為 ${filePath}`);

  return { ok: true, filePath, documentId: newDoc ? newDoc.id : null };
}

// ---------------------------------------------------------------------------
// 選取器工具（滑鼠選取範例訊息）
// ---------------------------------------------------------------------------

async function pickSelectorSample() {
  if (!activeAccountId) return { cancelled: true, error: 'NO_ACTIVE_ACCOUNT' };
  const entry = accountViews.get(activeAccountId);
  if (!entry) return { cancelled: true, error: 'NO_ACTIVE_ACCOUNT' };

  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.minimize();
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }

  const pickerSrc = fs.readFileSync(
    path.join(__dirname, 'extractors', 'selectorPicker.js'),
    'utf-8'
  );

  try {
    const result = await entry.view.webContents.executeJavaScript(pickerSrc);
    return result;
  } catch (err) {
    logError('selector:pick', '選取器工具擷取失敗', err);
    return { cancelled: true, error: err.message };
  } finally {
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.restore();
  }
}

// ---------------------------------------------------------------------------
// IPC Handlers
// ---------------------------------------------------------------------------

function registerIpcHandlers() {
  // --- 帳號 ---
  ipcMain.handle('accounts:list', () => {
    return appState.accounts.map((a) => ({ ...a, active: a.id === activeAccountId }));
  });

  ipcMain.handle('accounts:add', (e, { platform, name, roleId }) => {
    const account = addAccount(platform, name, roleId);
    logAudit('account', 'add', `新增帳號「${account.name}」(${account.platform})`);
    broadcastToAllWindows('accounts:changed');
    return account;
  });

  ipcMain.handle('accounts:switch', (e, accountId) => {
    const ok = switchAccount(accountId);
    broadcastToAllWindows('accounts:changed');
    return ok;
  });

  ipcMain.handle('accounts:remove', (e, accountId) => {
    const account = appState.accounts.find((a) => a.id === accountId);
    removeAccount(accountId);
    if (account) {
      logAudit('account', 'remove', `移除帳號「${account.name}」(${account.platform})`);
    }
    broadcastToAllWindows('accounts:changed');
    return true;
  });

  ipcMain.handle('accounts:setSidebarCollapsed', (e, collapsed) => {
    appState.ui.sidebarCollapsed = !!collapsed;
    saveAppState();
    layoutActiveView();
    return true;
  });

  // 側邊欄多層清單：記住每個群組的展開/收合狀態
  ipcMain.handle('ui:setGroupExpanded', (e, { key, expanded }) => {
    appState.ui.sidebarGroups[key] = !!expanded;
    saveAppState();
    return true;
  });

  // 帳號角色機制：把某個角色指派給帳號（roleId 可為 null，代表移除角色）
  ipcMain.handle('accounts:setRole', (e, { accountId, roleId }) => {
    const account = appState.accounts.find((a) => a.id === accountId);
    if (account) account.roleId = roleId || null;
    saveAppState();
    broadcastToAllWindows('accounts:changed');
    return appState.accounts.map((a) => ({ ...a, active: a.id === activeAccountId }));
  });

  // 帳號清單拖曳排序：orderedIds 是拖完之後前端算好的新順序（完整帳號 id
  // 清單）。用 Map 查表重組陣列，順便防呆——萬一傳進來的清單漏了某個
  // 帳號（理論上不該發生，但別讓一次前端邏輯失誤就憑空搞丟帳號），把
  // 沒對到的帳號照原順序接在最後面，不要整個報錯或遺失資料。
  ipcMain.handle('accounts:reorder', (e, orderedIds) => {
    const byId = new Map(appState.accounts.map((a) => [a.id, a]));
    const reordered = [];
    orderedIds.forEach((id) => {
      const account = byId.get(id);
      if (account && !reordered.includes(account)) reordered.push(account);
    });
    appState.accounts.forEach((a) => {
      if (!reordered.includes(a)) reordered.push(a);
    });
    appState.accounts = reordered;
    saveAppState();
    broadcastToAllWindows('accounts:changed');
    return appState.accounts.map((a) => ({ ...a, active: a.id === activeAccountId }));
  });

  // --- 帳號角色管理（角色是可重複套用到多個帳號的共用定義） ---
  ipcMain.handle('roles:list', () => appState.roles);

  ipcMain.handle('roles:save', (e, role) => {
    const now = new Date().toISOString();
    if (role.id) {
      const idx = appState.roles.findIndex((r) => r.id === role.id);
      if (idx >= 0) {
        appState.roles[idx] = { ...appState.roles[idx], ...role, updatedAt: now };
      } else {
        appState.roles.push({ ...role, createdAt: now, updatedAt: now });
      }
    } else {
      role.id = `role_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      role.createdAt = now;
      role.updatedAt = now;
      appState.roles.push(role);
    }
    saveAppState();
    broadcastToAllWindows('accounts:changed');
    return appState.roles;
  });

  ipcMain.handle('roles:delete', (e, id) => {
    appState.roles = appState.roles.filter((r) => r.id !== id);
    // 角色被刪除後，原本套用這個角色的帳號改回「無角色」，不留下懸空引用
    appState.accounts.forEach((a) => {
      if (a.roleId === id) a.roleId = null;
    });
    saveAppState();

    // 知識庫項目裡「角色配置」引用到這個角色的也一併移除
    const kb = loadKnowledgeBase();
    let kbChanged = false;
    kb.items.forEach((it) => {
      if ((it.roleIds || []).includes(id)) {
        it.roleIds = it.roleIds.filter((r) => r !== id);
        kbChanged = true;
      }
    });
    if (kbChanged) saveKnowledgeBase(kb);

    broadcastToAllWindows('accounts:changed');
    broadcastToAllWindows('knowledge:changed');
    return appState.roles;
  });

  // --- UI 狀態 / 語言 ---
  ipcMain.handle('ui:getState', () => appState.ui);

  ipcMain.handle('ui:setLanguage', (e, lang) => {
    appState.ui.language = lang;
    saveAppState();
    broadcastToAllWindows('language:changed', lang);
    return true;
  });

  // --- 匯出對話 ---
  ipcMain.handle('export:current', async (e, format) => {
    return exportCurrentConversation(format);
  });

  // --- 知識庫：提示詞項目 ---
  ipcMain.handle('knowledge:list', () => loadKnowledgeBase());

  ipcMain.handle('knowledge:save', (e, item) => {
    const kb = loadKnowledgeBase();
    const now = new Date().toISOString();
    const checklist = Array.isArray(item.checklist) ? item.checklist : [];
    const roleIds = Array.isArray(item.roleIds) ? item.roleIds : [];
    if (item.id) {
      const idx = kb.items.findIndex((i) => i.id === item.id);
      if (idx >= 0) {
        kb.items[idx] = { ...kb.items[idx], ...item, checklist, roleIds, updatedAt: now };
      } else {
        kb.items.push({ ...item, checklist, roleIds, createdAt: now, updatedAt: now });
      }
    } else {
      item.id = `kb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      item.checklist = checklist;
      item.roleIds = roleIds;
      item.createdAt = now;
      item.updatedAt = now;
      kb.items.push(item);
    }
    saveKnowledgeBase(kb);
    broadcastToAllWindows('knowledge:changed');
    return kb;
  });

  ipcMain.handle('knowledge:delete', (e, id) => {
    const kb = loadKnowledgeBase();
    kb.items = kb.items.filter((i) => i.id !== id);
    // 項目刪除後，任何套餐裡引用到這個項目的步驟也一併移除，避免懸空引用
    kb.groups.forEach((g) => {
      g.steps = g.steps.filter((s) => s.itemId !== id);
    });
    saveKnowledgeBase(kb);
    broadcastToAllWindows('knowledge:changed');
    return kb;
  });

  // --- 知識庫：檢核表（單一項目自帶的獨立檢核表） ---
  ipcMain.handle('knowledge:toggleChecklistEntry', (e, { itemId, entryId, checked }) => {
    const kb = loadKnowledgeBase();
    const item = kb.items.find((i) => i.id === itemId);
    if (item) {
      const entry = (item.checklist || []).find((c) => c.id === entryId);
      if (entry) entry.checked = checked;
      item.updatedAt = new Date().toISOString();
    }
    saveKnowledgeBase(kb);
    broadcastToAllWindows('knowledge:changed');
    return kb;
  });

  // --- 知識庫：群組順序提示詞套餐 ---
  ipcMain.handle('knowledge:group:save', (e, group) => {
    const kb = loadKnowledgeBase();
    const now = new Date().toISOString();
    const steps = Array.isArray(group.steps)
      ? group.steps.map((s) => ({
          id: s.id || `step_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          itemId: s.itemId,
          checked: !!s.checked,
        }))
      : [];
    if (group.id) {
      const idx = kb.groups.findIndex((g) => g.id === group.id);
      if (idx >= 0) {
        kb.groups[idx] = { ...kb.groups[idx], ...group, steps, updatedAt: now };
      } else {
        kb.groups.push({ ...group, steps, createdAt: now, updatedAt: now });
      }
    } else {
      group.id = `grp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      group.steps = steps;
      group.createdAt = now;
      group.updatedAt = now;
      kb.groups.push(group);
    }
    saveKnowledgeBase(kb);
    broadcastToAllWindows('knowledge:changed');
    return kb;
  });

  ipcMain.handle('knowledge:group:delete', (e, id) => {
    const kb = loadKnowledgeBase();
    kb.groups = kb.groups.filter((g) => g.id !== id);
    saveKnowledgeBase(kb);
    broadcastToAllWindows('knowledge:changed');
    return kb;
  });

  // 檢核表機制：勾選/取消勾選套餐裡的某一個步驟（追蹤這個步驟是否已使用/完成）
  ipcMain.handle('knowledge:group:toggleStep', (e, { groupId, stepId, checked }) => {
    const kb = loadKnowledgeBase();
    const group = kb.groups.find((g) => g.id === groupId);
    if (group) {
      const step = group.steps.find((s) => s.id === stepId);
      if (step) step.checked = checked;
      group.updatedAt = new Date().toISOString();
    }
    saveKnowledgeBase(kb);
    broadcastToAllWindows('knowledge:changed');
    return kb;
  });

  // 重置整份套餐的檢核表進度（全部取消勾選），方便下次重新走一輪流程
  ipcMain.handle('knowledge:group:resetChecklist', (e, groupId) => {
    const kb = loadKnowledgeBase();
    const group = kb.groups.find((g) => g.id === groupId);
    if (group) {
      group.steps.forEach((s) => (s.checked = false));
      group.updatedAt = new Date().toISOString();
    }
    saveKnowledgeBase(kb);
    broadcastToAllWindows('knowledge:changed');
    return kb;
  });

  ipcMain.handle('knowledge:exportAll', async (e, format) => {
    const kb = loadKnowledgeBase();
    const { canceled, filePath } = await dialog.showSaveDialog(knowledgeWindow, {
      title: '匯出知識庫',
      defaultPath: `knowledge-base.${format === 'json' ? 'json' : 'md'}`,
      filters:
        format === 'json'
          ? [{ name: 'JSON', extensions: ['json'] }]
          : [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (canceled || !filePath) return { ok: false };
    let content;
    if (format === 'json') {
      content = JSON.stringify(kb, null, 2);
    } else {
      const itemBlocks = kb.items.map((it) => {
        const tags = (it.tags || []).map((t) => `#${t}`).join(' ');
        const checklist = (it.checklist || [])
          .map((c) => `- [${c.checked ? 'x' : ' '}] ${c.text}`)
          .join('\n');
        return [
          `## ${it.title}`,
          '',
          tags,
          '',
          it.content,
          checklist ? `\n**檢核表**\n\n${checklist}` : '',
        ]
          .join('\n')
          .trim();
      });
      const itemsById = new Map(kb.items.map((it) => [it.id, it]));
      const groupBlocks = kb.groups.map((g) => {
        const tags = (g.tags || []).map((t) => `#${t}`).join(' ');
        const steps = g.steps
          .map((s, idx) => {
            const item = itemsById.get(s.itemId);
            return `${idx + 1}. [${s.checked ? 'x' : ' '}] ${item ? item.title : '(已刪除的項目)'}`;
          })
          .join('\n');
        return [`## 📦 套餐：${g.title}`, '', tags, '', g.description || '', '', steps]
          .join('\n')
          .trim();
      });
      content = [...itemBlocks, ...groupBlocks].join('\n\n---\n\n');
    }
    fs.writeFileSync(filePath, content, 'utf-8');
    return { ok: true, filePath };
  });

  ipcMain.handle('knowledge:import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(knowledgeWindow, {
      title: '匯入知識庫',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (canceled || filePaths.length === 0) return loadKnowledgeBase();
    const raw = readJSONSafe(filePaths[0], null);
    if (!raw || !Array.isArray(raw.items)) return loadKnowledgeBase();

    const kb = loadKnowledgeBase();
    const now = new Date().toISOString();

    // 匯入項目：重新產生 id，避免撞號；同時記住新舊 id 對照，讓套餐引用可以跟著轉換
    const idMap = new Map();
    raw.items.forEach((it) => {
      const newId = `kb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      idMap.set(it.id, newId);
      kb.items.push({
        id: newId,
        title: it.title || '未命名',
        content: it.content || '',
        tags: Array.isArray(it.tags) ? it.tags : [],
        checklist: Array.isArray(it.checklist)
          ? it.checklist.map((c) => ({
              id: `chk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              text: c.text || '',
              checked: !!c.checked,
            }))
          : [],
        roleIds: [], // 角色是各安裝環境自己的資料，匯入不帶入來源檔案的角色配置
        createdAt: it.createdAt || now,
        updatedAt: now,
      });
    });

    // 匯入套餐：steps 裡的 itemId 依 idMap 轉換；找不到對照的（來源檔案本身就缺項目）就跳過該步驟
    if (Array.isArray(raw.groups)) {
      raw.groups.forEach((g) => {
        const steps = (g.steps || [])
          .map((s) => ({
            id: `step_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            itemId: idMap.get(s.itemId) || null,
            checked: false,
          }))
          .filter((s) => s.itemId);
        kb.groups.push({
          id: `grp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          title: g.title || '未命名套餐',
          description: g.description || '',
          tags: Array.isArray(g.tags) ? g.tags : [],
          steps,
          createdAt: g.createdAt || now,
          updatedAt: now,
        });
      });
    }

    saveKnowledgeBase(kb);
    broadcastToAllWindows('knowledge:changed');
    return kb;
  });

  // 匯入現成的 Markdown 檔案（例如之前用對話庫/其他工具匯出的 .md），直接
  // 變成一則新的提示詞項目，檔名（去掉副檔名）當標題、檔案內容整份塞進
  // content，匯入後照樣可以在編輯器裡檢視/編輯，跟手動新增的項目沒有差別。
  ipcMain.handle('knowledge:importMarkdown', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(knowledgeWindow, {
      title: '匯入 Markdown 檔案',
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
      properties: ['openFile', 'multiSelections'],
    });
    if (canceled || filePaths.length === 0) return { kb: loadKnowledgeBase(), importedIds: [] };

    const kb = loadKnowledgeBase();
    const now = new Date().toISOString();
    const importedIds = [];

    filePaths.forEach((filePath) => {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const title = path.basename(filePath).replace(/\.[^.]+$/, '');
        const id = genId('kb');
        kb.items.push({
          id,
          title,
          content,
          tags: [],
          checklist: [],
          roleIds: [],
          createdAt: now,
          updatedAt: now,
        });
        importedIds.push(id);
      } catch (err) {
        logError('knowledge:importMarkdown', `匯入 Markdown 檔案失敗: ${filePath}`, err);
      }
    });

    saveKnowledgeBase(kb);
    if (importedIds.length > 0) {
      logAudit('knowledge', 'importMarkdown', `匯入 ${importedIds.length} 個 Markdown 檔案`);
    }
    broadcastToAllWindows('knowledge:changed');
    return { kb, importedIds };
  });

  // --- 設定：資料目錄 ---
  ipcMain.handle('settings:getDataDir', () => ({
    dataDir: getDataDir(),
    isDefault: isDefaultDataDir(),
  }));

  ipcMain.handle('settings:chooseDataDir', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(settingsWindow, {
      title: '選擇外部資料夾',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || filePaths.length === 0) return { changed: false };

    const { response } = await dialog.showMessageBox(settingsWindow, {
      type: 'question',
      buttons: ['立即重新啟動', '取消'],
      defaultId: 0,
      cancelId: 1,
      message: '需要重新啟動應用程式才能套用新的設定檔存放位置，是否立即重啟？',
    });
    if (response !== 0) return { changed: false };

    setDataDir(filePaths[0]);
    logAudit('settings', 'dataDir', `切換設定檔存放位置為：${filePaths[0]}`);
    app.relaunch();
    // 用 app.quit()（正常關閉流程）而不是 app.exit()（立刻強制終止）：
    // app.exit() 會跳過視窗關閉、session 清理等正常步驟，Chromium 的磁碟
    // 快取/service worker/quota 資料庫可能來不及正常關閉就被砍斷，下次
    // 啟動時就會看到 "Unable to create cache"、"Could not open the quota
    // database, resetting" 這類錯誤（本質上是快取檔案沒有正常關閉留下的
    // 髒狀態，不是資料遺失，App 通常還是能繼續運作，但值得從源頭避免）。
    app.quit();
    return { changed: true };
  });

  ipcMain.handle('settings:resetDataDir', async () => {
    const { response } = await dialog.showMessageBox(settingsWindow, {
      type: 'question',
      buttons: ['立即重新啟動', '取消'],
      defaultId: 0,
      cancelId: 1,
      message: '需要重新啟動應用程式才能還原為預設位置，是否立即重啟？',
    });
    if (response !== 0) return { changed: false };
    resetDataDir();
    logAudit('settings', 'dataDir', '還原設定檔存放位置為預設位置');
    app.relaunch();
    app.quit();
    return { changed: true };
  });

  // --- 設定：擴充功能 ---
  ipcMain.handle('settings:getExtensions', () => appState.extensions);

  ipcMain.handle('settings:addExtension', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(settingsWindow, {
      title: '選擇已解壓縮的擴充功能資料夾',
      properties: ['openDirectory'],
    });
    if (canceled || filePaths.length === 0) return appState.extensions;
    const folder = filePaths[0];
    const manifestPath = path.join(folder, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      dialog.showErrorBox('錯誤', '選擇的資料夾裡找不到 manifest.json');
      return appState.extensions;
    }
    const manifest = readJSONSafe(manifestPath, {});
    const ext = {
      id: `ext_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      path: folder,
      name: manifest.name || path.basename(folder),
      version: manifest.version || '',
      enabled: true,
    };
    appState.extensions.push(ext);
    saveAppState();
    logAudit('extension', 'add', `安裝擴充功能「${ext.name}」`);
    accountViews.forEach((entry) => {
      const ses = entry.view.webContents.session;
      ses.loadExtension(ext.path, { allowFileAccess: true }).catch(() => {});
    });
    return appState.extensions;
  });

  ipcMain.handle('settings:toggleExtension', (e, { id, enabled }) => {
    const ext = appState.extensions.find((x) => x.id === id);
    if (!ext) return appState.extensions;
    ext.enabled = enabled;
    saveAppState();
    accountViews.forEach((entry) => {
      const ses = entry.view.webContents.session;
      if (enabled) {
        ses.loadExtension(ext.path, { allowFileAccess: true }).catch(() => {});
      } else {
        const loaded = ses.getAllExtensions().find((x) => x.path === ext.path);
        if (loaded) ses.removeExtension(loaded.id);
      }
    });
    return appState.extensions;
  });

  ipcMain.handle('settings:removeExtension', (e, id) => {
    const ext = appState.extensions.find((x) => x.id === id);
    if (ext) {
      accountViews.forEach((entry) => {
        const ses = entry.view.webContents.session;
        const loaded = ses.getAllExtensions().find((x) => x.path === ext.path);
        if (loaded) ses.removeExtension(loaded.id);
      });
      logAudit('extension', 'remove', `移除擴充功能「${ext.name}」`);
    }
    appState.extensions = appState.extensions.filter((x) => x.id !== id);
    saveAppState();
    return appState.extensions;
  });

  // --- 設定：儲存路徑 ---
  ipcMain.handle('settings:getSavePathConfig', () => ({
    defaultSavePath: appState.ui.defaultSavePath || app.getPath('documents'),
    skipSaveDialog: appState.ui.skipSaveDialog,
  }));

  ipcMain.handle('settings:chooseDefaultSavePath', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(settingsWindow, {
      title: '選擇預設儲存資料夾',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || filePaths.length === 0) return appState.ui.defaultSavePath;
    appState.ui.defaultSavePath = filePaths[0];
    saveAppState();
    return appState.ui.defaultSavePath;
  });

  ipcMain.handle('settings:setSkipSaveDialog', (e, skip) => {
    appState.ui.skipSaveDialog = !!skip;
    saveAppState();
    return true;
  });

  // --- 設定：備份與還原 ---
  ipcMain.handle('settings:exportBackup', async () => {
    const backup = {
      version: 1,
      accounts: appState.accounts, // 只有 platform/name/id，不含登入資料
      knowledge: loadKnowledgeBase(),
      projects: loadProjects(),
      documents: loadDocuments(),
      conversations: loadConversations(),
      settings: {
        ui: appState.ui,
        extensions: appState.extensions,
        selectors: loadSelectors(),
        roles: appState.roles,
      },
      exportedAt: new Date().toISOString(),
    };
    const { canceled, filePath } = await dialog.showSaveDialog(settingsWindow, {
      title: '匯出備份',
      defaultPath: 'ai-workspace-backup.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { ok: false };
    fs.writeFileSync(filePath, JSON.stringify(backup, null, 2), 'utf-8');
    logAudit('backup', 'export', `匯出備份至：${filePath}`);
    return { ok: true, filePath };
  });

  ipcMain.handle('settings:importBackup', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(settingsWindow, {
      title: '匯入備份',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (canceled || filePaths.length === 0) return { ok: false };
    const backup = readJSONSafe(filePaths[0], null);
    if (!backup) return { ok: false, error: 'INVALID_FILE' };

    // 帳號：已存在的 id 略過
    const existingIds = new Set(appState.accounts.map((a) => a.id));
    (backup.accounts || []).forEach((a) => {
      if (!existingIds.has(a.id)) {
        appState.accounts.push(a);
        createAccountView(a);
      }
    });

    // 角色：已存在的 id 略過，不覆蓋使用者後續的編輯
    const backupRoles = (backup.settings && backup.settings.roles) || [];
    const existingRoleIds = new Set(appState.roles.map((r) => r.id));
    backupRoles.forEach((r) => {
      if (!existingRoleIds.has(r.id)) appState.roles.push(r);
    });

    saveAppState();

    // 知識庫：項目與套餐都是已存在的 id 就略過，不覆蓋使用者後續的編輯
    const kb = loadKnowledgeBase();
    const existingItemIds = new Set(kb.items.map((i) => i.id));
    const backupKnowledge = backup.knowledge || { items: [], groups: [] };
    (backupKnowledge.items || []).forEach((it) => {
      if (!existingItemIds.has(it.id)) {
        kb.items.push({ checklist: [], roleIds: [], ...it });
      }
    });
    const existingGroupIds = new Set(kb.groups.map((g) => g.id));
    (backupKnowledge.groups || []).forEach((g) => {
      if (!existingGroupIds.has(g.id)) {
        kb.groups.push({ steps: [], ...g });
      }
    });
    saveKnowledgeBase(kb);

    // 專案：已存在的 id 略過
    const projects = loadProjects();
    const existingProjectIds = new Set(projects.map((p) => p.id));
    (backup.projects || []).forEach((p) => {
      if (!existingProjectIds.has(p.id)) {
        projects.push({ tasks: [], issues: [], ...p });
      }
    });
    saveProjects(projects);

    // 文件庫：已存在的 id 略過（注意：這裡只還原「中繼資料」，如果原本是
    // 「已管理」的檔案複本，且還原的環境跟原本不是同一台機器/資料夾，
    // 檔案本體不會被還原，清單上會顯示「檔案遺失」）
    const documents = loadDocuments();
    const existingDocIds = new Set(documents.map((d) => d.id));
    (backup.documents || []).forEach((d) => {
      if (!existingDocIds.has(d.id)) documents.push(d);
    });
    saveDocuments(documents);

    // 對話庫：已存在的 id 略過（linkedDocumentIds 引用到還原環境裡不存在的文件
    // id 時不強制清理，UI 會自然當成沒有關聯顯示，不影響其他資料）
    const conversations = loadConversations();
    const existingConversationIds = new Set(conversations.map((c) => c.id));
    (backup.conversations || []).forEach((c) => {
      if (!existingConversationIds.has(c.id)) {
        conversations.push({ tags: [], linkedDocumentIds: [], ...c });
      }
    });
    saveConversations(conversations);

    broadcastToAllWindows('accounts:changed');
    broadcastToAllWindows('knowledge:changed');
    broadcastToAllWindows('documents:changed');
    broadcastToAllWindows('conversations:changed');
    logAudit('backup', 'import', `匯入備份：${filePaths[0]}`);
    return { ok: true };
  });

  // --- 設定：選擇器 ---
  ipcMain.handle('settings:getSelectors', () => loadSelectors());

  ipcMain.handle('settings:saveSelector', (e, { platform, selector }) => {
    const selectors = loadSelectors();
    selectors[platform] = selector;
    saveSelectors(selectors);
    return selectors;
  });

  ipcMain.handle('settings:resetSelector', (e, platform) => {
    const defaults = readJSONSafe(
      path.join(__dirname, 'extractors', 'default-selectors.json'),
      {}
    );
    const selectors = loadSelectors();
    selectors[platform] = defaults[platform];
    saveSelectors(selectors);
    return selectors;
  });

  ipcMain.handle('settings:pickUserSample', async () => pickSelectorSample());
  ipcMain.handle('settings:pickAiSample', async () => pickSelectorSample());

  ipcMain.handle('settings:deriveSelector', (e, { userSample, aiSample }) => {
    return deriveSelectorFromSamples(userSample, aiSample);
  });

  // --- 設定：疑難排解 ---
  ipcMain.handle('settings:openCurrentDevTools', () => {
    if (!activeAccountId) return false;
    const entry = accountViews.get(activeAccountId);
    if (!entry) return false;
    entry.view.webContents.openDevTools({ mode: 'detach' });
    return true;
  });

  // 只清 HTTP 快取（session.clearCache()），刻意不用 clearStorageData()，
  // 避免連 cookies/localStorage 一起清掉導致所有帳號被登出。用來處理
  // "Unable to create cache" / "Could not open the quota database" 這類
  // Chromium 磁碟快取髒掉的疑難雜症。
  ipcMain.handle('settings:clearCache', async () => {
    const sessions = new Set([session.defaultSession]);
    accountViews.forEach((entry) => sessions.add(entry.view.webContents.session));
    await Promise.all(
      Array.from(sessions).map((ses) =>
        ses.clearCache().catch((err) => logError('settings:clearCache', '清除快取失敗', err))
      )
    );
    logAudit('settings', 'clearCache', `清除快取（含目前開啟的 ${accountViews.size} 個帳號）`);
    return true;
  });

  // --- App 版本號（側邊欄/設定頁顯示用） ---
  ipcMain.handle('app:getVersion', () => app.getVersion());

  // --- 子視窗開啟 ---
  ipcMain.handle('window:openAccountWindow', () => {
    openAccountWindow();
    return true;
  });
  ipcMain.handle('window:openKnowledgeWindow', () => {
    openKnowledgeWindow();
    return true;
  });
  ipcMain.handle('window:openSettingsWindow', () => {
    openSettingsWindow();
    return true;
  });
  ipcMain.handle('window:openTeamWindow', () => {
    openTeamWindow();
    return true;
  });
  ipcMain.handle('window:openProjectWindow', () => {
    openProjectWindow();
    return true;
  });
  ipcMain.handle('window:openDocumentsWindow', () => {
    openDocumentsWindow();
    return true;
  });
  ipcMain.handle('window:openConversationsWindow', () => {
    openConversationsWindow();
    return true;
  });
  ipcMain.handle('window:openLogWindow', () => {
    openLogWindow();
    return true;
  });
  ipcMain.handle('window:closeSelf', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win) win.close();
    return true;
  });

  // --- 專案計畫管理 ---
  ipcMain.handle('projects:list', () => loadProjects());

  ipcMain.handle('projects:save', (e, project) => {
    const projects = loadProjects();
    const now = new Date().toISOString();
    const isNewProject = !project.id;
    const tasks = Array.isArray(project.tasks)
      ? project.tasks.map((t) => ({
          id: t.id || `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          title: t.title || '',
          description: t.description || '',
          assigneeId: t.assigneeId || null,
          status: t.status || 'todo',
          startDate: t.startDate || null,
          dueDate: t.dueDate || null,
        }))
      : [];
    const issues = Array.isArray(project.issues)
      ? project.issues.map((i) => ({
          id: i.id || `issue_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          title: i.title || '',
          description: i.description || '',
          type: i.type || 'task',
          priority: i.priority || 'medium',
          status: i.status || 'open',
          assigneeId: i.assigneeId || null,
          dueDate: i.dueDate || null,
          tags: Array.isArray(i.tags) ? i.tags : [],
        }))
      : [];
    if (project.id) {
      const idx = projects.findIndex((p) => p.id === project.id);
      if (idx >= 0) {
        projects[idx] = { ...projects[idx], ...project, tasks, issues, updatedAt: now };
      } else {
        projects.push({ ...project, tasks, issues, createdAt: now, updatedAt: now });
      }
    } else {
      project.id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      project.tasks = tasks;
      project.issues = issues;
      project.createdAt = now;
      project.updatedAt = now;
      projects.push(project);
    }
    saveProjects(projects);
    if (isNewProject) {
      logAudit('project', 'create', `建立專案「${project.name || ''}」`);
    }
    return projects;
  });

  ipcMain.handle('projects:delete', (e, id) => {
    const target = loadProjects().find((p) => p.id === id);
    const projects = loadProjects().filter((p) => p.id !== id);
    saveProjects(projects);
    if (target) {
      logAudit('project', 'delete', `刪除專案「${target.name || ''}」`);
    }
    return projects;
  });

  // 任務狀態即時持久化（例如在看板上直接切換 待辦/進行中/已完成），不用等按「儲存專案」
  ipcMain.handle('projects:task:setStatus', (e, { projectId, taskId, status }) => {
    const projects = loadProjects();
    const project = projects.find((p) => p.id === projectId);
    if (project) {
      const task = project.tasks.find((t) => t.id === taskId);
      if (task) task.status = status;
      project.updatedAt = new Date().toISOString();
    }
    saveProjects(projects);
    return projects;
  });

  // Issue 狀態即時持久化，用途同上
  ipcMain.handle('projects:issue:setStatus', (e, { projectId, issueId, status }) => {
    const projects = loadProjects();
    const project = projects.find((p) => p.id === projectId);
    if (project) {
      const issue = (project.issues || []).find((i) => i.id === issueId);
      if (issue) issue.status = status;
      project.updatedAt = new Date().toISOString();
    }
    saveProjects(projects);
    return projects;
  });

  // --- 文件管理（儲存對話中產生的文件或手動匯入的檔案） ---
  function docsWithMissingFlag() {
    return loadDocuments().map((d) => ({ ...d, missing: !fs.existsSync(d.filePath) }));
  }

  ipcMain.handle('documents:list', () => docsWithMissingFlag());

  ipcMain.handle('documents:import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(documentsWindow, {
      title: '匯入檔案',
      properties: ['openFile', 'multiSelections'],
    });
    if (canceled || filePaths.length === 0) return docsWithMissingFlag();

    fs.mkdirSync(documentsDir(), { recursive: true });
    let importedCount = 0;
    filePaths.forEach((srcPath) => {
      const originalName = path.basename(srcPath);
      const uniquePrefix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const destPath = path.join(documentsDir(), `${uniquePrefix}_${originalName}`);
      try {
        fs.copyFileSync(srcPath, destPath);
        const size = fs.statSync(destPath).size;
        registerDocument({
          name: originalName,
          originalName,
          filePath: destPath,
          size,
          managed: true,
        });
        importedCount += 1;
      } catch (err) {
        logError('documents:import', `匯入檔案失敗: ${srcPath}`, err);
      }
    });
    if (importedCount > 0) {
      logAudit('document', 'import', `匯入 ${importedCount} 份檔案`);
    }
    return docsWithMissingFlag();
  });

  ipcMain.handle('documents:save', (e, { id, name, tags, notes }) => {
    const documents = loadDocuments();
    const doc = documents.find((d) => d.id === id);
    if (doc) {
      doc.name = name;
      doc.tags = Array.isArray(tags) ? tags : [];
      doc.notes = notes || '';
    }
    saveDocuments(documents);
    broadcastToAllWindows('documents:changed');
    return docsWithMissingFlag();
  });

  ipcMain.handle('documents:delete', (e, { id, alsoDeleteFile }) => {
    const documents = loadDocuments();
    const doc = documents.find((d) => d.id === id);
    if (doc && alsoDeleteFile && doc.managed) {
      try {
        if (fs.existsSync(doc.filePath)) fs.unlinkSync(doc.filePath);
      } catch (err) {
        logError('documents:delete', `刪除檔案失敗: ${doc.filePath}`, err);
      }
    }
    if (doc) {
      logAudit('document', 'delete', `移除文件「${doc.name}」${alsoDeleteFile ? '（含實體檔案）' : ''}`);
    }
    const remaining = documents.filter((d) => d.id !== id);
    saveDocuments(remaining);

    // 文件被移除時，對話庫裡引用到這份文件的關聯也一併清掉，避免懸空引用
    const conversations = loadConversations();
    let conversationsChanged = false;
    conversations.forEach((c) => {
      if ((c.linkedDocumentIds || []).includes(id)) {
        c.linkedDocumentIds = c.linkedDocumentIds.filter((docId) => docId !== id);
        conversationsChanged = true;
      }
    });
    if (conversationsChanged) {
      saveConversations(conversations);
      broadcastToAllWindows('conversations:changed');
    }

    broadcastToAllWindows('documents:changed');
    return docsWithMissingFlag();
  });

  ipcMain.handle('documents:openFile', (e, id) => {
    const doc = loadDocuments().find((d) => d.id === id);
    if (!doc || !fs.existsSync(doc.filePath)) return { ok: false, error: 'FILE_NOT_FOUND' };
    shell.openPath(doc.filePath);
    return { ok: true };
  });

  ipcMain.handle('documents:showInFolder', (e, id) => {
    const doc = loadDocuments().find((d) => d.id === id);
    if (!doc || !fs.existsSync(doc.filePath)) return { ok: false, error: 'FILE_NOT_FOUND' };
    shell.showItemInFolder(doc.filePath);
    return { ok: true };
  });

  // --- 對話庫（新增對話 Markdown、匯出檔案、跟文件庫的檔案互相關聯） ---
  ipcMain.handle('conversations:list', () => loadConversations());

  ipcMain.handle('conversations:save', (e, conv) => {
    const conversations = loadConversations();
    const now = new Date().toISOString();
    const isNewConversation = !conv.id;
    const tags = Array.isArray(conv.tags) ? conv.tags : [];
    const linkedDocumentIds = Array.isArray(conv.linkedDocumentIds) ? conv.linkedDocumentIds : [];
    if (conv.id) {
      const idx = conversations.findIndex((c) => c.id === conv.id);
      if (idx >= 0) {
        conversations[idx] = {
          ...conversations[idx],
          title: conv.title || '',
          tags,
          content: conv.content || '',
          linkedDocumentIds,
          updatedAt: now,
        };
      } else {
        conversations.push({ ...conv, tags, linkedDocumentIds, createdAt: now, updatedAt: now });
      }
    } else {
      conversations.push({
        id: genId('conv'),
        title: conv.title || '',
        tags,
        content: conv.content || '',
        sourceAccountId: conv.sourceAccountId || null,
        sourcePlatform: conv.sourcePlatform || null,
        linkedDocumentIds,
        createdAt: now,
        updatedAt: now,
      });
    }
    saveConversations(conversations);
    if (isNewConversation) {
      logAudit('conversation', 'create', `新增對話「${conv.title || ''}」`);
    }
    broadcastToAllWindows('conversations:changed');
    return conversations;
  });

  ipcMain.handle('conversations:delete', (e, id) => {
    const target = loadConversations().find((c) => c.id === id);
    const conversations = loadConversations().filter((c) => c.id !== id);
    saveConversations(conversations);
    if (target) {
      logAudit('conversation', 'delete', `刪除對話「${target.title || ''}」`);
    }
    broadcastToAllWindows('conversations:changed');
    return conversations;
  });

  // 匯入現成的 Markdown 檔案（例如之前用其他工具匯出的對話紀錄），直接
  // 變成一則新的對話庫項目，檔名（去掉副檔名）當標題、檔案內容整份塞進
  // content，匯入後照樣可以在編輯器裡檢視/編輯、關聯文件庫檔案、重新匯出。
  ipcMain.handle('conversations:importMarkdown', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(conversationsWindow, {
      title: '匯入 Markdown 檔案',
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
      properties: ['openFile', 'multiSelections'],
    });
    if (canceled || filePaths.length === 0) return { conversations: loadConversations(), importedIds: [] };

    const conversations = loadConversations();
    const now = new Date().toISOString();
    const importedIds = [];

    filePaths.forEach((filePath) => {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const title = path.basename(filePath).replace(/\.[^.]+$/, '');
        const id = genId('conv');
        conversations.push({
          id,
          title,
          tags: [],
          content,
          sourceAccountId: null,
          sourcePlatform: null,
          linkedDocumentIds: [],
          createdAt: now,
          updatedAt: now,
        });
        importedIds.push(id);
      } catch (err) {
        logError('conversations:importMarkdown', `匯入 Markdown 檔案失敗: ${filePath}`, err);
      }
    });

    saveConversations(conversations);
    if (importedIds.length > 0) {
      logAudit('conversation', 'importMarkdown', `匯入 ${importedIds.length} 個 Markdown 檔案`);
    }
    broadcastToAllWindows('conversations:changed');
    return { conversations, importedIds };
  });

  // 把目前作用中帳號的畫面擷取成 Markdown，作為「新增對話」的預填內容（不會直接寫檔）
  ipcMain.handle('conversations:captureCurrent', async () => {
    const result = await captureCurrentConversation();
    if (!result || !result.ok) {
      return { ok: false, error: result ? result.error : 'UNKNOWN', debug: result ? result.debug : undefined };
    }
    const currentEntry = activeAccountId ? accountViews.get(activeAccountId) : null;
    return {
      ok: true,
      title: result.title || '',
      content: toMarkdown(result),
      sourceAccountId: activeAccountId,
      sourcePlatform: currentEntry ? currentEntry.platform : null,
    };
  });

  ipcMain.handle('conversations:export', async (e, { id, format }) => exportConversationEntry(id, format));

  // 把對話跟文件庫裡既有的一份文件手動建立關聯（多對多）
  ipcMain.handle('conversations:linkDocument', (e, { conversationId, documentId }) => {
    const conversations = loadConversations();
    const conv = conversations.find((c) => c.id === conversationId);
    if (conv) {
      conv.linkedDocumentIds = Array.isArray(conv.linkedDocumentIds) ? conv.linkedDocumentIds : [];
      if (!conv.linkedDocumentIds.includes(documentId)) conv.linkedDocumentIds.push(documentId);
      conv.updatedAt = new Date().toISOString();
    }
    saveConversations(conversations);
    broadcastToAllWindows('conversations:changed');
    return conversations;
  });

  ipcMain.handle('conversations:unlinkDocument', (e, { conversationId, documentId }) => {
    const conversations = loadConversations();
    const conv = conversations.find((c) => c.id === conversationId);
    if (conv) {
      conv.linkedDocumentIds = (conv.linkedDocumentIds || []).filter((docId) => docId !== documentId);
      conv.updatedAt = new Date().toISOString();
    }
    saveConversations(conversations);
    broadcastToAllWindows('conversations:changed');
    return conversations;
  });

  // --- 日誌主控台（錯誤日誌、稽核日誌） ---
  ipcMain.handle('logs:list', () => loadLogs());

  ipcMain.handle('logs:clear', (e, kind) => {
    clearLogs(kind);
    return loadLogs();
  });

  ipcMain.handle('logs:export', async () => {
    const logs = loadLogs();
    const { canceled, filePath } = await dialog.showSaveDialog(
      logWindow && !logWindow.isDestroyed() ? logWindow : mainWindow,
      {
        title: '匯出日誌',
        defaultPath: `platter-logs-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      }
    );
    if (canceled || !filePath) return { ok: false };
    fs.writeFileSync(filePath, JSON.stringify(logs, null, 2), 'utf-8');
    return { ok: true, filePath };
  });

  // 主控台（Console）：即時 console.log/warn/error 逐行輸出，只存在記憶體
  ipcMain.handle('console:list', () => consoleBuffer);
  ipcMain.handle('console:clear', () => {
    consoleBuffer.length = 0;
    return [];
  });
}

// ---------------------------------------------------------------------------
// App 生命週期
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
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
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
    registerIpcHandlers();
    createMainWindow();
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
