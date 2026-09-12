const fs = require('fs');
const path = require('path');
const { app, dialog, session } = require('electron');
const { deriveSelectorFromSamples } = require('../utils');
const { readJSONSafe } = require('../dataDir');
const {
  saveAppState,
  loadKnowledgeBase,
  saveKnowledgeBase,
  loadSelectors,
  saveSelectors,
  loadProjects,
  saveProjects,
  loadDocuments,
  saveDocuments,
  loadConversations,
  saveConversations,
} = require('../stores');
const { getDataDir, setDataDir, resetDataDir, isDefaultDataDir } = require('../dataDir');
const { createAccountView } = require('../windows');
const { pickSelectorSample } = require('../conversationCapture');
const { logError, logAudit } = require('../logs');
const { broadcastToAllWindows } = require('../broadcast');
const state = require('../state');

// --- 設定：資料目錄 / 擴充功能 / 儲存路徑 / 備份還原 / 選取器 / 疑難排解 ---
function registerSettingsIpc(ipcMain) {
  // --- 資料目錄 ---
  ipcMain.handle('settings:getDataDir', () => ({
    dataDir: getDataDir(),
    isDefault: isDefaultDataDir(),
  }));

  ipcMain.handle('settings:chooseDataDir', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(state.settingsWindow, {
      title: '選擇外部資料夾',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || filePaths.length === 0) return { changed: false };

    const { response } = await dialog.showMessageBox(state.settingsWindow, {
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
    const { response } = await dialog.showMessageBox(state.settingsWindow, {
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

  // --- 擴充功能 ---
  ipcMain.handle('settings:getExtensions', () => state.appState.extensions);

  ipcMain.handle('settings:addExtension', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(state.settingsWindow, {
      title: '選擇已解壓縮的擴充功能資料夾',
      properties: ['openDirectory'],
    });
    if (canceled || filePaths.length === 0) return state.appState.extensions;
    const folder = filePaths[0];
    const manifestPath = path.join(folder, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      dialog.showErrorBox('錯誤', '選擇的資料夾裡找不到 manifest.json');
      return state.appState.extensions;
    }
    const manifest = readJSONSafe(manifestPath, {});
    const ext = {
      id: `ext_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      path: folder,
      name: manifest.name || path.basename(folder),
      version: manifest.version || '',
      enabled: true,
    };
    state.appState.extensions.push(ext);
    saveAppState();
    logAudit('extension', 'add', `安裝擴充功能「${ext.name}」`);
    state.accountViews.forEach((entry) => {
      const ses = entry.view.webContents.session;
      ses.loadExtension(ext.path, { allowFileAccess: true }).catch(() => {});
    });
    return state.appState.extensions;
  });

  ipcMain.handle('settings:toggleExtension', (e, { id, enabled }) => {
    const ext = state.appState.extensions.find((x) => x.id === id);
    if (!ext) return state.appState.extensions;
    ext.enabled = enabled;
    saveAppState();
    state.accountViews.forEach((entry) => {
      const ses = entry.view.webContents.session;
      if (enabled) {
        ses.loadExtension(ext.path, { allowFileAccess: true }).catch(() => {});
      } else {
        const loaded = ses.getAllExtensions().find((x) => x.path === ext.path);
        if (loaded) ses.removeExtension(loaded.id);
      }
    });
    return state.appState.extensions;
  });

  ipcMain.handle('settings:removeExtension', (e, id) => {
    const ext = state.appState.extensions.find((x) => x.id === id);
    if (ext) {
      state.accountViews.forEach((entry) => {
        const ses = entry.view.webContents.session;
        const loaded = ses.getAllExtensions().find((x) => x.path === ext.path);
        if (loaded) ses.removeExtension(loaded.id);
      });
      logAudit('extension', 'remove', `移除擴充功能「${ext.name}」`);
    }
    state.appState.extensions = state.appState.extensions.filter((x) => x.id !== id);
    saveAppState();
    return state.appState.extensions;
  });

  // --- 儲存路徑 ---
  ipcMain.handle('settings:getSavePathConfig', () => ({
    defaultSavePath: state.appState.ui.defaultSavePath || app.getPath('documents'),
    skipSaveDialog: state.appState.ui.skipSaveDialog,
  }));

  ipcMain.handle('settings:chooseDefaultSavePath', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(state.settingsWindow, {
      title: '選擇預設儲存資料夾',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || filePaths.length === 0) return state.appState.ui.defaultSavePath;
    state.appState.ui.defaultSavePath = filePaths[0];
    saveAppState();
    return state.appState.ui.defaultSavePath;
  });

  ipcMain.handle('settings:setSkipSaveDialog', (e, skip) => {
    state.appState.ui.skipSaveDialog = !!skip;
    saveAppState();
    return true;
  });

  // --- 備份與還原 ---
  ipcMain.handle('settings:exportBackup', async () => {
    const backup = {
      version: 1,
      accounts: state.appState.accounts, // 只有 platform/name/id，不含登入資料
      knowledge: loadKnowledgeBase(),
      projects: loadProjects(),
      documents: loadDocuments(),
      conversations: loadConversations(),
      settings: {
        ui: state.appState.ui,
        extensions: state.appState.extensions,
        selectors: loadSelectors(),
        roles: state.appState.roles,
      },
      exportedAt: new Date().toISOString(),
    };
    const { canceled, filePath } = await dialog.showSaveDialog(state.settingsWindow, {
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
    const { canceled, filePaths } = await dialog.showOpenDialog(state.settingsWindow, {
      title: '匯入備份',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (canceled || filePaths.length === 0) return { ok: false };
    const backup = readJSONSafe(filePaths[0], null);
    if (!backup) return { ok: false, error: 'INVALID_FILE' };

    // 帳號：已存在的 id 略過
    const existingIds = new Set(state.appState.accounts.map((a) => a.id));
    (backup.accounts || []).forEach((a) => {
      if (!existingIds.has(a.id)) {
        state.appState.accounts.push(a);
        createAccountView(a);
      }
    });

    // 角色：已存在的 id 略過，不覆蓋使用者後續的編輯
    const backupRoles = (backup.settings && backup.settings.roles) || [];
    const existingRoleIds = new Set(state.appState.roles.map((r) => r.id));
    backupRoles.forEach((r) => {
      if (!existingRoleIds.has(r.id)) state.appState.roles.push(r);
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

  // --- 選取器 ---
  ipcMain.handle('settings:getSelectors', () => loadSelectors());

  ipcMain.handle('settings:saveSelector', (e, { platform, selector }) => {
    const selectors = loadSelectors();
    selectors[platform] = selector;
    saveSelectors(selectors);
    return selectors;
  });

  ipcMain.handle('settings:resetSelector', (e, platform) => {
    const defaults = readJSONSafe(
      path.join(__dirname, '..', '..', 'extractors', 'default-selectors.json'),
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

  // --- 疑難排解 ---
  ipcMain.handle('settings:openCurrentDevTools', () => {
    if (!state.activeAccountId) return false;
    const entry = state.accountViews.get(state.activeAccountId);
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
    state.accountViews.forEach((entry) => sessions.add(entry.view.webContents.session));
    await Promise.all(
      Array.from(sessions).map((ses) =>
        ses.clearCache().catch((err) => logError('settings:clearCache', '清除快取失敗', err))
      )
    );
    logAudit('settings', 'clearCache', `清除快取（含目前開啟的 ${state.accountViews.size} 個帳號）`);
    return true;
  });
}

module.exports = { registerSettingsIpc };
