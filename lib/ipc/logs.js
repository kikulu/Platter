const fs = require('fs');
const { dialog } = require('electron');
const { loadLogs, clearLogs } = require('../logs');
const state = require('../state');

// --- 日誌主控台（錯誤日誌、稽核日誌）／主控台（Console）逐行輸出 ---
function registerLogsIpc(ipcMain) {
  ipcMain.handle('logs:list', () => loadLogs());

  ipcMain.handle('logs:clear', (e, kind) => {
    clearLogs(kind);
    return loadLogs();
  });

  ipcMain.handle('logs:export', async () => {
    const logs = loadLogs();
    const { canceled, filePath } = await dialog.showSaveDialog(
      state.logWindow && !state.logWindow.isDestroyed() ? state.logWindow : state.mainWindow,
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
  ipcMain.handle('console:list', () => state.consoleBuffer);
  ipcMain.handle('console:clear', () => {
    state.consoleBuffer.length = 0;
    return [];
  });
}

module.exports = { registerLogsIpc };
