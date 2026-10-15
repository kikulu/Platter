const { app, BrowserWindow, shell } = require('electron');
const { isSafeExternalUrl } = require('../security');
const {
  openAccountWindow,
  openKnowledgeWindow,
  openSettingsWindow,
  openTeamWindow,
  openProjectWindow,
  openDocumentsWindow,
  openConversationsWindow,
  openLogWindow,
  setActiveAccountViewVisible,
  setTrayExpanded,
} = require('../windows');

// --- App 版本號 / 子視窗開啟（側邊欄各按鈕觸發） ---
function registerWindowIpc(ipcMain) {
  ipcMain.handle('app:getVersion', () => app.getVersion());

  // 把網址交給系統瀏覽器／郵件程式開啟（文件庫預覽裡的連結用）。主程序再驗一次：
  // 只接受 http:、https:、mailto:，其他（file:、javascript: …）一律拒絕。
  ipcMain.handle('app:openExternal', async (e, url) => {
    if (!isSafeExternalUrl(url)) return { ok: false, error: 'UNSAFE_URL' };
    try {
      await shell.openExternal(url);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });

  ipcMain.handle('window:openAccountWindow', (e, presetPlatform) => {
    openAccountWindow(presetPlatform);
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
  // 主視窗 index.html 自己的全螢幕遮罩（匯出對話框、命令面板）開啟前/
  // 關閉後呼叫，見 lib/windows.js 的 setActiveAccountViewVisible() 說明。
  ipcMain.handle('window:setActiveAccountViewVisible', (e, visible) => {
    setActiveAccountViewVisible(!!visible);
    return true;
  });
  // 右下角浮動小托盤展開/收起時，實際視窗大小要跟著變（見
  // lib/windows.js 的 openTrayWindow() 說明），不是單純切 CSS class。
  ipcMain.handle('tray:setExpanded', (e, expanded) => {
    setTrayExpanded(expanded);
    return true;
  });
}

module.exports = { registerWindowIpc };
