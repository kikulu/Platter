const path = require('path');
const { genId } = require('./utils');
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
    // state.json 完全不存在（全新安裝）時，角色清單用
    // extractors/default-roles.json 內建的「企業各種員工」角色當起始
    // 內容，讓知識庫裡預先配置好 roleIds 的企業角色提示詞範本（見
    // seedDefaultKnowledgeBase()）一開機就能在側邊欄「預設提示詞」
    // 對得上角色，不用使用者自己重新手動建立一輪角色。跟
    // seedDefaultKnowledgeBase()／loadSelectors() 是同一套慣例：只在
    // 檔案完全不存在時套用，一旦存過檔（哪怕使用者把角色刪光）就永遠
    // 讀使用者自己的版本。
    state.appState = {
      accounts: [],
      ui: { ...DEFAULT_UI_STATE },
      extensions: [],
      roles: seedDefaultRoles(),
    };
  }
}

function seedDefaultRoles() {
  const defaults = readJSONSafe(
    path.join(__dirname, '..', 'extractors', 'default-roles.json'),
    { roles: [] }
  );
  const now = new Date().toISOString();
  return (Array.isArray(defaults.roles) ? defaults.roles : []).map((r) => ({
    id: r.id || genId('role'),
    name: r.name || '',
    description: r.description || '',
    color: r.color || '#4f8cff',
    createdAt: now,
    updatedAt: now,
  }));
}

function saveAppState() {
  writeJSONSafe(statePath(), state.appState);
}

// 知識庫資料結構：
//   items:  一般提示詞項目，可選擇附帶一份獨立檢核表 checklist，
//     以及一份「角色配置」roleIds（這個提示詞要當成哪些角色的預設提示詞，
//     對應側邊欄「預設提示詞」區塊，會依目前選中帳號的角色列出來）。
//     content 是原本單一欄位的提示詞內容（自由格式，向下相容舊資料）；
//     systemPrompt／userPrompt 是 1.26.0 新增的可選拆分欄位——放企業
//     角色範本這類「先設定角色人設，再交代這次要做的事」的提示詞時，
//     可以分開填寫、分開複製，兩者皆為空字串時代表這個項目仍是單純用
//     content 的舊式寫法。
//     { id, title, content, tags: string[],
//       checklist: [{ id, text, checked }],
//       roleIds: string[],
//       systemPrompt: string, userPrompt: string,
//       createdAt, updatedAt }
//   groups: 群組順序提示詞套餐，steps 依序引用 items 的 id，
//     每個 step 本身就是「檢核表機制」的一格（追蹤這個步驟是否已使用/完成）
//     { id, title, description, tags: string[],
//       steps: [{ id, itemId, checked }],
//       createdAt, updatedAt }
function loadKnowledgeBase() {
  const loaded = readJSONSafe(knowledgePath(), null);
  if (!loaded) return seedDefaultKnowledgeBase();
  // 相容舊版格式（loaded 本身可能只有 items，沒有 groups）
  const items = Array.isArray(loaded.items) ? loaded.items : [];
  const groups = Array.isArray(loaded.groups) ? loaded.groups : [];
  // 補齊舊資料缺少的欄位（systemPrompt／userPrompt 是提示詞項目的「系統
  // 提示詞／使用者提示詞」拆分欄位，1.26.0 才新增；舊資料沒有這兩個欄位
  // 時視為空字串，畫面上仍可正常顯示既有的 content，也能事後補填）
  items.forEach((it) => {
    if (!Array.isArray(it.checklist)) it.checklist = [];
    if (!Array.isArray(it.roleIds)) it.roleIds = [];
    if (typeof it.systemPrompt !== 'string') it.systemPrompt = '';
    if (typeof it.userPrompt !== 'string') it.userPrompt = '';
  });
  return { items, groups };
}

// knowledge-base.json 完全不存在時（全新安裝、第一次開啟知識庫），用
// extractors/default-knowledge-base.json 裡內建的提示詞範本當起始內容
// ——跟 loadSelectors() 用 default-selectors.json 當起手式是同一套慣例
// （見下方）。這裡只在檔案完全不存在時會用到：一旦寫過一次
// knowledge-base.json（哪怕使用者把範本全部刪光只剩空清單），之後永遠
// 讀使用者自己的版本，絕對不會回頭覆蓋使用者已經編輯過的內容。
function seedDefaultKnowledgeBase() {
  const defaults = readJSONSafe(
    path.join(__dirname, '..', 'extractors', 'default-knowledge-base.json'),
    { items: [] }
  );
  const now = new Date().toISOString();
  const items = (Array.isArray(defaults.items) ? defaults.items : []).map((it) => ({
    id: genId('kb'),
    title: it.title || '',
    content: it.content || '',
    tags: Array.isArray(it.tags) ? it.tags : [],
    checklist: [],
    // 內建範本檔裡「企業角色範本」分類的項目會自帶 roleIds（對應
    // extractors/default-roles.json 內建的角色 id）跟 systemPrompt／
    // userPrompt 拆分欄位；一般分類的項目沒有這些欄位，維持原本只有
    // content 的單一提示詞形式，這裡一律補齊成陣列／字串預設值。
    roleIds: Array.isArray(it.roleIds) ? it.roleIds : [],
    systemPrompt: it.systemPrompt || '',
    userPrompt: it.userPrompt || '',
    createdAt: now,
    updatedAt: now,
  }));
  const seeded = { items, groups: [] };
  writeJSONSafe(knowledgePath(), seeded);
  return seeded;
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
    // 1.22.0 之前建立的任務沒有 timeEntries 欄位，讀取時補上空陣列，
    // 避免舊資料在畫面上跑「工時紀錄」功能時因為欄位不存在而出錯。
    p.tasks.forEach((t) => {
      if (!Array.isArray(t.timeEntries)) t.timeEntries = [];
    });
  });
  return projects;
}

function saveProjects(projects) {
  writeJSONSafe(projectsPath(), { projects });
}

// 文件庫：儲存對話中產生的文件或手動匯入的檔案
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
