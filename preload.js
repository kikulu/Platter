const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('workspaceAPI', {
  // 帳號
  listAccounts: () => ipcRenderer.invoke('accounts:list'),
  addAccount: (platform, name, roleId) =>
    ipcRenderer.invoke('accounts:add', { platform, name, roleId }),
  switchAccount: (id) => ipcRenderer.invoke('accounts:switch', id),
  removeAccount: (id) => ipcRenderer.invoke('accounts:remove', id),
  setSidebarCollapsed: (collapsed) =>
    ipcRenderer.invoke('accounts:setSidebarCollapsed', collapsed),
  setGroupExpanded: (key, expanded) =>
    ipcRenderer.invoke('ui:setGroupExpanded', { key, expanded }),
  setAccountRole: (accountId, roleId) =>
    ipcRenderer.invoke('accounts:setRole', { accountId, roleId }),
  reorderAccounts: (orderedIds) => ipcRenderer.invoke('accounts:reorder', orderedIds),
  onAccountsChanged: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('accounts:changed', handler);
    return () => ipcRenderer.removeListener('accounts:changed', handler);
  },

  // 帳號角色機制
  listRoles: () => ipcRenderer.invoke('roles:list'),
  saveRole: (role) => ipcRenderer.invoke('roles:save', role),
  deleteRole: (id) => ipcRenderer.invoke('roles:delete', id),

  // UI / 語言
  getUIState: () => ipcRenderer.invoke('ui:getState'),
  setLanguage: (lang) => ipcRenderer.invoke('ui:setLanguage', lang),
  onLanguageChanged: (cb) => {
    const handler = (e, lang) => cb(lang);
    ipcRenderer.on('language:changed', handler);
    return () => ipcRenderer.removeListener('language:changed', handler);
  },

  // 匯出對話
  exportCurrentConversation: (format) => ipcRenderer.invoke('export:current', format),

  // 知識庫：提示詞項目
  listKnowledge: () => ipcRenderer.invoke('knowledge:list'),
  saveKnowledge: (item) => ipcRenderer.invoke('knowledge:save', item),
  deleteKnowledge: (id) => ipcRenderer.invoke('knowledge:delete', id),
  exportAllKnowledge: (format) => ipcRenderer.invoke('knowledge:exportAll', format),
  importKnowledge: () => ipcRenderer.invoke('knowledge:import'),
  importKnowledgeMarkdown: () => ipcRenderer.invoke('knowledge:importMarkdown'),
  toggleChecklistEntry: (itemId, entryId, checked) =>
    ipcRenderer.invoke('knowledge:toggleChecklistEntry', { itemId, entryId, checked }),
  onKnowledgeChanged: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('knowledge:changed', handler);
    return () => ipcRenderer.removeListener('knowledge:changed', handler);
  },

  // 知識庫：群組順序提示詞套餐
  saveKnowledgeGroup: (group) => ipcRenderer.invoke('knowledge:group:save', group),
  deleteKnowledgeGroup: (id) => ipcRenderer.invoke('knowledge:group:delete', id),
  toggleGroupStep: (groupId, stepId, checked) =>
    ipcRenderer.invoke('knowledge:group:toggleStep', { groupId, stepId, checked }),
  resetGroupChecklist: (groupId) =>
    ipcRenderer.invoke('knowledge:group:resetChecklist', groupId),

  // 設定：資料目錄
  getDataDir: () => ipcRenderer.invoke('settings:getDataDir'),
  chooseDataDir: () => ipcRenderer.invoke('settings:chooseDataDir'),
  resetDataDir: () => ipcRenderer.invoke('settings:resetDataDir'),

  // 設定：擴充功能
  getExtensions: () => ipcRenderer.invoke('settings:getExtensions'),
  addExtension: () => ipcRenderer.invoke('settings:addExtension'),
  toggleExtension: (id, enabled) =>
    ipcRenderer.invoke('settings:toggleExtension', { id, enabled }),
  removeExtension: (id) => ipcRenderer.invoke('settings:removeExtension', id),

  // 設定：儲存路徑
  getSavePathConfig: () => ipcRenderer.invoke('settings:getSavePathConfig'),
  chooseDefaultSavePath: () => ipcRenderer.invoke('settings:chooseDefaultSavePath'),
  setSkipSaveDialog: (skip) => ipcRenderer.invoke('settings:setSkipSaveDialog', skip),

  // 設定：備份與還原
  exportBackup: () => ipcRenderer.invoke('settings:exportBackup'),
  importBackup: () => ipcRenderer.invoke('settings:importBackup'),

  // 設定：選擇器
  getSelectors: () => ipcRenderer.invoke('settings:getSelectors'),
  saveSelector: (platform, selector) =>
    ipcRenderer.invoke('settings:saveSelector', { platform, selector }),
  resetSelector: (platform) => ipcRenderer.invoke('settings:resetSelector', platform),
  pickUserSample: () => ipcRenderer.invoke('settings:pickUserSample'),
  pickAiSample: () => ipcRenderer.invoke('settings:pickAiSample'),
  deriveSelector: (userSample, aiSample) =>
    ipcRenderer.invoke('settings:deriveSelector', { userSample, aiSample }),
  testCaptureSelector: (platform, selector) =>
    ipcRenderer.invoke('settings:testCaptureSelector', { platform, selector }),

  // 設定：疑難排解
  openCurrentDevTools: () => ipcRenderer.invoke('settings:openCurrentDevTools'),
  clearAppCache: () => ipcRenderer.invoke('settings:clearCache'),

  // 子視窗
  openAccountWindow: () => ipcRenderer.invoke('window:openAccountWindow'),
  openKnowledgeWindow: () => ipcRenderer.invoke('window:openKnowledgeWindow'),
  openSettingsWindow: () => ipcRenderer.invoke('window:openSettingsWindow'),
  openTeamWindow: () => ipcRenderer.invoke('window:openTeamWindow'),
  openProjectWindow: () => ipcRenderer.invoke('window:openProjectWindow'),
  openDocumentsWindow: () => ipcRenderer.invoke('window:openDocumentsWindow'),
  openConversationsWindow: () => ipcRenderer.invoke('window:openConversationsWindow'),
  openLogWindow: () => ipcRenderer.invoke('window:openLogWindow'),
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  closeSelf: () => ipcRenderer.invoke('window:closeSelf'),

  // 專案計畫管理
  listProjects: () => ipcRenderer.invoke('projects:list'),
  saveProject: (project) => ipcRenderer.invoke('projects:save', project),
  deleteProject: (id) => ipcRenderer.invoke('projects:delete', id),
  setTaskStatus: (projectId, taskId, status) =>
    ipcRenderer.invoke('projects:task:setStatus', { projectId, taskId, status }),
  setIssueStatus: (projectId, issueId, status) =>
    ipcRenderer.invoke('projects:issue:setStatus', { projectId, issueId, status }),

  // 文件管理
  listDocuments: () => ipcRenderer.invoke('documents:list'),
  importDocuments: () => ipcRenderer.invoke('documents:import'),
  saveDocument: (id, name, tags, notes) =>
    ipcRenderer.invoke('documents:save', { id, name, tags, notes }),
  deleteDocument: (id, alsoDeleteFile) =>
    ipcRenderer.invoke('documents:delete', { id, alsoDeleteFile }),
  openDocumentFile: (id) => ipcRenderer.invoke('documents:openFile', id),
  showDocumentInFolder: (id) => ipcRenderer.invoke('documents:showInFolder', id),
  onDocumentsChanged: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('documents:changed', handler);
    return () => ipcRenderer.removeListener('documents:changed', handler);
  },

  // 對話庫（新增對話 Markdown、匯出檔案、跟文件庫的檔案互相關聯）
  listConversations: () => ipcRenderer.invoke('conversations:list'),
  saveConversation: (conv) => ipcRenderer.invoke('conversations:save', conv),
  deleteConversation: (id) => ipcRenderer.invoke('conversations:delete', id),
  importConversationMarkdown: () => ipcRenderer.invoke('conversations:importMarkdown'),
  captureCurrentConversationDraft: () =>
    ipcRenderer.invoke('conversations:captureCurrent'),
  exportConversation: (id, format) =>
    ipcRenderer.invoke('conversations:export', { id, format }),
  linkConversationDocument: (conversationId, documentId) =>
    ipcRenderer.invoke('conversations:linkDocument', { conversationId, documentId }),
  unlinkConversationDocument: (conversationId, documentId) =>
    ipcRenderer.invoke('conversations:unlinkDocument', { conversationId, documentId }),
  onConversationsChanged: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('conversations:changed', handler);
    return () => ipcRenderer.removeListener('conversations:changed', handler);
  },

  // 日誌主控台（錯誤日誌、稽核日誌）
  listLogs: () => ipcRenderer.invoke('logs:list'),
  clearLogs: (kind) => ipcRenderer.invoke('logs:clear', kind),
  exportLogs: () => ipcRenderer.invoke('logs:export'),
  onLogsChanged: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('logs:changed', handler);
    return () => ipcRenderer.removeListener('logs:changed', handler);
  },

  // 主控台（Console）：即時 console 逐行輸出
  listConsole: () => ipcRenderer.invoke('console:list'),
  clearConsole: () => ipcRenderer.invoke('console:clear'),
  onConsoleEntry: (cb) => {
    const handler = (e, entry) => cb(entry);
    ipcRenderer.on('console:entry', handler);
    return () => ipcRenderer.removeListener('console:entry', handler);
  },
});
