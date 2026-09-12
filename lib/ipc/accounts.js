const state = require('../state');
const { saveAppState, loadKnowledgeBase, saveKnowledgeBase } = require('../stores');
const {
  addAccount,
  removeAccount,
  switchAccount,
  layoutActiveView,
} = require('../windows');
const { logAudit } = require('../logs');
const { broadcastToAllWindows } = require('../broadcast');

// --- 帳號 / 帳號角色 / UI 狀態 ---
function registerAccountsIpc(ipcMain) {
  ipcMain.handle('accounts:list', () => {
    return state.appState.accounts.map((a) => ({
      ...a,
      active: a.id === state.activeAccountId,
    }));
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
    const account = state.appState.accounts.find((a) => a.id === accountId);
    removeAccount(accountId);
    if (account) {
      logAudit('account', 'remove', `移除帳號「${account.name}」(${account.platform})`);
    }
    broadcastToAllWindows('accounts:changed');
    return true;
  });

  ipcMain.handle('accounts:setSidebarCollapsed', (e, collapsed) => {
    state.appState.ui.sidebarCollapsed = !!collapsed;
    saveAppState();
    layoutActiveView();
    return true;
  });

  // 側邊欄多層清單：記住每個群組的展開/收合狀態
  ipcMain.handle('ui:setGroupExpanded', (e, { key, expanded }) => {
    state.appState.ui.sidebarGroups[key] = !!expanded;
    saveAppState();
    return true;
  });

  // 帳號角色機制：把某個角色指派給帳號（roleId 可為 null，代表移除角色）
  ipcMain.handle('accounts:setRole', (e, { accountId, roleId }) => {
    const account = state.appState.accounts.find((a) => a.id === accountId);
    if (account) account.roleId = roleId || null;
    saveAppState();
    broadcastToAllWindows('accounts:changed');
    return state.appState.accounts.map((a) => ({
      ...a,
      active: a.id === state.activeAccountId,
    }));
  });

  // 帳號清單拖曳排序：orderedIds 是拖完之後前端算好的新順序（完整帳號 id
  // 清單）。用 Map 查表重組陣列，順便防呆——萬一傳進來的清單漏了某個
  // 帳號（理論上不該發生，但別讓一次前端邏輯失誤就憑空搞丟帳號），把
  // 沒對到的帳號照原順序接在最後面，不要整個報錯或遺失資料。
  ipcMain.handle('accounts:reorder', (e, orderedIds) => {
    const byId = new Map(state.appState.accounts.map((a) => [a.id, a]));
    const reordered = [];
    orderedIds.forEach((id) => {
      const account = byId.get(id);
      if (account && !reordered.includes(account)) reordered.push(account);
    });
    state.appState.accounts.forEach((a) => {
      if (!reordered.includes(a)) reordered.push(a);
    });
    state.appState.accounts = reordered;
    saveAppState();
    broadcastToAllWindows('accounts:changed');
    return state.appState.accounts.map((a) => ({
      ...a,
      active: a.id === state.activeAccountId,
    }));
  });

  // --- 帳號角色管理（角色是可重複套用到多個帳號的共用定義） ---
  ipcMain.handle('roles:list', () => state.appState.roles);

  ipcMain.handle('roles:save', (e, role) => {
    const now = new Date().toISOString();
    if (role.id) {
      const idx = state.appState.roles.findIndex((r) => r.id === role.id);
      if (idx >= 0) {
        state.appState.roles[idx] = {
          ...state.appState.roles[idx],
          ...role,
          updatedAt: now,
        };
      } else {
        state.appState.roles.push({ ...role, createdAt: now, updatedAt: now });
      }
    } else {
      role.id = `role_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      role.createdAt = now;
      role.updatedAt = now;
      state.appState.roles.push(role);
    }
    saveAppState();
    broadcastToAllWindows('accounts:changed');
    return state.appState.roles;
  });

  ipcMain.handle('roles:delete', (e, id) => {
    state.appState.roles = state.appState.roles.filter((r) => r.id !== id);
    // 角色被刪除後，原本套用這個角色的帳號改回「無角色」，不留下懸空引用
    state.appState.accounts.forEach((a) => {
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
    return state.appState.roles;
  });

  // --- UI 狀態 / 語言 ---
  ipcMain.handle('ui:getState', () => state.appState.ui);

  ipcMain.handle('ui:setLanguage', (e, lang) => {
    state.appState.ui.language = lang;
    saveAppState();
    broadcastToAllWindows('language:changed', lang);
    return true;
  });
}

module.exports = { registerAccountsIpc };
