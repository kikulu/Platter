const path = require('path');
const {
  readJSONSafe,
  writeJSONSafe,
  statePath,
  knowledgePath,
  selectorsPath,
  projectsPath,
  documentsMetaPath,
  documentsDir,
  conversationsMetaPath,
} = require('./dataDir');
const { DEFAULT_UI_STATE } = require('./constants');
const { broadcastToAllWindows } = require('./broadcast');
const state = require('./state');

// ---------------------------------------------------------------------------
// 資料層：每種資料一個 JSON 檔（放 DATA_DIR），這裡提供 loadX()/saveX()。
// ---------------------------------------------------------------------------

function loadAppState() {
  const loaded = readJSONSafe(statePath(), null);
  if (loaded) {
    state.appState = {
      accounts: loaded.accounts || [],
      ui: {
        ...DEFAULT_UI_STATE,
        ...(loaded.ui || {}),
        // 深合併 sidebarGroups，避免舊資料檔缺少新群組時整個物件被覆蓋掉
        sidebarGroups: {
          ...DEFAULT_UI_STATE.sidebarGroups,
          ...((loaded.ui && loaded.ui.sidebarGroups) || {}),
        },
      },
      extensions: loaded.extensions || [],
      roles: loaded.roles || [],
    };
  } else {
    state.appState = {
      accounts: [],
      ui: { ...DEFAULT_UI_STATE },
      extensions: [],
      roles: [],
    };
  }
}

function saveAppState() {
  writeJSONSafe(statePath(), state.appState);
}

// 知識庫資料結構：
//   items:  一般提示詞項目，可選擇附帶一份獨立檢核表 checklist，
//     以及一份「角色配置」roleIds（這個提示詞要當成哪些角色的預設提示詞，
//     對應側邊欄「預設提示詞」區塊，會依目前選中帳號的角色列出來）
//     { id, title, content, tags: string[],
//       checklist: [{ id, text, checked }],
//       roleIds: string[],
//       createdAt, updatedAt }
//   groups: 群組順序提示詞套餐，steps 依序引用 items 的 id，
//     每個 step 本身就是「檢核表機制」的一格（追蹤這個步驟是否已使用/完成）
//     { id, title, description, tags: string[],
//       steps: [{ id, itemId, checked }],
//       createdAt, updatedAt }
function loadKnowledgeBase() {
  const loaded = readJSONSafe(knowledgePath(), null);
  if (!loaded) return { items: [], groups: [] };
  // 相容舊版格式（loaded 本身可能只有 items，沒有 groups）
  const items = Array.isArray(loaded.items) ? loaded.items : [];
  const groups = Array.isArray(loaded.groups) ? loaded.groups : [];
  // 補齊舊資料缺少的欄位
  items.forEach((it) => {
    if (!Array.isArray(it.checklist)) it.checklist = [];
    if (!Array.isArray(it.roleIds)) it.roleIds = [];
  });
  return { items, groups };
}

function saveKnowledgeBase(data) {
  writeJSONSafe(knowledgePath(), { items: data.items || [], groups: data.groups || [] });
}

function loadSelectors() {
  let loaded = readJSONSafe(selectorsPath(), null);
  if (!loaded) {
    const defaults = readJSONSafe(
      path.join(__dirname, '..', 'extractors', 'default-selectors.json'),
      {}
    );
    writeJSONSafe(selectorsPath(), defaults);
    loaded = defaults;
  }
  return loaded;
}

function saveSelectors(selectors) {
  writeJSONSafe(selectorsPath(), selectors);
}

// 專案計畫管理：
//   project: { id, name, description, status ('planning'|'active'|'onhold'|'done'),
//              startDate, endDate, tasks: [...], issues: [...], createdAt, updatedAt }
//   task:    { id, title, description, assigneeId (帳號 id 或 null),
//              status ('todo'|'doing'|'done'), startDate, dueDate, createdAt, updatedAt }
//   issue:   { id, title, description, type ('bug'|'feature'|'task'|'improvement'),
//              priority ('low'|'medium'|'high'|'urgent'),
//              status ('open'|'inprogress'|'resolved'|'closed'),
//              assigneeId, dueDate, tags: string[], createdAt, updatedAt }
// 甘特圖、月曆檢視都是前端 (project.js) 純用 tasks/issues 裡的日期欄位即時
// 算出來顯示，不另外存衍生資料。
function loadProjects() {
  const loaded = readJSONSafe(projectsPath(), null);
  const projects = loaded && Array.isArray(loaded.projects) ? loaded.projects : [];
  projects.forEach((p) => {
    if (!Array.isArray(p.tasks)) p.tasks = [];
    if (!Array.isArray(p.issues)) p.issues = [];
  });
  return projects;
}

function saveProjects(projects) {
  writeJSONSafe(projectsPath(), { projects });
}

// 文件管理：儲存對話中產生的文件或手動匯入的檔案
//   doc: { id, name, tags: string[], notes, filePath, originalName,
//          size, managed (bool，true 表示檔案實體複製存在 documentsDir 裡，
//          false 表示只是引用使用者原本存放的路徑，例如匯出對話時產生的檔案),
//          sourceAccountId, sourcePlatform, createdAt }
function loadDocuments() {
  const loaded = readJSONSafe(documentsMetaPath(), null);
  return loaded && Array.isArray(loaded.documents) ? loaded.documents : [];
}

function saveDocuments(documents) {
  writeJSONSafe(documentsMetaPath(), { documents });
}

function registerDocument(meta) {
  const documents = loadDocuments();
  const now = new Date().toISOString();
  documents.push({
    id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tags: [],
    notes: '',
    sourceAccountId: null,
    sourcePlatform: null,
    managed: false,
    createdAt: now,
    ...meta,
  });
  saveDocuments(documents);
  broadcastToAllWindows('documents:changed');
  return documents;
}

// 對話庫：手動建立/擷取的對話 Markdown 內容，可匯出成檔案（自動登記進文件庫），
// 也可以手動跟文件庫既有的文件互相關聯（多對多，存 linkedDocumentIds）。
//   conversation: { id, title, tags: string[], content (markdown),
//                   sourceAccountId, sourcePlatform, linkedDocumentIds: string[],
//                   createdAt, updatedAt }
function loadConversations() {
  const loaded = readJSONSafe(conversationsMetaPath(), null);
  const conversations =
    loaded && Array.isArray(loaded.conversations) ? loaded.conversations : [];
  conversations.forEach((c) => {
    if (!Array.isArray(c.tags)) c.tags = [];
    if (!Array.isArray(c.linkedDocumentIds)) c.linkedDocumentIds = [];
  });
  return conversations;
}

function saveConversations(conversations) {
  writeJSONSafe(conversationsMetaPath(), { conversations });
}

module.exports = {
  loadAppState,
  saveAppState,
  loadKnowledgeBase,
  saveKnowledgeBase,
  loadSelectors,
  saveSelectors,
  loadProjects,
  saveProjects,
  loadDocuments,
  saveDocuments,
  registerDocument,
  documentsDir,
  loadConversations,
  saveConversations,
};
