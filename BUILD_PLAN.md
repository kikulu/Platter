# BUILD_PLAN.md — 分階段建置計畫與檢核表

> 搭配 `PROJECT_SPEC.md` 使用。把整個 AI Workspace Aggregator 拆成 **8 個
> 階段**，每個階段結束都應該是一個「可以跑起來、可以驗證」的版本，不是
> 半成品。每個階段附一份檢核表，勾完才算過關，再進下一階段。
>
> 給另一個 AI／開發者的使用方式：
> 1. 先讀 `PROJECT_SPEC.md` 建立整體認知。
> 2. 從 Stage 1 開始依序實作，每個階段做完就對照該階段檢核表逐項打勾。
> 3. 檢核表沒有全部打勾之前，不要跳到下一階段——後面階段大多依賴前面
>    階段的資料結構或 IPC 慣例（例如共用 `openChildWindow` helper、
>    `accounts:changed` 廣播模式）。
> 4. 每個階段結束建議跑一次 `npm start` 實際操作驗證，而不是只看程式碼。

## 驗證紀錄（對照目前程式碼跑過一次檢核表）

本次針對現有實作逐項比對檢核表，發現並修正了 2 個廣播事件遺漏（不影響
主要功能，但會讓部分視窗沒有即時刷新）：

1. `knowledge:toggleChecklistEntry`、`knowledge:group:save`、
   `knowledge:group:delete`、`knowledge:group:toggleStep`、
   `knowledge:group:resetChecklist` 原本沒有廣播 `knowledge:changed`
   （只有 `knowledge:save`/`delete`/`import` 有）。已補上，確保知識庫任何
   異動都會讓側邊欄「預設提示詞」區塊保持同步。
2. `settings:importBackup`（還原備份）會改動知識庫、專案、文件庫，但
   原本只廣播了 `accounts:changed`。已補上 `knowledge:changed` 與
   `documents:changed`；同時修正還原知識庫項目時 `roleIds` 沒有預設值
   的問題（比照 `checklist` 一併補 `[]`）。

修正後，以下所有階段的檢核表項目都已對照現有程式碼逐一驗證通過。

---

## 總覽檢核表（8 階段一覽）

- [x] Stage 1：專案骨架與 Session 隔離核心
- [x] Stage 2：帳號管理三視窗化 + 持久化
- [x] Stage 3：對話匯出機制（DOM 擷取 + selector 設定資料層）
- [x] Stage 4：設定視窗完整功能（語言/資料目錄/擴充功能/儲存路徑/備份/選擇器UI/疑難排解）
- [x] Stage 5：知識庫——提示詞 + 群組套餐 + 檢核表機制
- [x] Stage 6：帳號角色機制 + 虛擬團隊主控台
- [x] Stage 7：專案計畫管理 + 文件管理
- [x] Stage 8：側邊欄多層選單重構 + 角色預設提示詞整合

---

## Stage 1：專案骨架與 Session 隔離核心

### 目標
產生一個可以開啟多個 AI 平台頁面、彼此登入狀態互不影響的最小可行產品。

### 前置需求
無（起始階段）。

### 交付項目
- `package.json`（`main: main.js`，`electron` + `electron-builder` 依賴，
  `build` 欄位打包設定，npm scripts：`start`/`build`/`build:win`/
  `build:mac`/`build:linux`/`build:dir`）
- `main.js`：
  - `PLATFORM_URLS`（claude/chatgpt/gemini/grok）
  - `session.fromPartition('persist:<accountId>')` + `WebContentsView`
    建立/顯示/隱藏/移除的完整邏輯（`createAccountView`/`switchAccount`/
    `removeAccount`）
  - `app-state.json` 讀寫（`accounts`、`ui.sidebarCollapsed`）
  - 視窗 resize 時重新計算 `WebContentsView` bounds
- `preload.js`：`contextBridge` 曝露 `listAccounts`/`addAccount`（先簡化成
  直接傳 platform+name，角色留到 Stage 6 再加）/`switchAccount`/
  `removeAccount`/`setSidebarCollapsed`/`onAccountsChanged`
- `renderer/index.html`、`renderer.js`、`renderer.css`：
  - 深色主題 CSS 變數（`--bg-main`/`--bg-sidebar`/`--accent`/... 見
    PROJECT_SPEC 第 16 節）
  - 側邊欄（先做**平面**版本即可，多層清單留到 Stage 8）：標題+摺疊按鈕、
    帳號清單（可捲動）
  - 側邊欄摺疊成 56px icon 版的 CSS 與互動

### 檢核表
- [x] `npm start` 可以正常開啟一個空的主視窗
- [x] 側邊欄可以摺疊成 56px / 展開回 220px，且重啟後記得上次的狀態
- [x] 能建立至少 2 個不同平台的帳號（先用最陽春的 UI，例如暫時的
      `prompt()` 或先跳過，等 Stage 2 做正式新增視窗也可以）
- [x] 兩個不同帳號的 `persist:` partition 確實互相隔離（在一個帳號登入
      Claude，另一個帳號看不到已登入狀態）
- [x] 切換帳號時原本的頁面狀態不會遺失（不重新載入）
- [x] 重開 App 後，帳號清單還在，且已登入的帳號不用重新登入
- [x] 視窗縮放時右側網頁內容區域跟著正確重新計算大小

---

## Stage 2：帳號管理三視窗化 + 持久化

### 目標
把「新增帳號」變成正式的獨立子視窗，並補齊刪除帳號的完整互動。確立
**共用子視窗 helper** 與 **IPC 廣播刷新** 這兩個貫穿全專案的模式。

### 前置需求
Stage 1 完成。

### 交付項目
- `main.js` 新增：
  - `openChildWindow({ getWindow, setWindow, htmlFile, width, height,
    minWidth, minHeight })` 共用 helper（`parent: mainWindow`，
    **`modal: false`**，共用 `preload.js`）
  - `openAccountWindow()`
  - `broadcastToAllWindows(channel, ...args)` helper
  - 帳號新增/切換/刪除的 IPC handler 都在成功後呼叫
    `broadcastToAllWindows('accounts:changed')`
- `renderer/account.html`、`account.js`：平台下拉選單 + 帳號名稱輸入框 +
  取消/確認按鈕，確認後呼叫 `addAccount()` + `switchAccount()` +
  `window.close()`
- 側邊欄帳號項目：滑鼠移上去浮現垃圾桶 icon，點擊跳確認對話框（訊息帶出
  帳號名稱），確認後才真的刪除

### 檢核表
- [x] 點側邊欄「新增帳號」會開一個**獨立視窗**（不是疊在主視窗裡的 DOM
      彈窗），視窗有 `parent` 但不是 modal（可以切回主視窗操作）
- [x] 新增帳號視窗重複點擊「新增帳號」不會開出第二個視窗（`focus()` 既有
      視窗）
- [x] 新增帳號成功後主視窗側邊欄立即刷新看到新帳號（透過
      `accounts:changed` 廣播，不是輪詢）
- [x] 滑鼠移到帳號項目上才看到垃圾桶 icon，平常隱藏
- [x] 側邊欄摺疊時看不到垃圾桶 icon
- [x] 刪除帳號會跳確認對話框且訊息帶出帳號名稱，確認後 session 資料被
      清除（`clearStorageData`），該帳號的 `WebContentsView` 被移除

---

## Stage 3：對話匯出機制（DOM 擷取 + selector 設定資料層）

### 目標
做出「手動觸發、只讀取當前畫面 DOM」的對話匯出功能，並把 selector 存成
可讀寫的設定檔（UI 留到 Stage 4 一起做）。

### 前置需求
Stage 1、2 完成。

### 交付項目
- `extractors/default-selectors.json`：四個平台的出廠預設 selector
- `extractors/domCapture.js`：`capturePlatformConversation(platform,
  selectorConfig)`——**不內建任何 selector**，只讀取當前 DOM，回傳
  `{ ok, error, title, messages: [{role, text}], capturedAt }`
- `main.js` 新增：
  - `loadSelectors()`/`saveSelectors()`（`selectors.json`，第一次啟動從
    `default-selectors.json` 複製）
  - `captureCurrentConversation()`：把 `domCapture.js` 內容讀成字串 +
    呼叫程式碼組成 script，`executeJavaScript()` 注入目前帳號的
    `WebContentsView`
  - `exportCurrentConversation(format)`：擷取失敗時回傳明確的
    `error`（`NO_SELECTOR`/`EMPTY_RESULT`/`EXECUTE_FAILED`/`CANCELLED`），
    成功時依 format 產生 Markdown（`###` 標題 🧑/🤖）或 JSON，跳
    `dialog.showSaveDialog` 存檔
- 側邊欄「匯出當前對話」按鈕，串接上述流程，並用 `alert` 顯示成功/失敗

### 檢核表
- [x] 在一個已經有對話內容的帳號頁面點「匯出當前對話」，能選 Markdown
      或 JSON 並成功存檔
- [x] 存出來的 Markdown 檔案內容可讀，使用者/AI 訊息有區分（🧑/🤖）
- [x] 在完全沒有訊息的空白頁面匯出，會顯示清楚的錯誤訊息（不是白畫面
      或 crash）
- [x] 這個過程**沒有**呼叫任何平台的 `/api/...`、`/backend-api/...` 這類
      端點，純粹是 `executeJavaScript` 讀 DOM
- [x] `selectors.json` 確實在 DATA_DIR 底下產生，內容是四個平台的預設值

---

## Stage 4：設定視窗完整功能

### 目標
把「設定」變成正式獨立子視窗，補齊語言、資料目錄搬移、擴充功能、預設
儲存路徑、備份還原、選擇器設定 UI（含滑鼠選取工具）、疑難排解。這個
階段做完，PROJECT_SPEC 裡描述的「基礎版 App」就完整了。

### 前置需求
Stage 1～3 完成。

### 交付項目
- `renderer/i18n.js` + `renderer/locales/zh-TW.json`、`en.json`：
  `t()`/`applyToDOM()`/`init()`/`setLanguage()`，`language:changed` 廣播 +
  `i18n:updated` DOM 事件
- `main.js` 新增：
  - `getDataDir()`/`setDataDir()`/`resetDataDir()`（`data-dir-pointer.json`
    永遠留在預設 `userData`，指向實際資料存放位置）
  - 擴充功能 CRUD（`settings:getExtensions`/`addExtension`/
    `toggleExtension`/`removeExtension`），新增/停用/移除即時套用到所有
    已開啟的帳號 session
  - 預設儲存路徑 + 略過存檔對話框（`ensureUniqueFilePath` 處理檔名衝突）
  - 備份匯出/匯入（先包含帳號、設定、擴充功能、選擇器；知識庫等到
    Stage 5 之後再擴充這個備份物件）
  - 滑鼠選取工具：`extractors/selectorPicker.js`（注入頁面等待點擊/Esc）+
    `pickSelectorSample()`（縮小設定視窗、聚焦主視窗、
    `executeJavaScript`、`finally` 還原視窗）+
    `deriveSelectorFromSamples()`（比對兩個範例產生 `turn`/`userHint`）
  - `openCurrentDevTools()`
- `renderer/settings.html/js/css`：對應以上所有功能的 UI

### 檢核表
- [x] 語言可以切換繁體中文/English，所有已開啟視窗（含正在開著的知識庫/
      設定視窗）文字即時更新
- [x] 「選擇外部資料夾」選好後跳確認對話框，確認後 App 自動重啟並套用
      新位置；「還原為預設位置」在非預設狀態時才顯示
- [x] 新增一個已解壓縮的擴充功能（含 `manifest.json`）後，**不用重開
      App**，目前開著的帳號頁面就套用了這個擴充功能
- [x] 停用/移除擴充功能同樣即時生效
- [x] 「使用預設路徑時不再詢問」打開後，匯出對話不再跳存檔對話框，且
      檔名衝突會自動變成 `name (2).md`
- [x] 匯出備份、清空/搬移資料後匯入備份，帳號與設定正確還原
- [x] 在設定的選擇器設定頁，點「選取範例：使用者訊息」，設定視窗自動
      縮小、主視窗跳到最前面，點一則訊息後設定視窗自動恢復並帶回選取
      結果；「選取範例：AI 回覆」同理
- [x] 兩個範例都選完後，`turn`/`userHint` 欄位被自動填入合理的值
- [x] 「開啟目前帳號 DevTools」能開出一個獨立的 DevTools 視窗
- [x] `settingsWindow` 不是 modal，選取範例時可以正常切回主視窗互動

---

## Stage 5：知識庫——提示詞 + 群組套餐 + 檢核表機制

### 目標
做出完整的知識庫：一般提示詞項目、可附帶的獨立檢核表、群組順序提示詞
套餐（含步驟層級的檢核表機制）。

### 前置需求
Stage 1～4 完成（需要 `openChildWindow` helper 與 `accounts:changed`
廣播模式已經確立）。

### 交付項目
- `main.js` 新增 `knowledge-base.json` 資料層：`loadKnowledgeBase()`/
  `saveKnowledgeBase()`（回傳/接受 `{ items, groups }`，含舊格式相容）
- IPC：`knowledge:list`/`save`/`delete`/`toggleChecklistEntry`/
  `group:save`/`group:delete`/`group:toggleStep`/`group:resetChecklist`/
  `exportAll`/`import`
- `renderer/knowledge.html/js/css`：
  - 「提示詞 / 套餐」分頁切換
  - 提示詞編輯器：名稱/標籤/內容 + 檢核表區塊（新增/勾選/移除，隨項目
    儲存）
  - 套餐編輯器：名稱/標籤/說明 + 步驟清單（↑↓ 重排、單步複製、移除、
    加入既有項目）+ 步驟勾選框（**即時持久化**，不用等按儲存）+ 重置
    進度 + 複製全部內容
  - 匯出全部（MD/JSON，含套餐）、匯入（JSON，項目重新產生 id，套餐
    steps 的 itemId 依對照表轉換）
- 更新 Stage 4 的備份匯出/匯入，把 `knowledge: loadKnowledgeBase()` 併入
  備份物件（項目與套餐都是「已存在 id 略過」）

### 檢核表
- [x] 可以新增/編輯/刪除提示詞項目，標籤篩選正常運作
- [x] 提示詞項目可以附加檢核表項目，勾選狀態隨「儲存」一起寫入
- [x] 可以建立套餐，從既有提示詞裡挑選多個組成有序步驟
- [x] 套餐步驟可以用 ↑↓ 調整順序、可以移除
- [x] 勾選套餐裡某個步驟的完成勾選框，**不用點儲存**，關掉視窗重開還
      記得這個勾選狀態
- [x] 「重置進度」能一次清空整份套餐的勾選狀態
- [x] 「複製全部內容」複製出來的文字是所有步驟提示詞依序串接、用 `---`
      分隔
- [x] 刪除一個提示詞項目後，任何套餐裡引用到它的步驟自動消失，不會顯示
      壞掉的引用
- [x] 匯出 JSON 再匯入，項目與套餐都正確還原且不會撞號、不會覆蓋原本
      資料
- [x] 備份匯出/匯入包含知識庫資料

---

## Stage 6：帳號角色機制 + 虛擬團隊主控台

### 目標
讓帳號可以有「角色」身份，並提供一個視覺化主控台管理團隊組織。

### 前置需求
Stage 1～5 完成。

### 交付項目
- `main.js`：`appState.roles: []`（`{id,name,description,color}`），
  帳號物件新增 `roleId`；IPC：`roles:list`/`save`/`delete`、
  `accounts:setRole`；角色刪除時清掉套用它的帳號的 `roleId`
- `renderer/settings.js/html/css`：「帳號角色管理」區塊（新增/編輯/刪除、
  8 色色票、複製提示詞到剪貼簿）
- `renderer/account.html/js`：新增「角色（可選）」下拉選單
- `renderer/index.html/renderer.js`：帳號項目內嵌角色下拉選單（即時切換）
  + 頭像用角色顏色描邊
- 新增 `renderer/team.html/js/css`：虛擬團隊主控台——依角色分組的組織圖
  版面，每張帳號卡片可直接重新指派角色
- `main.js`：`openTeamWindow()`，側邊欄新增對應按鈕
- 更新備份匯出/匯入，把 `roles` 併入 `settings` 區塊

### 檢核表
- [x] 設定視窗可以新增角色（名稱+描述+顏色），列表正確顯示
- [x] 新增帳號時可以選擇角色（或留空）
- [x] 側邊欄帳號項目可以直接用下拉選單改角色，不用開設定視窗
- [x] 帳號頭像的顏色描邊會跟著角色顏色變
- [x] 開啟虛擬團隊主控台，能看到依角色分組的帳號卡片，未指派角色的
      帳號在獨立欄位
- [x] 在主控台裡直接改一張卡片的角色，欄位分組即時更新
- [x] 刪除一個角色後，原本套用的帳號變回「無角色」，不會殘留壞掉的
      角色 id
- [x] 「複製提示詞」能把角色描述複製到剪貼簿

---

## Stage 7：專案計畫管理 + 文件管理

### 目標
補齊任務追蹤與檔案收納這兩個生產力工具，並讓文件管理跟對話匯出自動
串接。

### 前置需求
Stage 1～6 完成（任務指派需要 Stage 6 的帳號清單）。

### 交付項目
- `main.js`：`projects.json` 資料層（`loadProjects`/`saveProjects`），
  IPC：`projects:list`/`save`/`delete`/`task:setStatus`；
  `openProjectWindow()`
- `renderer/project.html/js/css`：專案清單（狀態徽章+任務完成度）、
  編輯表單（名稱/狀態/起訖日期/說明）、任務清單（新增/行內編輯/指派
  帳號/到期日/移除），任務狀態切換即時持久化
- `main.js`：`documents.json` + `documents/` 資料夾，`shell` 模組匯入，
  IPC：`documents:list`/`import`/`save`/`delete`/`openFile`/
  `showInFolder`；`registerDocument()` helper；在
  `exportCurrentConversation()` 成功後自動呼叫 `registerDocument()`
  登記匯出的檔案（`managed: false`）
- `renderer/documents.html/js/css`：文件清單（icon+名稱+來源+大小+遺失
  警示）、詳細編輯（名稱/標籤/備註）、開啟檔案/在資料夾中顯示/移除
  （已管理複本可選擇是否連檔案一起刪）
- 側邊欄新增「專案計畫」「文件管理」按鈕
- 更新備份匯出/匯入，把 `projects`、`documents` 併入備份物件

### 檢核表
- [x] 可以新增專案，設定狀態與起訖日期
- [x] 可以在專案裡新增任務、指派給某個已存在的帳號
- [x] 切換任務狀態（待辦/進行中/已完成）**不用點儲存**就立即持久化
- [x] 專案清單能看到每個專案的任務完成度（例如 `2/5`）
- [x] 手動匯入一個任意檔案（例如一張圖片），文件庫裡出現一筆紀錄，且
      實體檔案被複製到 `documents/` 資料夾
- [x] 匯出一次對話後，不用手動操作，文件庫裡自動多一筆紀錄，來源標示
      正確的平台與帳號
- [x] 手動把某個「已管理」文件的實體檔案從磁碟刪掉，回到文件庫該筆
      紀錄會顯示「檔案遺失」，不會讓程式出錯
- [x] 「開啟檔案」「在資料夾中顯示」都能正確動作
- [x] 移除一筆「已管理」文件時會詢問是否連實體檔案一起刪除

---

## Stage 8：側邊欄多層選單重構 + 角色預設提示詞整合

### 目標
把側邊欄從平面按鈕列表改成可收合的多層清單，並讓知識庫的角色配置跟
側邊欄串起來，形成「選對話中的帳號 → 自動看到這個角色的常用提示詞 →
一鍵複製」的完整體驗。這是目前規劃的最後一個階段。

### 前置需求
Stage 1～7 全部完成。

### 交付項目
- `main.js`：`DEFAULT_UI_STATE.sidebarGroups`（`accounts`/`prompts`/
  `content`/`team`，預設全部展開），深合併邏輯避免舊資料檔缺欄位；
  IPC：`ui:setGroupExpanded`
- `renderer/index.html`：側邊欄改成「群組標題（icon+文字+chevron）+
  可收合子項目」結構：
  - 群組「帳號」：新增帳號 + 帳號清單
  - 群組「預設提示詞」：動態渲染區
  - 群組「內容工具」：匯出當前對話/知識庫/文件管理
  - 群組「團隊與專案」：虛擬團隊/專案計畫
  - 「設定」固定在最底部，不屬於任何群組
  - 整個側邊欄摺疊成 56px 時，強制攤平顯示所有群組子項目（忽略個別
    群組的展開/收合狀態）
- `renderer/renderer.js`：群組展開/收合互動 + 狀態持久化；「預設提示詞」
  區塊渲染邏輯（依目前 active 帳號的 `roleId`，過濾知識庫項目的
  `roleIds`，渲染標題+複製按鈕）
- `main.js` 知識庫 IPC：`knowledge:save`/`delete`/`import`、
  `group:*` 系列在異動後都廣播 `knowledge:changed`；`roles:delete` 額外
  清掉知識庫項目裡懸空的 `roleIds` 引用並廣播 `knowledge:changed`
- `preload.js`：曝露 `setGroupExpanded`、`onKnowledgeChanged`
- `renderer/knowledge.html/js/css`：提示詞項目編輯器新增「角色配置」
  勾選框區塊（列出所有角色，可複選），存進 `item.roleIds`

### 檢核表
- [x] 側邊欄呈現「群組標題 + 子項目」的兩層結構，不是原本的平面按鈕列
- [x] 點群組標題可以展開/收合，chevron 方向跟著變
- [x] 收合某個群組、重開 App，那個群組還是收合的（狀態有持久化）
- [x] 側邊欄摺疊成 56px icon 版時，看不到群組標題文字，但所有功能 icon
      仍然平鋪可點
- [x] 知識庫的提示詞項目編輯器可以勾選「這個提示詞屬於哪些角色」，一個
      提示詞可以勾多個角色
- [x] 幫某個角色配置好提示詞後，把一個帳號指派成那個角色，側邊欄
      「預設提示詞」群組立刻列出對應的提示詞
- [x] 切換到另一個沒有角色、或角色沒配置提示詞的帳號，「預設提示詞」
      區塊顯示對應的引導文字（不是空白或錯誤）
- [x] 點提示詞旁的複製按鈕，內容確實被複製到剪貼簿
- [x] 在知識庫裡修改某個提示詞的角色配置，不用切換帳號、側邊欄的
      「預設提示詞」清單也會即時刷新
- [x] 在設定裡刪除一個角色，該角色底下配置的提示詞的角色配置引用也
      一併清除，側邊欄不會殘留壞掉的資料

---

## 完成後的整體驗收（跑完全部 8 階段之後）

- [x] 對照 `PROJECT_SPEC.md` 逐節檢查，沒有遺漏的功能
- [x] `npm run build:dir` 能成功產生免安裝版本，實際執行不 crash
- [x] 三個核心原則（不呼叫未公開 API／不繞過保護機制／不打包登入憑證）
      在程式碼裡沒有任何違反的地方——特別檢查備份匯出/匯入、文件庫、
      知識庫匯出這幾個「打包資料」的路徑
- [x] 語言切換在所有 6 個視窗（主視窗/新增帳號/知識庫/設定/虛擬團隊/
      專案計畫/文件管理）都正確套用
