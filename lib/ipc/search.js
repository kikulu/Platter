const {
  loadKnowledgeBase,
  loadDocuments,
  loadConversations,
  loadProjects,
} = require('../stores');
const {
  openKnowledgeWindow,
  openDocumentsWindow,
  openConversationsWindow,
  openProjectWindow,
} = require('../windows');
const state = require('../state');

// ---------------------------------------------------------------------------
// 跨模組快速搜尋（命令面板）
//
// 一次搜尋橫跨知識庫／文件庫／對話庫／專案（含任務/issue），回傳統一
// 格式的結果清單，點選後由 search:jumpTo 負責「開啟正確的視窗＋跳到
// 正確的項目」。
//
// 「跳到項目」用的是主動拉取（pull）而不是單純推送（push）：search:jumpTo
// 把要選的項目存進 state.pendingSelections[windowKey]，目標視窗不管是
// 剛開啟（load 完成後主動呼叫 search:consumePendingSelection 拉一次，
// 見各 renderer 初始化流程）還是已經開著（同時也監聽 search:select 這個
// 即時事件），兩條路徑都能收到，不需要處理「視窗還沒 load 完成，訊息就
// 送到了會收不到」這種 race condition。
// ---------------------------------------------------------------------------

const RESULT_LIMIT = 30;

function matches(text, query) {
  return String(text || '')
    .toLowerCase()
    .includes(query);
}

function tagsMatch(tags, query) {
  return (tags || []).some((t) => matches(t, query));
}

function searchGlobal(query) {
  const q = String(query || '')
    .trim()
    .toLowerCase();
  if (!q) return [];

  const results = [];

  const kb = loadKnowledgeBase();
  kb.items.forEach((it) => {
    // 有系統／使用者提示詞拆分欄位的項目（例如企業角色範本），全文搜尋
    // 也要能比對到這兩個欄位，不然只填 systemPrompt／userPrompt、沒填
    // content 的項目會完全搜不到。
    if (
      matches(it.title, q) ||
      matches(it.content, q) ||
      matches(it.systemPrompt, q) ||
      matches(it.userPrompt, q) ||
      tagsMatch(it.tags, q)
    ) {
      const snippetSource = it.content || it.systemPrompt || it.userPrompt || '';
      results.push({
        kind: 'knowledge-item',
        id: it.id,
        title: it.title || '(未命名)',
        snippet: snippetSource.slice(0, 80),
        open: { windowKey: 'knowledge', id: it.id, tab: 'items' },
      });
    }
  });
  kb.groups.forEach((g) => {
    // 分階段套餐也比對階段名稱（例如搜「投稿」找到含「階段 3：潤色與投稿」的套餐）
    if (
      matches(g.title, q) ||
      matches(g.description, q) ||
      tagsMatch(g.tags, q) ||
      (g.steps || []).some((s) => matches(s.stage, q))
    ) {
      results.push({
        kind: 'knowledge-group',
        id: g.id,
        title: g.title || '(未命名套餐)',
        snippet: g.description || '',
        open: { windowKey: 'knowledge', id: g.id, tab: 'groups' },
      });
    }
  });

  loadDocuments().forEach((d) => {
    if (matches(d.name, q) || tagsMatch(d.tags, q) || matches(d.notes, q)) {
      results.push({
        kind: 'document',
        id: d.id,
        title: d.name || '',
        snippet: d.notes || '',
        open: { windowKey: 'documents', id: d.id },
      });
    }
  });

  loadConversations().forEach((c) => {
    if (matches(c.title, q) || matches(c.content, q) || tagsMatch(c.tags, q)) {
      results.push({
        kind: 'conversation',
        id: c.id,
        title: c.title || '',
        snippet: (c.content || '').slice(0, 80),
        open: { windowKey: 'conversations', id: c.id },
      });
    }
  });

  loadProjects().forEach((p) => {
    // 從範本建立的專案也比對專案主題（workflow.topic）
    if (
      matches(p.name, q) ||
      matches(p.description, q) ||
      (p.workflow && matches(p.workflow.topic, q))
    ) {
      results.push({
        kind: 'project',
        id: p.id,
        title: p.name || '',
        snippet: p.description || '',
        open: { windowKey: 'projects', id: p.id, tab: 'tasks' },
      });
    }
    (p.tasks || []).forEach((t) => {
      if (matches(t.title, q) || matches(t.description, q)) {
        results.push({
          kind: 'task',
          id: t.id,
          title: t.title || '',
          snippet: p.name || '',
          open: { windowKey: 'projects', id: p.id, tab: 'tasks' },
        });
      }
    });
    (p.issues || []).forEach((i) => {
      if (matches(i.title, q) || matches(i.description, q) || tagsMatch(i.tags, q)) {
        results.push({
          kind: 'issue',
          id: i.id,
          title: i.title || '',
          snippet: p.name || '',
          open: { windowKey: 'projects', id: p.id, tab: 'issues' },
        });
      }
    });
  });

  return results.slice(0, RESULT_LIMIT);
}

const WINDOW_OPENERS = {
  knowledge: openKnowledgeWindow,
  documents: openDocumentsWindow,
  conversations: openConversationsWindow,
  projects: openProjectWindow,
};

const WINDOW_STATE_KEY = {
  knowledge: 'knowledgeWindow',
  documents: 'documentsWindow',
  conversations: 'conversationsWindow',
  projects: 'projectWindow',
};

function registerSearchIpc(ipcMain) {
  ipcMain.handle('search:global', (e, query) => searchGlobal(query));

  ipcMain.handle('search:jumpTo', (e, { windowKey, id, tab }) => {
    const opener = WINDOW_OPENERS[windowKey];
    if (!opener) return false;

    const stateKey = WINDOW_STATE_KEY[windowKey];
    const existing = state[stateKey];
    const alreadyOpenAndReady =
      existing && !existing.isDestroyed() && !existing.webContents.isLoading();

    state.pendingSelections[windowKey] = { id, tab };
    const win = opener(); // 已開啟就是 focus 現有視窗，沒開就新建（見 lib/windows.js 的 openChildWindow）

    if (alreadyOpenAndReady) {
      // 視窗已經開著、已經 load 完成：不會再走「初始化時拉取 pending
      // selection」那條路徑，直接推一個即時事件過去。
      win.webContents.send('search:select', { id, tab });
    }
    // 如果是剛建立的新視窗，讓它自己 load 完成、初始化流程跑到一半時
    // 主動呼叫 search:consumePendingSelection 拉取，這裡不用 send（送了
    // 它也還沒開始監聽，會收不到）。

    return true;
  });

  ipcMain.handle('search:consumePendingSelection', (e, windowKey) => {
    const pending = state.pendingSelections[windowKey] || null;
    delete state.pendingSelections[windowKey];
    return pending;
  });
}

module.exports = { registerSearchIpc, searchGlobal };
