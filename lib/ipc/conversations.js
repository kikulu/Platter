const fs = require('fs');
const path = require('path');
const { dialog } = require('electron');
const { genId, toMarkdown } = require('../utils');
const { loadConversations, saveConversations } = require('../stores');
const {
  captureCurrentConversation,
  exportCurrentConversation,
  exportConversationEntry,
} = require('../conversationCapture');
const { logError, logAudit } = require('../logs');
const { broadcastToAllWindows } = require('../broadcast');
const state = require('../state');

// --- 對話庫（新增對話 Markdown、匯出檔案、跟文件庫的檔案互相關聯）／目前對話匯出 ---
function registerConversationsIpc(ipcMain) {
  // 匯出「目前作用中帳號」的對話（側邊欄的匯出按鈕），跟對話庫是兩條不同路徑
  ipcMain.handle('export:current', async (e, format) => {
    return exportCurrentConversation(format);
  });

  ipcMain.handle('conversations:list', () => loadConversations());

  ipcMain.handle('conversations:save', (e, conv) => {
    const conversations = loadConversations();
    const now = new Date().toISOString();
    const isNewConversation = !conv.id;
    const tags = Array.isArray(conv.tags) ? conv.tags : [];
    if (conv.id) {
      const idx = conversations.findIndex((c) => c.id === conv.id);
      if (idx >= 0) {
        // linkedDocumentIds 不是「編輯對話」表單負責的欄位——那是
        // conversations:linkDocument / unlinkDocument 各自獨立維護的，
        // 呼叫端（renderer/conversation.js 的 currentDraft()）本來就不會
        // 帶這個欄位。如果 payload 沒有明確給，一律沿用資料庫裡已經存的
        // 版本，不要預設成空陣列覆蓋掉——不然使用者每次改標題/標籤/內容
        // 按「儲存」，剛建立好的文件關聯就會被清空。
        const linkedDocumentIds = Array.isArray(conv.linkedDocumentIds)
          ? conv.linkedDocumentIds
          : conversations[idx].linkedDocumentIds || [];
        conversations[idx] = {
          ...conversations[idx],
          title: conv.title || '',
          tags,
          content: conv.content || '',
          linkedDocumentIds,
          updatedAt: now,
        };
      } else {
        conversations.push({
          ...conv,
          tags,
          linkedDocumentIds: Array.isArray(conv.linkedDocumentIds)
            ? conv.linkedDocumentIds
            : [],
          createdAt: now,
          updatedAt: now,
        });
      }
    } else {
      conversations.push({
        id: genId('conv'),
        title: conv.title || '',
        tags,
        content: conv.content || '',
        sourceAccountId: conv.sourceAccountId || null,
        sourcePlatform: conv.sourcePlatform || null,
        linkedDocumentIds: [],
        createdAt: now,
        updatedAt: now,
      });
    }
    saveConversations(conversations);
    if (isNewConversation) {
      logAudit('conversation', 'create', `新增對話「${conv.title || ''}」`);
    }
    broadcastToAllWindows('conversations:changed');
    return conversations;
  });

  ipcMain.handle('conversations:delete', (e, id) => {
    const target = loadConversations().find((c) => c.id === id);
    const conversations = loadConversations().filter((c) => c.id !== id);
    saveConversations(conversations);
    if (target) {
      logAudit('conversation', 'delete', `刪除對話「${target.title || ''}」`);
    }
    broadcastToAllWindows('conversations:changed');
    return conversations;
  });

  // 匯入現成的 Markdown 檔案（例如之前用其他工具匯出的對話紀錄），直接
  // 變成一則新的對話庫項目，檔名（去掉副檔名）當標題、檔案內容整份塞進
  // content，匯入後照樣可以在編輯器裡檢視/編輯、關聯文件庫檔案、重新匯出。
  ipcMain.handle('conversations:importMarkdown', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(
      state.conversationsWindow,
      {
        title: '匯入 Markdown 檔案',
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
        properties: ['openFile', 'multiSelections'],
      }
    );
    if (canceled || filePaths.length === 0)
      return { conversations: loadConversations(), importedIds: [] };

    const conversations = loadConversations();
    const now = new Date().toISOString();
    const importedIds = [];

    filePaths.forEach((filePath) => {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const title = path.basename(filePath).replace(/\.[^.]+$/, '');
        const id = genId('conv');
        conversations.push({
          id,
          title,
          tags: [],
          content,
          sourceAccountId: null,
          sourcePlatform: null,
          linkedDocumentIds: [],
          createdAt: now,
          updatedAt: now,
        });
        importedIds.push(id);
      } catch (err) {
        logError(
          'conversations:importMarkdown',
          `匯入 Markdown 檔案失敗: ${filePath}`,
          err
        );
      }
    });

    saveConversations(conversations);
    if (importedIds.length > 0) {
      logAudit(
        'conversation',
        'importMarkdown',
        `匯入 ${importedIds.length} 個 Markdown 檔案`
      );
    }
    broadcastToAllWindows('conversations:changed');
    return { conversations, importedIds };
  });

  // 把目前作用中帳號的畫面擷取成 Markdown，作為「新增對話」的預填內容（不會直接寫檔）
  ipcMain.handle('conversations:captureCurrent', async () => {
    const result = await captureCurrentConversation();
    if (!result || !result.ok) {
      return {
        ok: false,
        error: result ? result.error : 'UNKNOWN',
        debug: result ? result.debug : undefined,
      };
    }
    const currentEntry = state.activeAccountId
      ? state.accountViews.get(state.activeAccountId)
      : null;
    return {
      ok: true,
      title: result.title || '',
      content: toMarkdown(result),
      sourceAccountId: state.activeAccountId,
      sourcePlatform: currentEntry ? currentEntry.platform : null,
    };
  });

  ipcMain.handle('conversations:export', async (e, { id, format }) =>
    exportConversationEntry(id, format)
  );

  // 把對話跟文件庫裡既有的一份文件手動建立關聯（多對多）
  ipcMain.handle('conversations:linkDocument', (e, { conversationId, documentId }) => {
    const conversations = loadConversations();
    const conv = conversations.find((c) => c.id === conversationId);
    if (conv) {
      conv.linkedDocumentIds = Array.isArray(conv.linkedDocumentIds)
        ? conv.linkedDocumentIds
        : [];
      if (!conv.linkedDocumentIds.includes(documentId))
        conv.linkedDocumentIds.push(documentId);
      conv.updatedAt = new Date().toISOString();
    }
    saveConversations(conversations);
    broadcastToAllWindows('conversations:changed');
    return conversations;
  });

  ipcMain.handle('conversations:unlinkDocument', (e, { conversationId, documentId }) => {
    const conversations = loadConversations();
    const conv = conversations.find((c) => c.id === conversationId);
    if (conv) {
      conv.linkedDocumentIds = (conv.linkedDocumentIds || []).filter(
        (docId) => docId !== documentId
      );
      conv.updatedAt = new Date().toISOString();
    }
    saveConversations(conversations);
    broadcastToAllWindows('conversations:changed');
    return conversations;
  });
}

module.exports = { registerConversationsIpc };
