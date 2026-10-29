const fs = require('fs');
const { dialog } = require('electron');
const { loadLogs, clearLogs } = require('../logs');
const state = require('../state');
const { t } = require('../i18n');
const { LOG_EXPORT_KINDS, buildLogExportFileName } = require('../logExport');

// --- 日誌主控台（錯誤日誌、稽核日誌）／主控台（Console）逐行輸出 ---
function registerLogsIpc(ipcMain) {
  ipcMain.handle('logs:list', () => loadLogs());

  ipcMain.handle('logs:clear', (e, kind) => {
    clearLogs(kind);
    return loadLogs();
  });

  // 匯出日誌：依類型分開匯出，檔名帶類型，避免不同類型的檔案混在一起分不清楚。
  //   kind = 'errors'  → platter-errors-YYYY-MM-DD.json   （錯誤日誌）
  //          'audits'  → platter-audits-YYYY-MM-DD.json   （稽核日誌）
  //          'console' → platter-console-YYYY-MM-DD.json  （主控台，只存在記憶體的即時輸出）
  //          'all'     → platter-logs-all-YYYY-MM-DD.json （錯誤＋稽核，舊版行為）
  ipcMain.handle('logs:export', async (e, kind) => {
    const exportKind = LOG_EXPORT_KINDS.includes(kind) ? kind : 'all';
    const exportedAt = new Date();
    let payload;
    if (exportKind === 'all') {
      payload = loadLogs();
    } else {
      const entries =
        exportKind === 'console' ? state.consoleBuffer.slice() : loadLogs()[exportKind];
      payload = {
        type: exportKind,
        exportedAt: exportedAt.toISOString(),
        count: entries.length,
        entries,
      };
    }
    const { canceled, filePath } = await dialog.showSaveDialog(
      state.logWindow && !state.logWindow.isDestroyed()
        ? state.logWindow
        : state.mainWindow,
      {
        title: `${t('main.logs.exportTitle')} - ${t(`main.logs.kind.${exportKind}`)}`,
        defaultPath: buildLogExportFileName(exportKind, exportedAt),
        filters: [{ name: 'JSON', extensions: ['json'] }],
      }
    );
    if (canceled || !filePath) return { ok: false };
    try {
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
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
