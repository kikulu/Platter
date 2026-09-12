const fs = require('fs');
const path = require('path');
const { app, dialog } = require('electron');
const { ensureUniqueFilePath, toMarkdown } = require('./utils');
const state = require('./state');
const { loadSelectors, registerDocument, loadConversations, saveConversations } = require('./stores');
const { logError, logAudit } = require('./logs');
const { broadcastToAllWindows } = require('./broadcast');

// ---------------------------------------------------------------------------
// 對話匯出
// ---------------------------------------------------------------------------

async function captureCurrentConversation() {
  if (!state.activeAccountId) return { ok: false, error: 'NO_ACTIVE_ACCOUNT' };
  const entry = state.accountViews.get(state.activeAccountId);
  if (!entry) return { ok: false, error: 'NO_ACTIVE_ACCOUNT' };

  const selectors = loadSelectors();
  const selectorConfig = selectors[entry.platform] || {};
  const domCaptureSrc = fs.readFileSync(
    path.join(__dirname, '..', 'extractors', 'domCapture.js'),
    'utf-8'
  );
  const script = `${domCaptureSrc}\ncapturePlatformConversation(${JSON.stringify(
    entry.platform
  )}, ${JSON.stringify(selectorConfig)});`;

  try {
    const result = await entry.view.webContents.executeJavaScript(script);
    const debug = result && result.debug;
    console.log(
      `[conversation:capture] platform=${entry.platform} ok=${result ? result.ok : false} ` +
        `matchedNodes=${debug ? debug.matchedNodeCount : '?'} nonEmptyMessages=${
          debug ? debug.nonEmptyMessageCount : '?'
        } selector="${debug ? debug.selectorUsed : selectorConfig.turn || '(未設定)'}" ` +
        `error=${result && result.error ? result.error : 'none'}`
    );
    if (!result || !result.ok) {
      logError(
        'conversation:capture',
        `擷取對話失敗 (${entry.platform}): ${result ? result.error : 'UNKNOWN'}` +
          (debug ? `，符合 selector 的節點數=${debug.matchedNodeCount}，有內容的訊息數=${debug.nonEmptyMessageCount}` : '')
      );
    }
    return result;
  } catch (err) {
    logError('conversation:capture', `擷取對話失敗 (${entry.platform})`, err);
    return { ok: false, error: 'EXECUTE_FAILED: ' + err.message };
  }
}

async function exportCurrentConversation(format) {
  const result = await captureCurrentConversation();
  if (!result || !result.ok) {
    // captureCurrentConversation() 內部已經記過詳細的 logError，這裡不重複記錄，
    // 只把「使用者當下按了匯出，但因為擷取失敗所以整個匯出動作沒有成功」這件
    // 事實補記一筆稽核紀錄，方便回頭對照時間點。
    logAudit('conversation', 'exportFailed', `匯出當前對話失敗：${result ? result.error : 'UNKNOWN'}`);
    return { ok: false, error: result ? result.error : 'UNKNOWN', debug: result ? result.debug : undefined };
  }

  const ext = format === 'json' ? 'json' : 'md';
  const content =
    format === 'json' ? JSON.stringify(result, null, 2) : toMarkdown(result);
  const baseName = (result.title || 'conversation').replace(/[\\/:*?"<>|]/g, '_');

  const defaultDir = state.appState.ui.defaultSavePath || app.getPath('documents');
  const currentEntry = state.activeAccountId ? state.accountViews.get(state.activeAccountId) : null;

  function registerExportedFile(filePath) {
    let size = 0;
    try {
      size = fs.statSync(filePath).size;
    } catch (err) {
      // 忽略，size 只是附加資訊
    }
    registerDocument({
      name: path.basename(filePath),
      originalName: path.basename(filePath),
      filePath,
      size,
      managed: false, // 檔案留在使用者選擇/預設的儲存位置，文件庫只是登記引用
      sourceAccountId: state.activeAccountId,
      sourcePlatform: currentEntry ? currentEntry.platform : null,
      tags: currentEntry ? [currentEntry.platform] : [],
    });
    logAudit(
      'conversation',
      'export',
      `匯出目前對話「${result.title || ''}」(${currentEntry ? currentEntry.platform : '未知平台'}) 至：${filePath}`
    );
  }

  try {
    if (state.appState.ui.skipSaveDialog) {
      const filePath = ensureUniqueFilePath(defaultDir, baseName, ext);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, 'utf-8');
      registerExportedFile(filePath);
      return { ok: true, filePath };
    }

    const { canceled, filePath } = await dialog.showSaveDialog(state.mainWindow, {
      title: '匯出對話',
      defaultPath: path.join(defaultDir, `${baseName}.${ext}`),
      filters:
        format === 'json'
          ? [{ name: 'JSON', extensions: ['json'] }]
          : [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (canceled || !filePath) return { ok: false, error: 'CANCELLED' };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
    registerExportedFile(filePath);
    return { ok: true, filePath };
  } catch (err) {
    logError('conversation:export', '寫入匯出檔案失敗', err);
    return { ok: false, error: 'WRITE_FAILED: ' + err.message };
  }
}

// ---------------------------------------------------------------------------
// 對話庫：把庫裡的一則對話匯出成檔案，並自動登記進文件庫、跟這則對話互相關聯
// ---------------------------------------------------------------------------

async function exportConversationEntry(id, format) {
  const conversations = loadConversations();
  const conv = conversations.find((c) => c.id === id);
  if (!conv) return { ok: false, error: 'NOT_FOUND' };

  const ext = format === 'json' ? 'json' : 'md';
  const content =
    format === 'json'
      ? JSON.stringify(
          { title: conv.title, tags: conv.tags, content: conv.content },
          null,
          2
        )
      : conv.content || '';
  const baseName = (conv.title || 'conversation').replace(/[\\/:*?"<>|]/g, '_');
  const defaultDir = state.appState.ui.defaultSavePath || app.getPath('documents');

  let filePath;
  if (state.appState.ui.skipSaveDialog) {
    filePath = ensureUniqueFilePath(defaultDir, baseName, ext);
  } else {
    const parentWin =
      state.conversationsWindow && !state.conversationsWindow.isDestroyed()
        ? state.conversationsWindow
        : state.mainWindow;
    const result = await dialog.showSaveDialog(parentWin, {
      title: '匯出對話',
      defaultPath: path.join(defaultDir, `${baseName}.${ext}`),
      filters:
        format === 'json'
          ? [{ name: 'JSON', extensions: ['json'] }]
          : [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, error: 'CANCELLED' };
    filePath = result.filePath;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
  } catch (err) {
    logError('conversation:export', `寫入匯出檔案失敗: ${filePath}`, err);
    return { ok: false, error: 'WRITE_FAILED: ' + err.message };
  }

  let size = 0;
  try {
    size = fs.statSync(filePath).size;
  } catch (err) {
    // 忽略，size 只是附加資訊
  }

  // 自動登記進文件庫（只記錄路徑引用，不複製），並跟來源對話互相關聯
  const documents = registerDocument({
    name: path.basename(filePath),
    originalName: path.basename(filePath),
    filePath,
    size,
    managed: false,
    sourceAccountId: conv.sourceAccountId || null,
    sourcePlatform: conv.sourcePlatform || null,
    tags: conv.tags && conv.tags.length ? conv.tags : ['對話庫'],
  });
  const newDoc = documents[documents.length - 1];

  conv.linkedDocumentIds = Array.isArray(conv.linkedDocumentIds) ? conv.linkedDocumentIds : [];
  if (newDoc && !conv.linkedDocumentIds.includes(newDoc.id)) {
    conv.linkedDocumentIds.push(newDoc.id);
  }
  conv.updatedAt = new Date().toISOString();
  saveConversations(conversations);
  broadcastToAllWindows('conversations:changed');
  logAudit('conversation', 'export', `匯出對話「${conv.title || ''}」為 ${filePath}`);

  return { ok: true, filePath, documentId: newDoc ? newDoc.id : null };
}

// ---------------------------------------------------------------------------
// 選取器工具（滑鼠選取範例訊息）
// ---------------------------------------------------------------------------

async function pickSelectorSample() {
  if (!state.activeAccountId) return { cancelled: true, error: 'NO_ACTIVE_ACCOUNT' };
  const entry = state.accountViews.get(state.activeAccountId);
  if (!entry) return { cancelled: true, error: 'NO_ACTIVE_ACCOUNT' };

  if (state.settingsWindow && !state.settingsWindow.isDestroyed()) state.settingsWindow.minimize();
  if (state.mainWindow) {
    state.mainWindow.show();
    state.mainWindow.focus();
  }

  const pickerSrc = fs.readFileSync(
    path.join(__dirname, '..', 'extractors', 'selectorPicker.js'),
    'utf-8'
  );

  try {
    const result = await entry.view.webContents.executeJavaScript(pickerSrc);
    return result;
  } catch (err) {
    logError('selector:pick', '選取器工具擷取失敗', err);
    return { cancelled: true, error: err.message };
  } finally {
    if (state.settingsWindow && !state.settingsWindow.isDestroyed()) state.settingsWindow.restore();
  }
}

module.exports = {
  captureCurrentConversation,
  exportCurrentConversation,
  exportConversationEntry,
  pickSelectorSample,
};
