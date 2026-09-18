// main.js 拆分後，多個模組（視窗管理、資料層、IPC handlers）都需要引用的
// 靜態設定值，集中放在這裡，避免這些模組互相 require 對方造成循環依賴。

const PLATFORM_URLS = {
  claude: 'https://claude.ai',
  chatgpt: 'https://chatgpt.com',
  gemini: 'https://gemini.google.com',
  grok: 'https://grok.com',
};

const SIDEBAR_WIDTH_EXPANDED = 220;
const SIDEBAR_WIDTH_COLLAPSED = 56;

const DEFAULT_UI_STATE = {
  language: 'zh-TW',
  sidebarCollapsed: false,
  sidebarGroups: { accounts: true, prompts: true, content: true, team: true }, // 側邊欄多層清單各群組的展開狀態
  defaultSavePath: null, // null -> app.getPath('documents')
  skipSaveDialog: false,
  // 匯出對話對話框裡「同時加入知識庫」勾選框的記憶值，見
  // lib/conversationCapture.js 的 exportCurrentConversation()
  autoAddToKnowledgeOnExport: false,
  // 最後一次切換到的帳號 id，開機時懶載入回這個帳號，而不是每次固定
  // 回到帳號清單第一個，見 lib/windows.js 的 createMainWindow()
  lastActiveAccountId: null,
};

const LOG_MAX_ENTRIES = 500;
const CONSOLE_BUFFER_MAX = 300;

module.exports = {
  PLATFORM_URLS,
  SIDEBAR_WIDTH_EXPANDED,
  SIDEBAR_WIDTH_COLLAPSED,
  DEFAULT_UI_STATE,
  LOG_MAX_ENTRIES,
  CONSOLE_BUFFER_MAX,
};
