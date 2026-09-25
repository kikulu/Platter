const { app, BrowserWindow } = require('electron');
const {
  openAccountWindow,
  openKnowledgeWindow,
  openSettingsWindow,
  openTeamWindow,
  openProjectWindow,
  openDocumentsWindow,
  openConversationsWindow,
  openLogWindow,
} = require('../windows');

// --- App 版本號 / 子視窗開啟（側邊欄各按鈕觸發） ---
function registerWindowIpc(ipcMain) {
  ipcMain.handle('app:getVersion', () => app.getVersion());

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
}

module.exports = { registerWindowIpc };
