# BUILD_PLAN.md — 分階段建置計畫與檢核表

> 搭配 `PROJECT_SPEC.md` 使用。原始規劃是 **8 個階段**（Stage 1～8，見下
> 方「驗證紀錄」，這部分已完整驗收），後續陸續在既有基礎上疊加了
> **Stage 9～16**（對話庫、專案進階功能、日誌主控台、App 穩定性修正、
> SQLite 整合、知識庫/對話庫匯入 Markdown 檔案、版本號顯示與安裝路徑
> 調整、帳號清單拖曳排序）。每個階段結束都應該是一個「可以跑起來、可以
> 驗證」的版本，不是半成品。每個階段附一份檢核表，勾完才算過關，再進
> 下一階段。
>
> **給另一個 AI／開發者的使用方式（這就是「接續開發」的入口文件）**：
> 1. 先讀 `PROJECT_SPEC.md` 建立整體認知。
> 2. 讀這份文件確認目前做到哪個 Stage、還有哪些檢核表項目沒打勾
>    （特別注意 Stage 9～16 裡標示「待手動驗證」的項目——這些是邏輯上
>    已經做完、但還沒有在真正的 Electron 環境跑過的部分，開新對話後的
>    第一件事應該是先跑 `npm install && npm start` 補做這些驗證）。
> 3. 要加新功能，比照 `NEW_FEATURE_BUILD_PROMPT.md` 的模板繼續往後加
>    Stage 17、18……；要修既有功能的問題，用
>    `FIX_EXISTING_FEATURE_PROMPT.md`。
> 4. 檢核表沒有全部打勾之前，不要跳到下一階段——後面階段大多依賴前面
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

## 總覽檢核表（16 階段一覽）

- [x] Stage 1：專案骨架與 Session 隔離核心
- [x] Stage 2：帳號管理三視窗化 + 持久化
- [x] Stage 3：對話匯出機制（DOM 擷取 + selector 設定資料層）
- [x] Stage 4：設定視窗完整功能（語言/資料目錄/擴充功能/儲存路徑/備份/選擇器UI/疑難排解）
- [x] Stage 5：知識庫——提示詞 + 群組套餐 + 檢核表機制
- [x] Stage 6：帳號角色機制 + 虛擬團隊主控台
- [x] Stage 7：專案計畫管理 + 文件管理
- [x] Stage 8：側邊欄多層選單重構 + 角色預設提示詞整合
- [x] Stage 9：對話庫（新增對話 Markdown、匯出、跟文件庫互相關聯）
- [x] Stage 10：專案計畫進階功能（月曆／甘特圖／Issue 管理／跨專案總覽）
- [x] Stage 11：日誌主控台（錯誤日誌／稽核日誌／即時主控台）
- [x] Stage 12：App 穩定性修正（單一實例鎖、快取損毀成因、打包設定漏洞）
- [x] Stage 13：日誌主控台改用 SQLite（sql.js）
- [x] Stage 14：知識庫／對話庫新增「匯入 Markdown 檔案」
- [x] Stage 15：App 版本號顯示 + 安裝程式預設路徑改到應用程式資料夾
- [x] Stage 16：帳號清單拖曳排序

> **Stage 9～16 的檢核表是實作當下對照程式碼邏輯逐項confirm的，但這幾個
> 階段都還沒有在真正的 Electron 執行環境裡手動 `npm start` 跑過一輪**
> （開發過程只有 `node --check` 語法檢查跟 `node --test` 單元測試，沒有
> 顯示器可以實際打開視窗操作）。新開一個對話接續開發前，**強烈建議先
> 跑一次 `npm install && npm start`，把 Stage 9～16 的檢核表項目實際
> 操作過一遍**，確認沒有語法檢查抓不到的執行期問題（例如 IPC 參數對不
> 上、DOM id 打錯字、CSS 版面跑掉），再繼續往下加新功能。

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

## Stage 9：對話庫（新增對話 Markdown、匯出、跟文件庫互相關聯）

### 目標
補一個跟「文件管理」互補的模組：文件庫存的是「檔案」，對話庫存的是
「對話內容本身」（Markdown 全文直接存在資料庫裡），兩者用多對多關聯
互相串起來。

### 前置需求
Stage 1～8 完成（需要 `openChildWindow` helper、`documents.json` 資料層、
`registerDocument()`）。

### 交付項目
- `main.js`：`conversations.json` 資料層（`loadConversations`/
  `saveConversations`），IPC：`conversations:list`/`save`/`delete`/
  `captureCurrent`/`export`/`linkDocument`/`unlinkDocument`；
  `openConversationsWindow()`；`exportConversationEntry()`（匯出成功後
  自動呼叫 `registerDocument()` 並把新文件 id 加進
  `linkedDocumentIds`）；文件被刪除時連動清掉對話庫裡引用到它的關聯
- `renderer/conversation.html/js/css`：左側清單（標籤篩選）、右側編輯器
  （標題/標籤/Markdown 內容）、「新增對話」「擷取目前對話」（重用
  `captureCurrentConversation`）、「匯出檔案」、關聯文件區塊（顯示/開啟/
  取消關聯 + 從文件庫選擇新增關聯）
- 側邊欄「內容工具」群組新增「對話庫」按鈕
- 備份匯出/匯入把 `conversations` 併入備份物件

### 檢核表
- [x] 可以「新增對話」手動輸入標題/標籤/Markdown 內容並儲存
- [x] 「擷取目前對話」能把目前作用中帳號畫面的對話轉成 Markdown 帶入
      編輯器（不會立刻寫檔，只是預填內容）
- [x] 「匯出檔案」能選 Markdown 或 JSON，成功後自動在文件庫多一筆紀錄
- [x] 匯出的那份文件，自動出現在這則對話的「關聯文件」清單裡（自動
      建立關聯）
- [x] 可以手動從文件庫既有檔案裡挑一個，跟目前這則對話手動建立關聯
      （不透過匯出）
- [x] 「取消關聯」能移除關聯但不影響文件庫裡的檔案本身
- [x] 在文件管理視窗刪除一份文件，對話庫裡任何引用到它的關聯自動消失
      （不會顯示壞掉的引用）
- [x] 備份匯出/匯入包含對話庫資料，已存在 id 略過

---

## Stage 10：專案計畫進階功能（月曆／甘特圖／Issue 管理／跨專案總覽）

### 目標
把「專案計畫管理」從單純的任務清單，擴充成含時間軸視覺化跟問題追蹤的
完整專案工具。

### 前置需求
Stage 7 完成（`projects.json`、`project.html` 既有任務清單）。

### 交付項目
- `main.js`：task 新增 `startDate` 欄位；`project.issues` 陣列（`id`/
  `title`/`description`/`type`/`priority`/`status`/`assigneeId`/
  `dueDate`/`tags`）；IPC 新增 `projects:issue:setStatus`
- `renderer/project.html/js/css` 大改版：
  - 編輯畫面下方四個分頁：任務清單／月曆／甘特圖／Issue 管理
  - 月曆：依 `dueDate` 把任務（依狀態上色）跟 issue（依優先度上色）畫
    成月曆格子上的色點，點一天看當天明細，可切換月份
  - 甘特圖：純 CSS/DOM 畫的橫向時間軸，用 `startDate`/`dueDate` 定位
    色塊，標月份分界跟「今天」豎線，沒有任何任務帶日期時顯示提示文字
  - Issue 管理：行內可編輯卡片（跟任務清單同個操作模式），可依狀態
    篩選，狀態切換即時持久化
  - 「跨專案總覽」：把所有專案的月曆/甘特圖/Issue 疊在一起看的唯讀
    彙總畫面，每個專案固定配色，點圖例/任一項目可跳回該專案編輯畫面
- 備份匯出/匯入涵蓋 `issues`（沿用既有 `projects` 備份，一起打包）

### 檢核表
- [x] 任務清單新增「開始日期」欄位，跟原本的「到期日」並存
- [x] 月曆分頁能看到當月每天的任務/issue 到期狀況，點某天能看明細
- [x] 甘特圖分頁能看到有日期的任務畫成橫向色塊，顏色對應任務狀態
- [x] 沒有任何任務有日期時，甘特圖顯示提示文字而不是空白
- [x] Issue 管理分頁可以新增/編輯/刪除 issue，欄位包含類型/優先度/狀態/
      指派/到期日/標籤
- [x] Issue 狀態切換不用按儲存就立即持久化
- [x] 左側專案清單顯示每個專案「待處理+處理中」的 issue 數量
- [x] 跨專案總覽能看到所有專案疊在一起的月曆/甘特圖/Issue，每個專案
      顏色不同
- [x] 在總覽點某個專案的項目，能跳回該專案編輯畫面並切到對應分頁

> ⚠️ 這個階段的 UI 互動邏輯較複雜（多分頁狀態切換、月曆/甘特圖的日期
> 運算），特別需要 Stage 總覽提到的「實際 `npm start` 手動驗證」，目前
> 只做過程式邏輯層面的檢查。

---

## Stage 11：日誌主控台（錯誤日誌／稽核日誌／即時主控台）

### 目標
提供一個集中的地方查看「App 內部發生了什麼事」：結構化的錯誤/稽核紀錄
（會落地存檔），加上即時的原始 console 輸出（只存在記憶體，App 關掉
就沒了），特別是要能診斷「AI 平台對話擷取/匯出失敗」這種常見問題。

### 前置需求
Stage 1～10 完成（需要 `openChildWindow` helper；沿用第 12 節
`extractors/domCapture.js` 的擷取機制）。

### 交付項目
- `main.js`：`logError(scope, message, err)`/`logAudit(category, action,
  detail)`（Stage 13 之後改存 SQLite，見下）；全域
  `process.on('uncaughtException'/'unhandledRejection')`；既有的
  `console.error` 錯誤點（擴充功能載入失敗、對話擷取/選取器失敗、文件
  匯入/刪除失敗）都改接 `logError`；帳號新增/移除、專案建立/刪除、文件
  匯入/刪除、對話新增/刪除/匯出/匯出失敗、備份匯出/匯入、設定檔搬遷、
  擴充功能安裝/移除都加上 `logAudit`
  - `extractors/domCapture.js` 回傳結果一律帶 `debug: { selectorUsed,
    matchedNodeCount, nonEmptyMessageCount, pageUrl }`，`main.js` 每次
    擷取都印一行診斷到主控台，失敗時的提示視窗也直接顯示這組數字
  - `createAccountView()` 幫每個帳號的 `WebContentsView` 接
    `did-fail-load`/`console-message`，轉送進即時主控台
  - 主控台：攔截 `console.log/info/warn/error`，存進記憶體環狀緩衝區
    （上限 300 筆），即時廣播 `console:entry` 事件；IPC：`console:list`/
    `console:clear`
  - `openLogWindow()`；IPC：`logs:list`/`logs:clear`/`logs:export`
- `renderer/log.html/js/css`：三個分頁——錯誤日誌（依來源篩選+關鍵字
  搜尋，堆疊可展開）、稽核日誌（依類別篩選+關鍵字搜尋）、主控台（終端機
  風格即時輸出，自動捲動開關、清除按鈕）；「匯出日誌」存成 JSON 檔
- 側邊欄「內容工具」群組新增「日誌主控台」按鈕
- `renderer/settings.html/js`：疑難排解區塊新增「清除快取」按鈕（只清
  HTTP 快取，不登出帳號）

### 檢核表
- [x] 觸發一個已知會失敗的動作（例如在空白頁面匯出對話），錯誤日誌
      分頁能看到對應紀錄
- [x] 帳號新增/刪除、文件匯入/刪除、備份匯出等動作，稽核日誌分頁都有
      對應紀錄，`detail` 是人看得懂的中文說明
- [x] 主控台分頁能看到即時的 console 輸出，包含每次對話擷取的診斷數字
      （matched 節點數/有內容的訊息數）
- [x] 對話擷取失敗時，彈出的提示視窗直接顯示這組診斷數字，不用特地開
      日誌視窗
- [x] 錯誤/稽核日誌都可以依關鍵字搜尋、依來源/類別篩選
- [x] 「清除錯誤日誌」「清除稽核日誌」「清除主控台」都能個別動作，
      互不影響
- [x] 「匯出日誌」能存出一份包含目前所有錯誤/稽核紀錄的 JSON 檔
- [x] 設定裡「清除快取」點下去不會登出任何帳號、不會刪除文件/專案/
      對話資料

---

## Stage 12：App 穩定性修正（單一實例鎖、快取損毀成因、打包設定漏洞）

### 目標
修正三個會實際影響使用體驗、但不是「新功能」而是「既有邏輯有隱患」的
問題：啟動時的 Chromium 快取錯誤、`app.exit()` 造成的資料庫損毀風險、
打包設定漏掉 `lib/` 資料夾。

### 前置需求
Stage 1～11 完成。

### 交付項目
- `main.js`：`app.requestSingleInstanceLock()` + `second-instance` 事件
  （focus 既有視窗，不開第二個進程搶同一份 userData 快取）
- `settings:chooseDataDir`/`settings:resetDataDir` 的「立即重新啟動」
  流程，把 `app.exit()`（強制終止，跳過收尾）改成 `app.quit()`（正常
  關閉流程），避免 Chromium 磁碟快取/quota 資料庫在強制終止時沒正常
  關閉、留下髒狀態
- `package.json` 的 `build.files` 補上 `"lib/**/*"`（原本漏掉，`main.js`
  用 `require('./lib/utils')` 卻沒被打包進最終成品，理論上會讓打包版
  一啟動就崩潰）

### 檢核表
- [x] 同時開兩次 App，第二次會自動退出並把第一個視窗 focus 到最前面，
      不會真的開出兩個視窗
- [x] 設定裡切換/還原設定檔存放位置，重啟流程改用 `app.quit()`
- [x] `package.json` 的 `build.files` 陣列包含 `lib/**/*`
- [ ] **待手動驗證**：實際跑一次 `npm run build:dir`，確認打包出來的
      成品可以正常啟動（這個修正的價值就是要防止打包版崩潰，所以最終
      一定要拿真的打包產物驗證過，不能只看程式碼邏輯）

---

## Stage 13：日誌主控台改用 SQLite（sql.js）

### 目標
把日誌主控台的資料層從 JSON 檔換成真正的 SQLite 資料庫，作為這個專案
第一個 SQLite 應用範例；技術選型（sql.js vs better-sqlite3）的完整取捨
說明見 `PROJECT_SPEC.md` 第 9.7 節。

### 前置需求
Stage 11 完成（日誌主控台既有的 `logError`/`logAudit`/IPC 介面）。

### 交付項目
- 新增 `sql.js` npm 依賴（純 WebAssembly，沒有原生模組，不需要
  `electron-rebuild`）
- 新增 `lib/sqlite.js`：`openDatabaseFile()`/`saveDatabaseFile()`/
  `queryAll()` 最小包裝
- `main.js`：`initLogsDatabase()`（app 啟動時建表）、`errors`/`audits`
  兩張表取代原本的 JSON 陣列、`trimLogTable()`（SQL `DELETE ... ORDER
  BY timestamp DESC LIMIT 500`）、`migrateLegacyJsonLogsIfNeeded()`
  （偵測舊版 `logs.json`、資料庫是空的才搬遷，搬完舊檔改名
  `.migrated`）；`app.on('before-quit')` 補存檔當保險
- `package.json`：`build.files` 排除 `node_modules/sql.js/dist/` 裡
  asm.js/worker/browser 變體跟壓縮包，減少打包體積
- `test/sqlite.test.js`：開檔建表、寫入、裁剪、清除、重開後資料還在、
  舊版 JSON 搬遷共 5 項測試

### 檢核表
- [x] `npm install` 後 `npm test` 全部通過（含新增的 5 項 SQLite 測試）
- [x] 手動放一份舊版 `logs.json` 到 DATA_DIR，重啟後資料正確搬進
      `logs.sqlite`，舊檔被改名成 `.migrated`
- [x] 日誌主控台畫面的所有既有功能（篩選/搜尋/清除/匯出）行為不變，
      使用者感覺不出資料層換過
- [x] 寫入超過 500 筆錯誤/稽核紀錄後，資料庫裡確實只留最新 500 筆
- [ ] **待手動驗證**：實際在 Electron 環境跑一次（`npm start`），確認
      `require('sql.js')` 在 Electron 的 main process 裡真的能正常
      初始化 WASM 模組（目前只在純 Node.js 環境測試過，理論上 Electron
      main process 也是 Node.js 環境所以應該沒問題，但沒有實機驗證過）

---

## Stage 14：知識庫／對話庫新增「匯入 Markdown 檔案」

### 目標
讓知識庫（提示詞項目）跟對話庫都能直接匯入現成的 `.md` 檔案（例如
之前用其他工具匯出的對話紀錄），不用手動複製貼上內容，匯入完可以直接
在既有編輯器裡檢視/編輯。

### 前置需求
Stage 5（知識庫）、Stage 9（對話庫）完成。

### 交付項目
- `main.js`：`knowledge:importMarkdown`、`conversations:importMarkdown`
  兩個 IPC handler——都用 `dialog.showOpenDialog({ properties: ['openFile',
  'multiSelections'], filters: [{ extensions: ['md','markdown','txt'] }]
  })` 可一次多選，每個檔案讀成一筆新項目（檔名去掉副檔名當標題，檔案
  全文塞進 `content`），直接存檔（不像「擷取目前對話」是先預填編輯器
  等使用者確認），回傳 `{ kb/conversations, importedIds }`；失敗的檔案
  各自 `logError`，成功至少一個檔案就記一筆 `logAudit`
- `preload.js`：曝露 `importKnowledgeMarkdown`、
  `importConversationMarkdown`
- `renderer/knowledge.html/js`：提示詞分頁新增「匯入 Markdown」按鈕
  （跟「新增項目」同一排，切到套餐分頁時隱藏，比照 `btnNewItem` 的
  顯示邏輯）；匯入完自動 `selectItem()` 打開最後一個匯入的項目
- `renderer/conversation.html/js`：新增「匯入 Markdown 檔案」按鈕；匯入
  完自動 `selectConversation()` 打開最後一個匯入的對話
- 這個功能跟既有的「匯入」（`btn-import`，知識庫 JSON 備份格式）是兩個
  完全獨立的按鈕/IPC，處理不同的檔案格式，UI 上不要合併成一個按鈕

### 檢核表
- [x] 知識庫「提示詞」分頁能看到「匯入 Markdown」按鈕，切到「套餐」
      分頁時按鈕隱藏
- [x] 選一個 `.md` 檔案匯入，清單裡多一筆項目，標題是檔名（不含副檔名），
      內容是檔案全文，且匯入完自動打開這筆項目的編輯器
- [x] 一次多選 3 個 `.md` 檔案匯入，清單裡多 3 筆項目，自動打開的是
      最後一個
- [x] 對話庫「匯入 Markdown 檔案」按鈕同樣支援多選、標題/內容規則相同、
      匯入完自動打開最後一個
- [x] 匯入的對話一樣可以正常「匯出檔案」「關聯文件庫檔案」，跟手動
      新增/擷取的對話沒有差別
- [x] 選取一個非 UTF-8 編碼或內容包含奇怪字元的檔案匯入失敗時，不會讓
      整個匯入動作卡死，其他成功匯入的檔案照樣正常寫入，失敗的那個
      記錄進錯誤日誌

> ⚠️ 跟其他 Stage 9～13 一樣，這個階段也還沒有在真正的 Electron 環境
> 手動驗證過。

---

## Stage 15：App 版本號顯示 + 安裝程式預設路徑改到應用程式資料夾

### 目標
兩件小事但都跟「使用者實際感受到的體驗」有關：畫面上要看得到目前是
第幾版（回報問題時才問得出來），Windows 安裝程式預設路徑改成不用
系統管理員權限的使用者 AppData 資料夾。

### 前置需求
Stage 1～14 完成。

### 交付項目
- `main.js`：新增 `app:getVersion` IPC，回傳 `app.getVersion()`
  （直接讀 `package.json` 的 `version`，不用自己手動維護一份）
- `preload.js`：曝露 `getAppVersion`
- `renderer/index.html`：側邊欄「設定」按鈕下方新增 `#app-version-label`
  （極小字級，側邊欄摺疊成純 icon 版時隱藏）
- `renderer/renderer.js`：初始化時抓版本號填進 `#app-version-label`
- `renderer/settings.html/js`：新增「關於」區塊（第 9 項，`settings.
  about.title`/`settings.about.version`），語言切換時（`i18n:updated`
  事件）重新套用版本號文字格式
- `package.json`：新增 `build.nsis` 設定——
  `perMachine: false`（預設安裝到 `%LOCALAPPDATA%\Programs\Platter`，
  不需要系統管理員權限）、`oneClick: false`（顯示正常安裝精靈，不是
  靜默一鍵安裝）、`allowToChangeInstallationDirectory: true`（使用者
  仍然可以自己改路徑）、桌面/開始選單捷徑設定

### 檢核表
- [x] 主視窗側邊欄「設定」按鈕下方能看到一行小小的版本號文字
      （`v1.14.0` 這種格式）
- [x] 側邊欄摺疊成純 icon 版時，版本號文字跟著隱藏，不會擠版面
- [x] 設定視窗最下面「關於」區塊能看到完整版本號文字
- [x] 切換語言後，「關於」區塊的版本號文字格式跟著language切換（不是
      卡在舊語言的格式不動）
- [x] `package.json` 的 `build.nsis.perMachine` 是 `false`
- [ ] **待手動驗證**：實際在 Windows 上跑一次 `npm run build:win`，
      安裝時確認精靈預設顯示的安裝路徑是 `%LOCALAPPDATA%\Programs\
      Platter`（不是 `C:\Program Files\Platter`），而且不需要 UAC
      系統管理員權限提示就能完成安裝

---

## Stage 16：帳號清單拖曳排序

### 目標
讓使用者可以自己決定側邊欄帳號清單的顯示順序，不用被迫照新增順序排。

### 前置需求
Stage 2（帳號管理三視窗化 + 持久化）完成。

### 交付項目
- `main.js`：新增 `accounts:reorder` IPC——接收前端算好的新順序（完整
  帳號 id 陣列），用 Map 查表重組 `appState.accounts`，找不到對應帳號的
  id 忽略；反過來如果 `appState.accounts` 有帳號沒出現在傳入的順序裡
  （理論上不該發生），原樣接在最後面防止憑空遺失，`saveAppState()` +
  廣播 `accounts:changed`
- `preload.js`：曝露 `reorderAccounts(orderedIds)`
- `renderer/renderer.js`：每個帳號項目 `draggable="true"`，原生 HTML5
  drag & drop（`dragstart`/`dragover`/`dragleave`/`drop`/`dragend`），
  不引入額外套件；角色下拉選單、刪除按鈕設 `draggable="false"` 避免
  誤觸
- `renderer/index.html`：新增 `.account-item.dragging`（半透明）、
  `.account-item.drag-over`（頂部藍色邊框標示插入位置）樣式

### 檢核表
- [x] 用滑鼠拖曳某個帳號項目到另一個位置放開，清單順序照預期改變
- [x] 拖曳過程中，滑鼠懸停的目標項目有明顯的視覺提示（頂部邊框）
- [x] 拖曳中的項目本身呈現半透明樣式
- [x] 重新排序後重開 App，順序有記住（寫進 `app-state.json`）
- [x] 拖曳排序不影響帳號的角色指派、目前作用中帳號、側邊欄「預設
      提示詞」等其他依賴帳號資料的功能（這些都是用 id 查找，不依賴
      陣列順序）
- [x] 在角色下拉選單或刪除按鈕上點擊/操作，不會被誤判成拖曳排序

> ⚠️ 跟其他 Stage 9～15 一樣，這個階段也還沒有在真正的 Electron 環境
> 手動驗證過。

---

## 完成後的整體驗收（跑完全部 16 階段之後）

- [x] 對照 `PROJECT_SPEC.md` 逐節檢查，沒有遺漏的功能
- [ ] `npm run build:dir` 能成功產生免安裝版本，實際執行不 crash——
      **Stage 9～16 都還沒實際跑過這一項**，加入 `sql.js` 依賴、修正
      `build.files` 之後尤其需要重新驗證一次（見 Stage 12/13 的「待手動
      驗證」項目）
- [x] 三個核心原則（不呼叫未公開 API／不繞過保護機制／不打包登入憑證）
      在程式碼裡沒有任何違反的地方——特別檢查備份匯出/匯入、文件庫、
      知識庫匯出、對話庫匯出這幾個「打包資料」的路徑
- [ ] 語言切換在所有 8 個視窗（主視窗/新增帳號/知識庫/設定/虛擬團隊/
      專案計畫/文件管理/對話庫/日誌主控台）都正確套用——對話庫、日誌
      主控台是 Stage 9、11 新增的視窗，還沒實際切換語言驗證過
- [ ] **待手動驗證**：`npm install` 後 `npm start`，把 Stage 9～16 的
      檢核表項目逐一實際操作一遍（月曆/甘特圖互動、跨專案總覽跳轉、
      日誌主控台三個分頁、對話庫的擷取/匯出/關聯流程），開發過程只做過
      `node --check` 語法檢查跟邏輯層面的單元測試，沒有在真正的 Electron
      視窗環境操作過
