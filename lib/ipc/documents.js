const fs = require('fs');
const path = require('path');
const { dialog, shell } = require('electron');
const {
  loadDocuments,
  saveDocuments,
  registerDocument,
  documentsDir,
  loadConversations,
  saveConversations,
} = require('../stores');
const { logError, logAudit } = require('../logs');
const { broadcastToAllWindows } = require('../broadcast');
const { markdownToHtml } = require('../utils');
const state = require('../state');

// --- 文件庫（儲存對話中產生的文件或手動匯入的檔案） ---
function docsWithMissingFlag() {
  return loadDocuments().map((d) => ({ ...d, missing: !fs.existsSync(d.filePath) }));
}

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown']);

function registerDocumentsIpc(ipcMain) {
  ipcMain.handle('documents:list', () => docsWithMissingFlag());

  ipcMain.handle('documents:import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(state.documentsWindow, {
      title: '匯入檔案',
      properties: ['openFile', 'multiSelections'],
    });
    if (canceled || filePaths.length === 0) return docsWithMissingFlag();

    fs.mkdirSync(documentsDir(), { recursive: true });
    let importedCount = 0;
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
        importedCount += 1;
      } catch (err) {
        logError('documents:import', `匯入檔案失敗: ${srcPath}`, err);
      }
    });
    if (importedCount > 0) {
      logAudit('document', 'import', `匯入 ${importedCount} 份檔案`);
    }
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
        logError('documents:delete', `刪除檔案失敗: ${doc.filePath}`, err);
      }
    }
    if (doc) {
      logAudit(
        'document',
        'delete',
        `移除文件「${doc.name}」${alsoDeleteFile ? '（含實體檔案）' : ''}`
      );
    }
    const remaining = documents.filter((d) => d.id !== id);
    saveDocuments(remaining);

    // 文件被移除時，對話庫裡引用到這份文件的關聯也一併清掉，避免懸空引用
    const conversations = loadConversations();
    let conversationsChanged = false;
    conversations.forEach((c) => {
      if ((c.linkedDocumentIds || []).includes(id)) {
        c.linkedDocumentIds = c.linkedDocumentIds.filter((docId) => docId !== id);
        conversationsChanged = true;
      }
    });
    if (conversationsChanged) {
      saveConversations(conversations);
      broadcastToAllWindows('conversations:changed');
    }

    broadcastToAllWindows('documents:changed');
    return docsWithMissingFlag();
  });

  ipcMain.handle('documents:openFile', (e, id) => {
    const doc = loadDocuments().find((d) => d.id === id);
    if (!doc || !fs.existsSync(doc.filePath))
      return { ok: false, error: 'FILE_NOT_FOUND' };
    shell.openPath(doc.filePath);
    return { ok: true };
  });

  ipcMain.handle('documents:showInFolder', (e, id) => {
    const doc = loadDocuments().find((d) => d.id === id);
    if (!doc || !fs.existsSync(doc.filePath))
      return { ok: false, error: 'FILE_NOT_FOUND' };
    shell.showItemInFolder(doc.filePath);
    return { ok: true };
  });

  // Markdown 預覽：只接受副檔名是 .md/.markdown 的文件，讀取內容用
  // lib/utils.js 的 markdownToHtml() 轉成 HTML 字串回傳給渲染層直接
  // 插入畫面（見 renderer/documents.js）。刻意在主程序這邊做轉換，而
  // 不是把原始檔案內容整包丟給渲染層自己轉——渲染層沒有 Node 模組可以
  // require（contextIsolation + nodeIntegration:false），而且集中在
  // 這裡轉換，安全性（HTML escape / 連結 scheme 白名單）只需要維護
  // 一個地方。
  ipcMain.handle('documents:getMarkdownPreview', (e, id) => {
    const doc = loadDocuments().find((d) => d.id === id);
    if (!doc) return { ok: false, error: 'NOT_FOUND' };
    if (!fs.existsSync(doc.filePath)) return { ok: false, error: 'FILE_NOT_FOUND' };
    const ext = (path.extname(doc.filePath) || '').replace(/^\./, '').toLowerCase();
    if (!MARKDOWN_EXTENSIONS.has(ext)) return { ok: false, error: 'NOT_MARKDOWN' };
    try {
      const raw = fs.readFileSync(doc.filePath, 'utf-8');
      return { ok: true, html: markdownToHtml(raw) };
    } catch (err) {
      logError(
        'documents:getMarkdownPreview',
        `讀取 Markdown 檔案失敗: ${doc.filePath}`,
        err
      );
      return { ok: false, error: 'READ_FAILED: ' + err.message };
    }
  });
}

module.exports = { registerDocumentsIpc, docsWithMissingFlag };
