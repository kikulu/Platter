const path = require('path');
const { genId, buildGroupFromDefault } = require('./utils');
const { normalizeWorkflow } = require('./workflow');
const {
  readJSONSafe,
  writeJSONSafe,
  statePath,
  knowledgePath,
  selectorsPath,
  projectsPath,
  projectTemplatesPath,
  documentsMetaPath,
  documentsDir,
  conversationsMetaPath,
  seededDefaultsPath,
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
    // 對得上角色，不用使用者自己重新手動建立一輪角色。
    state.appState = {
      accounts: [],
      ui: { ...DEFAULT_UI_STATE },
      extensions: [],
      roles: [],
    };
  }
  // 覆蓋安裝／版本升級補種（見下方 applyIncrementalDefaultRoleSeeds()）：
  // 跟知識庫、專案範本一樣，不管是全新安裝還是既有安裝，每次開機都比對
  // 一次「這次升級的 default-roles.json 有沒有新角色」，有才補、不會
  // 動使用者已經刪除/改過的角色。全新安裝時上面 roles 是空陣列，這一步
  // 會把全部 8 個內建角色種進去，效果跟舊版寫死在 else 分支是一樣的。
  if (applyIncrementalDefaultRoleSeeds(state.appState.roles)) {
    saveAppState();
  }
}

// 覆蓋安裝／版本升級時，補進「新版 default-roles.json 裡新增、但使用者
// 既有角色清單裡還沒有」的內建角色——跟 lib/stores.js 的知識庫
// applyIncrementalDefaultSeeds() 是同一套慣例，只是角色的 id 本身就是
// 固定值（例如 `role_hr`），不像知識庫項目需要另外一個 defaultId 欄位：
// 使用者自建角色的 id 是 `role_${時間戳}_${亂數}`，跟內建角色的固定 id
// 格式不會撞名，可以直接拿 id 當比對鍵，不用回溯比對標題。
//   - seeded-defaults.json 的 roles 清單裡沒有的 id → 這次升級新增的
//     內建角色，補進去
//   - 清單裡已經有的 id → 不管使用者是否刪掉/改過名字/顏色，都不再補
// 舊安裝（在加入這個機制之前）不會有這筆記錄，用「目前角色清單裡已經
// 有的內建角色 id」回溯比對一次，標記成「已種過」，避免舊安裝重複拿到
// 一份角色；新安裝（roles 是空陣列）則等於「一個都還沒種過」，會在
// 這裡一次把全部內建角色種進去。
function applyIncrementalDefaultRoleSeeds(roles) {
  const defaultRoles = readDefaultRolesFile();
  if (defaultRoles.length === 0) return false;

  const seededRecord = readSeededDefaultsRecord();
  let seededIds = Array.isArray(seededRecord.roles) ? seededRecord.roles : null;

  if (seededIds === null) {
    const existingIds = new Set(roles.map((r) => r.id));
    seededIds = defaultRoles.filter((d) => existingIds.has(d.id)).map((d) => d.id);
  }

  const seededSet = new Set(seededIds);
  const now = new Date().toISOString();
  let addedAny = false;
  defaultRoles.forEach((d) => {
    if (seededSet.has(d.id)) return;
    roles.push({
      id: d.id,
      name: d.name || '',
      description: d.description || '',
      color: d.color || '#4f8cff',
      createdAt: now,
      updatedAt: now,
    });
    seededSet.add(d.id);
    addedAny = true;
  });

  writeSeededDefaultsRecord({ roles: Array.from(seededSet) });
  return addedAny;
}

function readDefaultRolesFile() {
  const defaults = readJSONSafe(
    path.join(__dirname, '..', 'extractors', 'default-roles.json'),
    { roles: [] }
  );
  return Array.isArray(defaults.roles) ? defaults.roles : [];
}

// 內建角色的固定 id 清單（例如 `role_hr`），Settings 視窗的角色管理拿
// 這個判斷一個角色是「基本（內建）」還是「延展（使用者自訂）」，見
// lib/ipc/accounts.js 的 roles:list。純粹是顯示分類用，不代表這些角色
// 不能被使用者編輯或刪除——跟知識庫的內建範本一樣，種進去之後就是使用者
// 自己的資料，能自由修改。
function defaultRoleIds() {
  return readDefaultRolesFile().map((r) => r.id);
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
//     每個 step 本身就是「檢核表機制」的一格（追蹤這個步驟是否已使用/完成）。
//     step.stage 是 1.27.0 新增的選填「階段名稱」：相鄰且 stage 相同的步驟
//     屬於同一階段（例如「階段 1：文獻規劃」「階段 2：內文撰寫」），順序仍
//     完全由 steps 陣列決定；舊資料沒有這個欄位、或空字串，都代表沒有分階段。
//     defaultId 只有從內建「分階段套餐範本」種進來的套餐才有，用來追蹤來源、
//     避免升級時重複補種。
//     { id, defaultId?, title, description, tags: string[],
//       steps: [{ id, itemId, checked, stage }],
//       createdAt, updatedAt }
function readDefaultKnowledgeBaseFile() {
  return readJSONSafe(
    path.join(__dirname, '..', 'extractors', 'default-knowledge-base.json'),
    { items: [], groups: [] }
  );
}

function makeItemFromDefault(defaultItem, now) {
  return {
    id: genId('kb'),
    defaultId: defaultItem.defaultId || null,
    title: defaultItem.title || '',
    content: defaultItem.content || '',
    tags: Array.isArray(defaultItem.tags) ? defaultItem.tags : [],
    checklist: [],
    roleIds: Array.isArray(defaultItem.roleIds) ? defaultItem.roleIds : [],
    systemPrompt: defaultItem.systemPrompt || '',
    userPrompt: defaultItem.userPrompt || '',
    createdAt: now,
    updatedAt: now,
  };
}

// seeded-defaults.json 是好幾種內建預設資料（知識庫提示詞/套餐、角色…）
// 共用的同一個檔案，各自記自己的 key（knowledgeBase／knowledgeGroups／
// roles…）。這幾種資料的載入時機互相獨立、順序不固定（例如角色是開機
// 時 loadAppState() 就會處理，知識庫是使用者真的打開知識庫視窗才會呼叫
// loadKnowledgeBase()），所以每次寫檔前一定要先讀出目前完整內容再合併
// 寫回，不能直接整份覆蓋——不然先跑的那個把檔案寫成只有自己的 key，
// 等另一個晚一點才跑到、以為自己是「第一次」，会重新觸發一輪回溯比對，
// 也會把先前寫的 key 蓋掉。
function readSeededDefaultsRecord() {
  return readJSONSafe(seededDefaultsPath(), null) || {};
}
function writeSeededDefaultsRecord(patch) {
  writeJSONSafe(seededDefaultsPath(), { ...readSeededDefaultsRecord(), ...patch });
}

// 覆蓋安裝／版本升級時，補進「新版 default-knowledge-base.json 裡新增、
// 但使用者既有 knowledge-base.json 裡還沒有」的內建範本。
//
// 用 seeded-defaults.json 記錄「已經種過的 defaultId 清單」來判斷新舊：
//   - 清單裡沒有的 defaultId → 這次升級新增的範本，補進 items
//   - 清單裡已經有的 defaultId → 不管使用者是否刪掉/改過，都不再補
//
// 舊安裝（在加入這個機制之前）不會有 seeded-defaults.json，也不會有
// defaultId 這個欄位，此時用「標題完全相同」回溯比對一次，把目前已存在
// 的內建範本標記為「已種過」，避免整批 41 個重複塞進去；之後就都靠
// defaultId 做增量比對。
//
// 內建「分階段套餐範本」（default-knowledge-base.json 的 `groups`，1.27.0
// 新增）用同一套機制、記在 seeded-defaults.json 的 `knowledgeGroups`：
// 升級前的安裝沒有這個欄位，等於「一組都還沒種過」，第一次升級後會把
// 所有內建套餐補進去一次；之後使用者刪掉/改過都不會再被補回來。套餐裡的
// 步驟是用提示詞的 defaultId 引用，補種時才對照使用者知識庫裡實際的 item
// id（所以一定要在補完內建提示詞之後才處理套餐）。
// 內建提示詞 defaultId → 使用者知識庫裡實際 item id 的對照表，內建分階段
// 套餐展開成步驟時用。
function buildItemIdByDefaultId(items) {
  const map = new Map();
  items.forEach((it) => {
    if (it.defaultId) map.set(it.defaultId, it.id);
  });
  return map;
}

function applyIncrementalDefaultSeeds(knowledgeData) {
  const defaults = readDefaultKnowledgeBaseFile();
  const defaultItems = Array.isArray(defaults.items) ? defaults.items : [];
  if (defaultItems.length === 0) return false;

  const seededRecord = readSeededDefaultsRecord();
  let seededIds = Array.isArray(seededRecord.knowledgeBase)
    ? seededRecord.knowledgeBase
    : null;

  if (seededIds === null) {
    // 第一次跑這個機制：用標題回溯比對既有資料，避免舊安裝重複拿到範本
    const existingTitles = new Set(knowledgeData.items.map((it) => it.title));
    seededIds = defaultItems
      .filter((d) => existingTitles.has(d.title))
      .map((d) => d.defaultId);
    // 順便把比對上的既有項目補上 defaultId，之後編輯/刪除都追得到來源
    knowledgeData.items.forEach((it) => {
      if (it.defaultId) return;
      const match = defaultItems.find((d) => d.title === it.title);
      if (match) it.defaultId = match.defaultId;
    });
  }

  const seededSet = new Set(seededIds);
  const now = new Date().toISOString();
  let addedAny = false;
  defaultItems.forEach((d) => {
    if (!d.defaultId || seededSet.has(d.defaultId)) return;
    knowledgeData.items.push(makeItemFromDefault(d, now));
    seededSet.add(d.defaultId);
    addedAny = true;
  });

  // 內建分階段套餐：defaultId → 使用者知識庫裡實際 item id 的對照表要在
  // 上面補完內建提示詞之後才建立，新補進來的提示詞才對得到。
  const defaultGroups = Array.isArray(defaults.groups) ? defaults.groups : [];
  const seededGroupSet = new Set(
    Array.isArray(seededRecord.knowledgeGroups) ? seededRecord.knowledgeGroups : []
  );
  if (defaultGroups.length > 0) {
    const itemIdByDefaultId = buildItemIdByDefaultId(knowledgeData.items);
    defaultGroups.forEach((dg) => {
      if (!dg.defaultId || seededGroupSet.has(dg.defaultId)) return;
      const group = buildGroupFromDefault(dg, itemIdByDefaultId, now);
      // 引用的提示詞全被使用者刪光時 group 是 null：不種，但一樣記成
      // 「已處理過」，避免每次載入都重試。
      if (group) {
        knowledgeData.groups.push(group);
        addedAny = true;
      }
      seededGroupSet.add(dg.defaultId);
    });
  }

  writeSeededDefaultsRecord({
    knowledgeBase: Array.from(seededSet),
    knowledgeGroups: Array.from(seededGroupSet),
  });
  return addedAny;
}

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
  // 套餐的 step.stage 是 1.27.0 新增的欄位；舊資料沒有時視為空字串
  // （沒有分階段），畫面上照舊當成一份單純依序執行的套餐。
  groups.forEach((g) => {
    if (!Array.isArray(g.steps)) g.steps = [];
    g.steps.forEach((s) => {
      if (typeof s.stage !== 'string') s.stage = '';
    });
  });
  const result = { items, groups };
  // 補種這次升級新增的內建範本；有補到才需要立刻寫回磁碟
  if (applyIncrementalDefaultSeeds(result)) {
    saveKnowledgeBase(result);
  }
  return result;
}

// knowledge-base.json 完全不存在時（全新安裝、第一次開啟知識庫），用
// extractors/default-knowledge-base.json 裡內建的提示詞範本當起始內容
// ——跟 loadSelectors() 用 default-selectors.json 當起手式是同一套慣例
// （見下方）。這裡只在檔案完全不存在時會用到：一旦寫過一次
// knowledge-base.json（哪怕使用者把範本全部刪光只剩空清單），之後永遠
// 讀使用者自己的版本，絕對不會回頭覆蓋使用者已經編輯過的內容。
function seedDefaultKnowledgeBase() {
  const defaults = readDefaultKnowledgeBaseFile();
  const now = new Date().toISOString();
  const defaultItems = Array.isArray(defaults.items) ? defaults.items : [];
  // 內建範本檔裡「企業角色範本」分類的項目會自帶 roleIds（對應
  // extractors/default-roles.json 內建的角色 id）跟 systemPrompt／
  // userPrompt 拆分欄位；一般分類的項目沒有這些欄位，makeItemFromDefault
  // 一律補齊成陣列／字串預設值。
  const items = defaultItems.map((it) => makeItemFromDefault(it, now));
  // 內建分階段套餐範本（1.27.0）：用剛種好的提示詞 id 對照展開成步驟。
  const defaultGroups = Array.isArray(defaults.groups) ? defaults.groups : [];
  const itemIdByDefaultId = buildItemIdByDefaultId(items);
  const groups = defaultGroups
    .map((dg) => buildGroupFromDefault(dg, itemIdByDefaultId, now))
    .filter(Boolean);
  const seeded = { items, groups };
  writeJSONSafe(knowledgePath(), seeded);
  // 全新安裝時，把這批內建範本的 defaultId 整批記錄成「已種過」，
  // 這樣往後升級只會補新增的範本，不會把這裡已經有的再種一次。
  writeSeededDefaultsRecord({
    knowledgeBase: defaultItems.map((it) => it.defaultId).filter(Boolean),
    knowledgeGroups: defaultGroups.map((dg) => dg.defaultId).filter(Boolean),
  });
  return seeded;
}

function saveKnowledgeBase(data) {
  writeJSONSafe(knowledgePath(), { items: data.items || [], groups: data.groups || [] });
}

function readDefaultSelectorsFile() {
  return readJSONSafe(
    path.join(__dirname, '..', 'extractors', 'default-selectors.json'),
    {}
  );
}

// 跟知識庫/角色一樣的覆蓋安裝補種問題：原本只有「selectors.json 完全不
// 存在」才會套用 default-selectors.json，一旦存過檔，往後升級新增的
// 平台（例如本地端 AI 服務以外、未來真的新增某個雲端平台）或某個平台
// 新補的選擇器欄位，既有使用者永遠拿不到。這裡改成每次載入都比對一次：
// 缺的平台整組補上、平台裡缺的欄位個別補上，**使用者已經存在的值（包含
// 空字串——代表使用者刻意清空）一律不碰**，跟其他內建資料的補種原則
// 一致。
function applyIncrementalSelectorDefaults(selectors) {
  const defaults = readDefaultSelectorsFile();
  let changed = false;
  Object.keys(defaults).forEach((platform) => {
    if (!selectors[platform] || typeof selectors[platform] !== 'object') {
      selectors[platform] = {};
      changed = true;
    }
    Object.keys(defaults[platform]).forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(selectors[platform], key)) {
        selectors[platform][key] = defaults[platform][key];
        changed = true;
      }
    });
  });
  return changed;
}

function loadSelectors() {
  let loaded = readJSONSafe(selectorsPath(), null);
  if (!loaded) {
    loaded = {};
    applyIncrementalSelectorDefaults(loaded);
    writeJSONSafe(selectorsPath(), loaded);
    return loaded;
  }
  if (applyIncrementalSelectorDefaults(loaded)) {
    writeJSONSafe(selectorsPath(), loaded);
  }
  return loaded;
}

function saveSelectors(selectors) {
  writeJSONSafe(selectorsPath(), selectors);
}

// 專案計畫管理：
//   project: { id, name, description, status ('planning'|'active'|'onhold'|'done'),
//              startDate, endDate, tasks: [...], issues: [...],
//              workflow?: { templateId, templateName, topic, contextMode, currentStepId,
//                           steps: [{ id, stage, title, prompt, output, status, taskId }] }
//                (1.29.0 階段流程，從專案範本建立，見 lib/workflow.js),
//              linkedDocumentIds: string[]（1.35.0，跟文件庫既有文件手動建立關聯，
//                多對多，機制跟對話庫的 linkedDocumentIds 完全一樣——見下方
//                loadConversations() 的說明；階段流程的步驟產出也可以「存成文件」，
//                存出來的新文件會自動加進這個陣列，見 lib/ipc/projects.js 的
//                projects:workflow:saveStepOutputAsDocument）,
//              createdAt, updatedAt }
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
    if (!Array.isArray(p.linkedDocumentIds)) p.linkedDocumentIds = [];
    // 1.22.0 之前建立的任務沒有 timeEntries 欄位，讀取時補上空陣列，
    // 避免舊資料在畫面上跑「工時紀錄」功能時因為欄位不存在而出錯。
    p.tasks.forEach((t) => {
      if (!Array.isArray(t.timeEntries)) t.timeEntries = [];
    });
    // 1.29.0 新增的階段流程（project.workflow，見 lib/workflow.js）：沒有就維持沒有，
    // 有的話補齊缺少的欄位；結構壞掉（不是含 steps 陣列的物件）就丟掉，避免畫面出錯。
    if (p.workflow) {
      const normalized = normalizeWorkflow(p.workflow);
      if (normalized) p.workflow = normalized;
      else delete p.workflow;
    }
  });
  return projects;
}

function saveProjects(projects) {
  writeJSONSafe(projectsPath(), { projects });
}

// 專案範本（1.29.0）：內建範本在 extractors/default-project-templates.json（唯讀，
// 隨程式版本更新），使用者從專案「另存為專案範本」的自訂範本存在資料目錄的
// project-templates.json。範本格式與如何展開成專案 workflow 見 lib/workflow.js。
//   { id, name, description, stages: [{ title, steps: [{ title?, prompt?, itemDefaultId? }] }], createdAt }
function loadDefaultProjectTemplates() {
  const data = readJSONSafe(
    path.join(__dirname, '..', 'extractors', 'default-project-templates.json'),
    { templates: [] }
  );
  return Array.isArray(data.templates) ? data.templates : [];
}

function loadProjectTemplates() {
  const loaded = readJSONSafe(projectTemplatesPath(), null);
  return loaded && Array.isArray(loaded.templates) ? loaded.templates : [];
}

function saveProjectTemplates(templates) {
  writeJSONSafe(projectTemplatesPath(), { templates });
}

// 範本步驟用 itemDefaultId 引用知識庫的內建提示詞（例如 SDD 範本的 7 個步驟）。
// 回傳一個 resolver(defaultId) → { title, prompt } | null：優先用「使用者知識庫裡」帶有該
// defaultId 的項目（使用者調整過提示詞，之後建立的專案就會用調整後的版本），找不到（例如
// 已被使用者刪掉）退回內建檔的原始內容。知識庫與內建檔各只讀一次，供同一次操作重複使用。
function makeKnowledgePromptResolver() {
  const defaultsData = readJSONSafe(
    path.join(__dirname, '..', 'extractors', 'default-knowledge-base.json'),
    { items: [] }
  );
  const byDefaultId = new Map();
  (defaultsData.items || []).forEach((it) => {
    if (it.defaultId) byDefaultId.set(it.defaultId, it);
  });
  loadKnowledgeBase().items.forEach((it) => {
    if (it.defaultId) byDefaultId.set(it.defaultId, it);
  });
  return (defaultId) => {
    const it = byDefaultId.get(defaultId);
    if (!it) return null;
    const prompt =
      it.content || [it.systemPrompt, it.userPrompt].filter(Boolean).join('\n\n');
    return { title: it.title || '', prompt };
  };
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
  loadDefaultProjectTemplates,
  loadProjectTemplates,
  saveProjectTemplates,
  makeKnowledgePromptResolver,
  loadDocuments,
  saveDocuments,
  registerDocument,
  documentsDir,
  loadConversations,
  saveConversations,
  defaultRoleIds,
};
