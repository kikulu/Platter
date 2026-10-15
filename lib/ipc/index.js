const { registerAccountsIpc } = require('./accounts');
const { registerKnowledgeIpc } = require('./knowledge');
const { registerSettingsIpc } = require('./settings');
const { registerWindowIpc } = require('./windows');
const { registerProjectsIpc } = require('./projects');
const { registerDocumentsIpc } = require('./documents');
const { registerConversationsIpc } = require('./conversations');
const { registerLogsIpc } = require('./logs');
const { registerSearchIpc } = require('./search');
const path = require('path');
const { guardIpc } = require('../security');
const { logError } = require('../logs');

// main.js 原本的 registerIpcHandlers() 拆成這幾個依業務領域分組的檔案，
// 這裡只負責把它們全部註冊起來。頻道命名慣例（namespace:action）、完整
// 頻道清單見 PROJECT_SPEC.md 第 13 節。
//
// 資安（1.42.0）：每個 handler 都先檢查呼叫來源（event.senderFrame.url）必須是
// renderer/ 底下的頁面，不是的話拒絕並寫入錯誤日誌（見 lib/security.js guardIpc）。
function registerIpcHandlers(rawIpcMain) {
  const ipcMain = guardIpc(rawIpcMain, {
    rendererDir: path.join(__dirname, '..', '..', 'renderer'),
    onReject: (channel, event) =>
      logError(
        'security:ipc',
        `已拒絕來源不明的 IPC 呼叫：${channel}（${
          (event && event.senderFrame && event.senderFrame.url) || '無來源'
        }）`
      ),
  });
  registerAccountsIpc(ipcMain);
  registerKnowledgeIpc(ipcMain);
  registerSettingsIpc(ipcMain);
  registerWindowIpc(ipcMain);
  registerProjectsIpc(ipcMain);
  registerDocumentsIpc(ipcMain);
  registerConversationsIpc(ipcMain);
  registerLogsIpc(ipcMain);
  registerSearchIpc(ipcMain);
}

module.exports = { registerIpcHandlers };
