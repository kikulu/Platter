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
const { getDocxPreviewHtml, saveHtmlAsDocx } = require('../docxEditor');
const {
  getPdfPageCount,
  rotatePdfPage,
  deletePdfPage,
  addWatermarkToPdf,
  mergePdfInto,
  extractPdfPages,
} = require('../pdfEditor');
const state = require('../state');

// --- 文件庫（儲存對話中產生的文件或手動匯入的檔案） ---
function docsWithMissingFlag() {
  return loadDocuments().map((d) => ({ ...d, missing: !fs.existsSync(d.filePath) }));
}

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown']);
const DOCX_EXTENSIONS = new Set(['docx']);
const PDF_EXTENSIONS = new Set(['pdf']);

function extOf(filePath) {
  return (path.extname(filePath) || '').replace(/^\./, '').toLowerCase();
}

// 找出文件、順便驗證副檔名是不是預期的類型，兩個 PDF／DOCX handler
// 群組都要重複做這件事，抽成共用小工具。
function findDocByExt(id, extSet) {
  const doc = loadDocuments().find((d) => d.id === id);
  if (!doc) return { error: 'NOT_FOUND' };
  if (!fs.existsSync(doc.filePath)) return { error: 'FILE_NOT_FOUND' };
  if (!extSet.has(extOf(doc.filePath))) return { error: 'WRONG_TYPE' };
  return { doc };
}

// 檔案異動（PDF 編輯／DOCX 存檔）之後，文件庫裡記的檔案大小要跟著更新，
// 不然「文件資訊」欄位顯示的大小會跟磁碟上的實際檔案不一致。
function refreshDocSize(id) {
  const documents = loadDocuments();
  const doc = documents.find((d) => d.id === id);
  if (doc && fs.existsSync(doc.filePath)) {
    doc.size = fs.statSync(doc.filePath).size;
    saveDocuments(documents);
  }
}

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
    const { doc, error } = findDocByExt(id, MARKDOWN_EXTENSIONS);
    if (error)
      return { ok: false, error: error === 'WRONG_TYPE' ? 'NOT_MARKDOWN' : error };
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

  // --- .docx 預覽／編輯：見 lib/docxEditor.js ---
  // 預覽用 mammoth 轉成 HTML；「編輯」是渲染層把預覽區域切成
  // contenteditable，使用者改完按儲存才會呼叫 documents:saveDocxEdit
  // 把目前畫面上的 HTML 整份重新解析、寫回 .docx（覆蓋原檔）。
  ipcMain.handle('documents:getDocxPreview', async (e, id) => {
    const { doc, error } = findDocByExt(id, DOCX_EXTENSIONS);
    if (error) return { ok: false, error: error === 'WRONG_TYPE' ? 'NOT_DOCX' : error };
    try {
      const { html, hasComplexContent } = await getDocxPreviewHtml(doc.filePath);
      return { ok: true, html, hasComplexContent };
    } catch (err) {
      logError('documents:getDocxPreview', `讀取 .docx 檔案失敗: ${doc.filePath}`, err);
      return { ok: false, error: 'READ_FAILED: ' + err.message };
    }
  });

  ipcMain.handle('documents:saveDocxEdit', async (e, { id, html }) => {
    const { doc, error } = findDocByExt(id, DOCX_EXTENSIONS);
    if (error) return { ok: false, error: error === 'WRONG_TYPE' ? 'NOT_DOCX' : error };
    try {
      await saveHtmlAsDocx(html, doc.filePath);
      refreshDocSize(id);
      logAudit('document', 'edit', `編輯並儲存文件「${doc.name}」`);
      broadcastToAllWindows('documents:changed');
      return { ok: true, docs: docsWithMissingFlag() };
    } catch (err) {
      logError('documents:saveDocxEdit', `寫入 .docx 檔案失敗: ${doc.filePath}`, err);
      return { ok: false, error: 'WRITE_FAILED: ' + err.message };
    }
  });

  // --- .pdf 預覽／編輯：見 lib/pdfEditor.js ---
  // 預覽不在 main process 做任何轉換——直接把檔案原始 bytes 讀出來
  // 傳給渲染層，用本地端 vendor 進來的 pdf.js（renderer/vendor/pdfjs）
  // 在 <canvas> 上畫出每一頁，main process 這邊不需要認識 PDF 內容
  // 長什麼樣子。頁面管理（旋轉/刪除/水印/合併/擷取）才需要 pdf-lib。
  ipcMain.handle('documents:getPdfBytes', (e, id) => {
    const { doc, error } = findDocByExt(id, PDF_EXTENSIONS);
    if (error) return { ok: false, error: error === 'WRONG_TYPE' ? 'NOT_PDF' : error };
    try {
      return { ok: true, data: new Uint8Array(fs.readFileSync(doc.filePath)) };
    } catch (err) {
      logError('documents:getPdfBytes', `讀取 PDF 檔案失敗: ${doc.filePath}`, err);
      return { ok: false, error: 'READ_FAILED: ' + err.message };
    }
  });

  // 底下這幾個 PDF 編輯操作全部直接覆寫原檔、沒有版本歷史／復原，
  // 渲染層在呼叫前都會先跳確認對話框（見 renderer/documents.js）。
  ipcMain.handle('documents:pdfRotatePage', async (e, { id, pageIndex, delta }) => {
    const { doc, error } = findDocByExt(id, PDF_EXTENSIONS);
    if (error) return { ok: false, error: error === 'WRONG_TYPE' ? 'NOT_PDF' : error };
    try {
      await rotatePdfPage(doc.filePath, pageIndex, delta);
      refreshDocSize(id);
      logAudit('document', 'edit', `旋轉文件「${doc.name}」第 ${pageIndex + 1} 頁`);
      broadcastToAllWindows('documents:changed');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('documents:pdfDeletePage', async (e, { id, pageIndex }) => {
    const { doc, error } = findDocByExt(id, PDF_EXTENSIONS);
    if (error) return { ok: false, error: error === 'WRONG_TYPE' ? 'NOT_PDF' : error };
    try {
      await deletePdfPage(doc.filePath, pageIndex);
      refreshDocSize(id);
      logAudit('document', 'edit', `刪除文件「${doc.name}」第 ${pageIndex + 1} 頁`);
      broadcastToAllWindows('documents:changed');
      return { ok: true, pageCount: await getPdfPageCount(doc.filePath) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('documents:pdfAddWatermark', async (e, { id, text }) => {
    const { doc, error } = findDocByExt(id, PDF_EXTENSIONS);
    if (error) return { ok: false, error: error === 'WRONG_TYPE' ? 'NOT_PDF' : error };
    if (!String(text || '').trim()) return { ok: false, error: 'EMPTY_TEXT' };
    try {
      await addWatermarkToPdf(doc.filePath, text.trim());
      refreshDocSize(id);
      logAudit('document', 'edit', `為文件「${doc.name}」加上水印`);
      broadcastToAllWindows('documents:changed');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('documents:pdfMerge', async (e, id) => {
    const { doc, error } = findDocByExt(id, PDF_EXTENSIONS);
    if (error) return { ok: false, error: error === 'WRONG_TYPE' ? 'NOT_PDF' : error };
    const { canceled, filePaths } = await dialog.showOpenDialog(state.documentsWindow, {
      title: '選擇要合併進來的 PDF',
      properties: ['openFile'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || filePaths.length === 0) return { ok: false, error: 'CANCELED' };
    try {
      await mergePdfInto(doc.filePath, filePaths[0]);
      refreshDocSize(id);
      logAudit('document', 'edit', `合併 PDF 到文件「${doc.name}」`);
      broadcastToAllWindows('documents:changed');
      return { ok: true, pageCount: await getPdfPageCount(doc.filePath) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // 擷取頁面範圍是非破壞性操作：不動原檔，存成一份新文件登記進文件庫
  // （見 lib/pdfEditor.js 的 extractPdfPages() 說明）。
  ipcMain.handle('documents:pdfExtractPages', async (e, { id, rangeStr }) => {
    const { doc, error } = findDocByExt(id, PDF_EXTENSIONS);
    if (error) return { ok: false, error: error === 'WRONG_TYPE' ? 'NOT_PDF' : error };
    try {
      const bytes = await extractPdfPages(doc.filePath, rangeStr);
      fs.mkdirSync(documentsDir(), { recursive: true });
      const baseName = path.basename(doc.name, path.extname(doc.name));
      const uniquePrefix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const newName = `${baseName}（擷取）.pdf`;
      const destPath = path.join(documentsDir(), `${uniquePrefix}_${newName}`);
      fs.writeFileSync(destPath, bytes);
      const docs = registerDocument({
        name: newName,
        originalName: newName,
        filePath: destPath,
        size: bytes.length,
        managed: true,
      });
      logAudit('document', 'add', `從「${doc.name}」擷取頁面存成新文件「${newName}」`);
      return { ok: true, docs };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = { registerDocumentsIpc, docsWithMissingFlag };
