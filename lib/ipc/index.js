const { registerAccountsIpc } = require('./accounts');
const { registerKnowledgeIpc } = require('./knowledge');
const { registerSettingsIpc } = require('./settings');
const { registerWindowIpc } = require('./windows');
const { registerProjectsIpc } = require('./projects');
const { registerDocumentsIpc } = require('./documents');
const { registerConversationsIpc } = require('./conversations');
const { registerLogsIpc } = require('./logs');

// main.js 原本的 registerIpcHandlers() 拆成這幾個依業務領域分組的檔案，
// 這裡只負責把它們全部註冊起來。頻道命名慣例（namespace:action）、完整
// 頻道清單見 PROJECT_SPEC.md 第 13 節。
function registerIpcHandlers(ipcMain) {
  registerAccountsIpc(ipcMain);
  registerKnowledgeIpc(ipcMain);
  registerSettingsIpc(ipcMain);
  registerWindowIpc(ipcMain);
  registerProjectsIpc(ipcMain);
  registerDocumentsIpc(ipcMain);
  registerConversationsIpc(ipcMain);
  registerLogsIpc(ipcMain);
}

module.exports = { registerIpcHandlers };
