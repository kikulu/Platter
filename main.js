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
//              startDate, endDate, tasks: [...], createdAt, updatedAt }
//   task:    { id, title, description, assigneeId (帳號 id 或 null),
//              status ('todo'|'doing'|'done'), dueDate, createdAt, updatedAt }
function loadProjects() {
  const loaded = readJSONSafe(projectsPath(), null);
  const projects = loaded && Array.isArray(loaded.projects) ? loaded.projects : [];
  projects.forEach((p) => {
    if (!Array.isArray(p.tasks)) p.tasks = [];
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

// accountId -> { view, platform, name }
const accountViews = new Map();
let activeAccountId = null;

function genId() {
  return `acc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

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
        console.error('載入擴充功能失敗:', ext.path, err);
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

function broadcastToAllWindows(channel, ...args) {
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed()) w.webContents.send(channel, ...args);
  });
}

// ---------------------------------------------------------------------------
// 對話匯出
// ---------------------------------------------------------------------------

function ensureUniqueFilePath(dir, baseName, ext) {
  let candidate = path.join(dir, `${baseName}.${ext}`);
  let counter = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${baseName} (${counter}).${ext}`);
    counter += 1;
  }
  return candidate;
}

function toMarkdown(result) {
  const lines = [`# ${result.title || '對話紀錄'}`, ''];
  result.messages.forEach((m) => {
    const heading = m.role === 'user' ? '### 🧑 使用者' : '### 🤖 AI';
    lines.push(heading, '', m.text, '');
  });
  return lines.join('\n');
}

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
    return result;
  } catch (err) {
    return { ok: false, error: 'EXECUTE_FAILED: ' + err.message };
  }
}

async function exportCurrentConversation(format) {
  const result = await captureCurrentConversation();
  if (!result || !result.ok) {
    return { ok: false, error: result ? result.error : 'UNKNOWN' };
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
  }

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
    return { cancelled: true, error: err.message };
  } finally {
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.restore();
  }
}

function deriveSelectorFromSamples(userSample, aiSample) {
  function buildCandidateSelector(sample) {
    if (sample.attrs && sample.attrs['data-message-author-role'] !== undefined) {
      return '[data-message-author-role]';
    }
    if (sample.id) return `#${CSS.escape ? CSS.escape(sample.id) : sample.id}`;
    if (sample.className) {
      const firstClass = sample.className.split(/\s+/).filter(Boolean)[0];
      if (firstClass) return `.${firstClass}`;
    }
    return sample.tagName || '';
  }

  const userSelector = buildCandidateSelector(userSample);
  const aiSelector = buildCandidateSelector(aiSample);

  const turn =
    userSelector && aiSelector && userSelector !== aiSelector
      ? `${userSelector}, ${aiSelector}`
      : userSelector || aiSelector;

  let userHint = '';
  if (userSample.attrs && userSample.attrs['data-message-author-role'] !== undefined) {
    userHint = userSample.attrs['data-message-author-role'];
  } else {
    const userClasses = (userSample.className || '').split(/\s+/).filter(Boolean);
    const aiClasses = new Set((aiSample.className || '').split(/\s+/).filter(Boolean));
    const uniqueToUser = userClasses.find((c) => !aiClasses.has(c));
    userHint = uniqueToUser || '';
  }

  return { turn, userHint };
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
    broadcastToAllWindows('accounts:changed');
    return account;
  });

  ipcMain.handle('accounts:switch', (e, accountId) => {
    const ok = switchAccount(accountId);
    broadcastToAllWindows('accounts:changed');
    return ok;
  });

  ipcMain.handle('accounts:remove', (e, accountId) => {
    removeAccount(accountId);
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
    app.relaunch();
    app.exit();
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
    app.relaunch();
    app.exit();
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
        projects.push({ tasks: [], ...p });
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

    broadcastToAllWindows('accounts:changed');
    broadcastToAllWindows('knowledge:changed');
    broadcastToAllWindows('documents:changed');
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
    const tasks = Array.isArray(project.tasks)
      ? project.tasks.map((t) => ({
          id: t.id || `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          title: t.title || '',
          description: t.description || '',
          assigneeId: t.assigneeId || null,
          status: t.status || 'todo',
          dueDate: t.dueDate || null,
        }))
      : [];
    if (project.id) {
      const idx = projects.findIndex((p) => p.id === project.id);
      if (idx >= 0) {
        projects[idx] = { ...projects[idx], ...project, tasks, updatedAt: now };
      } else {
        projects.push({ ...project, tasks, createdAt: now, updatedAt: now });
      }
    } else {
      project.id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      project.tasks = tasks;
      project.createdAt = now;
      project.updatedAt = now;
      projects.push(project);
    }
    saveProjects(projects);
    return projects;
  });

  ipcMain.handle('projects:delete', (e, id) => {
    const projects = loadProjects().filter((p) => p.id !== id);
    saveProjects(projects);
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
      } catch (err) {
        console.error('匯入檔案失敗:', srcPath, err);
      }
    });
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
        console.error('刪除檔案失敗:', doc.filePath, err);
      }
    }
    const remaining = documents.filter((d) => d.id !== id);
    saveDocuments(remaining);
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
}

// ---------------------------------------------------------------------------
// App 生命週期
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  loadAppState();
  registerIpcHandlers();
  createMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
