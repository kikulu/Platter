# PROJECT_SPEC.md — AI Workspace Aggregator 完整專案規格

> 本文件整理 AI Workspace Aggregator 的**完整、最新**規格，涵蓋從初版到目前為止
> 逐輪加入的所有功能。可直接複製貼給任何 LLM（Claude / GPT / Cursor 等）或開發
> 團隊，重新產生這整個專案；也可搭配同目錄下的 `BUILD_PLAN.md` 分 8 個階段、
> 用檢核表逐步實作與驗收。

---

## 1. 專案目標

開發一款基於 **Electron** 的桌面應用程式，讓使用者能在同一個視窗內：

1. 透過左側側邊欄（多層可收合清單）切換管理多個 AI 平台（Claude、ChatGPT、
   Gemini、Grok）的不同帳號，每個帳號擁有完全獨立的登入狀態（Session
   Isolation）。
2. 為每個帳號指定一個「角色」（職務／人設），角色可配置專屬的預設提示詞。
3. 手動觸發、擷取畫面上目前可見對話，存成 Markdown 或 JSON。
4. 維護一個知識庫：一般提示詞項目、群組順序提示詞套餐、檢核表機制。
5. 用「虛擬團隊主控台」把帳號依角色組織成團隊組織圖，並在「專案計畫管理」
   裡建立專案、拆分任務、指派給團隊裡的帳號、追蹤進度。
6. 用「文件管理」統一保存對話匯出的檔案與手動匯入的任意檔案。

技術棧：Electron（主框架，`WebContentsView`，Electron 30+）、原生
JavaScript / HTML / CSS（不使用 React/Vue，保持輕量），`electron-builder`
負責打包。

---

## 2. 核心原則（重要，影響所有設計決策）

1. **不呼叫任何平台的未公開／內部 API**（例如 `/api/organizations`、
   `/backend-api/conversations` 這類端點），不做延遲規避風控偵測的自動化
   行為，不解析或轉發使用者的登入 Bearer Token。對話匯出必須靠「讀取當前
   畫面上已經渲染出來的 DOM 內容」，效果等同使用者手動框選複製。
2. **不做任何繞過網站保護機制的事**，例如不寫程式自動下載/解壓 Chrome
   線上應用程式商店的 `.crx`、不修改/剝除第三方網站的安全性標頭（例如
   `X-Frame-Options`）來達成內嵌。
3. **不把使用者的登入憑證（cookie/localStorage/session token）打包進任何
   可攜式的備份/匯出/文件庫檔案**——那些東西只留在 Electron 自己管理、跟
   系統帳號綁定的 session partition 儲存位置。備份、知識庫、專案、文件庫
   等所有可攜資料，只存「中繼資料」與「使用者自己產生的內容」，不涉及
   任何登入態。

---

## 3. 核心架構需求

### 3.1 UI 佈局

- 主視窗左側是側邊欄，展開時寬度約 220px，可摺疊成 56px 的純 icon 版。
- **側邊欄採多層可收合清單**（群組標題 + 子項目），由上到下：
  1. 標題列（App 名稱 + 摺疊按鈕）
  2. 群組「帳號」👤：新增帳號、帳號清單（可捲動）
  3. 群組「預設提示詞」💡：依「目前選中帳號」的角色，列出知識庫裡配置給
     該角色的所有提示詞，每則旁邊有複製按鈕
  4. 群組「內容工具」🧰：匯出當前對話、知識庫、文件管理、對話庫、
     日誌主控台
  5. 群組「團隊與專案」🧩：虛擬團隊、專案計畫
  6. 「設定」⚙️ 固定在最底部，不屬於任何可收合群組；下方再加一行極小的
     版本號文字（`v{package.json 的 version}`，透過 `app:getVersion`
     IPC 讀 `app.getVersion()`），側邊欄摺疊成純 icon 版時這行版本號
     跟著隱藏
- 每個群組標題可點擊展開/收合（chevron 圖示 ▸/▾ 跟著轉向），展開狀態存進
  `app-state.json`（`ui.sidebarGroups`），重開程式記住上次狀態。
- 整個側邊欄摺疊成 56px 純 icon 版時，**忽略**各群組展開/收合狀態，一律
  攤平顯示成單層 icon 列表（含群組內的按鈕與帳號頭像），維持緊湊操作。
- 右側主畫面顯示目前選中帳號的網頁介面。**這不是 `<iframe>` 或
  `<webview>`**，而是主程序建立的 `WebContentsView`（Electron 30+ API，
  取代舊版 `BrowserView`）疊加在視窗上面，透過 `setBounds()` 定位、
  `setVisible()` 切換顯示。

### 3.2 Session 隔離（帳號管理的核心）

- 每個帳號用 `session.fromPartition('persist:<accountId>')` 建立獨立
  partition，Cookie / LocalStorage / IndexedDB 完全隔離。`persist:` 前綴
  讓 Electron 把這個 partition 的資料寫到磁碟，重開程式後用**同一個
  accountId**（因此同一個 partition 名稱）重建 `WebContentsView`，就能自動
  接回原本已登入的 session，不需要重新登入。
- 新增帳號：建立獨立 partition 的 `WebContentsView`，`mainWindow.contentView
.addChildView(view)` 掛進主視窗，`loadURL()` 載入對應平台網址
  （`https://claude.ai`、`https://chatgpt.com`、`https://gemini.google.com`、
  `https://grok.com`）。
- 切換帳號：不銷毀任何 view，只是 `setVisible(true/false)` 切換顯示狀態，
  達成毫秒級無縫切換。
- 刪除帳號：滑鼠移到帳號清單項目上，最右側浮現垃圾桶 icon（平常隱藏），
  點下去跳確認對話框（訊息帶出帳號名稱），確認後 `removeChildView()` +
  `session.clearStorageData()` 清乾淨；同時清掉任何套餐（知識庫）裡引用到
  這個帳號的地方（目前套餐不直接引用帳號，僅專案任務的 `assigneeId` 會
  留下懸空引用——刪除帳號時不強制清理任務指派，UI 顯示為「未指派」即可）。
- **帳號清單排序**：每個帳號項目 `draggable="true"`，用原生 HTML5
  drag & drop（`dragstart`/`dragover`/`drop`/`dragend`），不引入額外
  拖曳排序套件。拖曳邏輯：
  1. `dragstart` 記住正在拖的帳號 id（存在模組層的閉包變數，不依賴
     `dataTransfer.getData()`，避免部分瀏覽器在 `dragover` 階段讀不到
     資料的相容性問題）。
  2. `dragover` 時如果目前懸停的項目不是自己，用 `.drag-over` 樣式
     （內縮的頂部藍色邊框）標示「放開後會插入到這個位置」。
  3. `drop` 時算出拖曳來源在目前清單裡的 index 跟放開目標的 index，用
     `splice` 重組一份新的 id 順序陣列，整份傳給 `accounts:reorder`
     IPC；main process 依這份新順序重組 `appState.accounts`（用 id 對照
     查表，找不到對應帳號的 id 會被忽略；反過來說，如果 `appState.
accounts` 裡有某個帳號沒出現在傳進來的順序清單裡——理論上不該
     發生——會被原樣接在最後面，不會憑空遺失帳號)，存檔並廣播
     `accounts:changed`。
  4. 側邊欄的「新增帳號」下拉選單、知識庫「依角色列出提示詞」這些功能
     都不依賴帳號在陣列裡的順序（用 id 查找），重新排序不影響其他功能。
  5. 角色下拉選單（`role-select`）跟刪除按鈕都設定 `draggable="false"`，
     避免使用者點擊這些控制項時被誤判成拖曳排序的起手勢。

### 3.3 帳號清單持久化

- 帳號清單的中繼資料（`id`、`platform`、`name`、`roleId`——**不含** cookie
  等實際登入資料）寫進設定檔（`app-state.json`）。開機時讀回來，用相同的
  id 依序重建每個帳號的 `WebContentsView`——**陣列順序就是使用者排序過的
  顯示順序**，拖曳排序本質上就是在改這個陣列的順序。

---

## 4. 帳號角色機制

- 角色是**可重複套用到多個帳號**的共用定義：
  `{ id, name, description, color, createdAt, updatedAt }`。
  `description` 可當成角色提示詞／system prompt 使用；`color` 是預先定義的
  8 色色票之一（`#4f8cff #e5484d #f5a623 #2ecc71 #9b59b6 #1abc9c #e91e8c
#95a5a6`）。
- 存在 `app-state.json` 的 `roles: []`。
- 帳號物件新增 `roleId`（可為 `null`）。
- **管理位置**：設定視窗「帳號角色管理」區塊——新增/編輯/刪除角色、色票
  選色、「複製提示詞」一鍵複製角色描述到剪貼簿。
- **套用位置**：
  - 新增帳號視窗（`account.html`）的「角色（可選）」下拉選單。
  - 側邊欄帳號項目內嵌一個小型角色下拉選單，不用開設定視窗就能直接切換/
    移除帳號的角色；頭像用角色顏色描邊識別。
  - 虛擬團隊主控台（見第 6 節）。
- 角色被刪除時：
  1. 原本套用它的帳號自動改回「無角色」。
  2. 知識庫項目裡對這個角色的「角色配置」（見第 5.4 節）引用一併移除。
  3. 不留下任何懸空 id。
- 備份與還原同步支援角色資料，匯入時已存在的角色 id 略過。

---

## 5. 知識庫（`knowledge.html`）

知識庫視窗採「提示詞 / 套餐」兩分頁設計，資料檔 `knowledge-base.json`：

```json
{ "items": [ ... ], "groups": [ ... ] }
```

### 5.1 提示詞項目（items）

```
{ id, title, content, tags: string[],
  checklist: [{ id, text, checked }],
  roleIds: string[],
  createdAt, updatedAt }
```

- 兩欄式版面：左邊項目清單（含標籤篩選下拉選單）+ 匯出全部/匯入按鈕，
  右邊編輯表單（名稱、標籤（逗號分隔）、內容 textarea）。
- 「複製內容」用瀏覽器原生 `navigator.clipboard.writeText()`。
- 標籤篩選：從目前所有項目的標籤動態組出下拉選單選項，選了就在記憶體裡
  篩選清單（不用重打 IPC）。
- **全文搜尋**：工具列的搜尋框即時（`input` 事件，不用按 Enter）在記憶體
  裡篩選清單，跟標籤篩選是 AND 關係（可以同時用）。提示詞項目比對標題／
  內容／標籤；套餐額外比對說明，以及**套餐裡任一步驟引用的提示詞標題**
  （方便直接搜「這個提示詞被用在哪些套餐裡」，不用逐一點開套餐檢查
  步驟）。篩選後完全沒有符合的項目時，清單區塊顯示「沒有符合搜尋條件的
  項目」，跟「這個分頁本來就還沒建立任何項目/套餐」的空狀態提示分開，
  避免使用者誤以為是清單本身是空的。
- 「匯入」按鈕匯入的是完整的知識庫 JSON 備份格式（`{items, groups}`，
  沿用 Stage 5 原始設計）；「匯入 Markdown」是另一個按鈕，只在「提示詞」
  分頁顯示，可一次多選任意 `.md`/`.markdown`/`.txt` 檔案，逐一讀成新的
  提示詞項目（檔名去掉副檔名當標題，檔案全文塞進 `content`，`tags`/
  `checklist`/`roleIds` 都是空的），匯入完自動把最後一個匯入的項目打開
  在編輯器裡，方便馬上檢視/編輯內容，不用另外手動點開。這兩個「匯入」
  按鈕處理的是完全不同的檔案格式，不要搞混。

### 5.2 檢核表機制（單一項目自帶）

- 每個提示詞項目可選擇附帶一份獨立檢核表（例如「發布前檢查清單」）。
- 編輯器裡的「檢核表」區塊：可新增/勾選/移除檢核項目，隨項目一起儲存
  （記憶體內編輯，按「儲存」才寫入）。

### 5.3 群組順序提示詞套餐（groups）

```
{ id, title, description, tags: string[],
  steps: [{ id, itemId, checked }],
  createdAt, updatedAt }
```

- 「套餐」分頁：把多個已存在的提示詞項目依指定順序組成一個套餐。
- 套餐編輯器：名稱、標籤、說明、步驟清單（可用 ↑↓ 調整順序、單步複製、
  移除、透過下拉選單加入新步驟）。
- **檢核表機制第二種應用**：每個步驟都有一個勾選框，追蹤「這個步驟是否
  已經使用/完成」，勾選狀態即時透過 IPC（`knowledge:group:toggleStep`）
  持久化，不用等按「儲存套餐」；「重置進度」可一次清空整份套餐的勾選
  狀態。結構性變更（新增/移除/重排步驟、編輯標題說明）才需要按「儲存
  套餐」。
- 「複製全部內容」依序把所有步驟的提示詞內容串接起來（用 `---` 分隔）。

### 5.4 角色配置（提示詞 ↔ 角色 多對多）

- 提示詞項目編輯器新增「角色配置」區塊：勾選框列出所有已建立的角色
  （沿用第 4 節的角色機制），可複選。
- 一個提示詞可以同時配置給多個角色；一個角色也可以配置多組預設提示詞。
- 存在 `item.roleIds`。
- 每次知識庫項目/套餐異動（新增、編輯、刪除、匯入）都會廣播
  `knowledge:changed` 事件，讓側邊欄「預設提示詞」區塊（見第 3.1 節、
  第 8 節）即時刷新。

### 5.5 項目刪除的連動清理

- 項目被刪除時，任何套餐裡引用到這個項目的步驟一併移除，避免懸空引用。

### 5.6 匯出／匯入

- 匯出：存檔對話框可選 **Markdown**（項目用 `##` 標題、標籤顯示成
  `#tag1 #tag2`、檢核表用 `- [x]/[ ]` 條列；套餐額外標示 `📦 套餐：`、
  步驟依序條列並標示完成狀態；項目間用 `---` 分隔）或 **JSON**（結構化，
  給匯入用，包含完整 `items`/`groups`）。
- 匯入：只接受 JSON。項目重新產生 id（避免撞號），`roleIds` **不**帶入
  來源檔案的角色配置（角色是各安裝環境自己的資料）；套餐的 `steps.itemId`
  依新舊 id 對照表自動轉換，找不到對照的步驟捨棄。全部附加到現有清單
  後面，不覆蓋既有項目。

---

## 6. 虛擬團隊主控台（`team.html`）

- 側邊欄「團隊與專案」群組開啟，是一個**視覺化 + 快速操作**的視窗，資料
  完全沿用帳號與角色機制，不另外建立資料檔。
- 版面：頂端「虛擬團隊」根節點 → 一排角色欄位（依顏色標示）→ 每欄底下是
  套用該角色的帳號卡片；沒有角色的帳號歸在「未指派角色」欄位。
- 每張帳號卡片內嵌角色下拉選單，可直接在主控台重新指派角色（呼叫
  `accounts:setRole`），不用另外開設定視窗。
- 提供「新增帳號」「管理角色」快捷按鈕（後者開啟設定視窗）。

---

## 7. 專案計畫管理（`project.html`）

資料檔 `projects.json`：

```json
{ "projects": [ {
  "id", "name", "description",
  "status": "planning|active|onhold|done",
  "startDate", "endDate",
  "tasks": [ { "id", "title", "description", "assigneeId",
               "status": "todo|doing|done", "startDate", "dueDate" } ],
  "issues": [ { "id", "title", "description",
                "type": "bug|feature|task|improvement",
                "priority": "low|medium|high|urgent",
                "status": "open|inprogress|resolved|closed",
                "assigneeId", "dueDate", "tags": ["..."] } ],
  "createdAt", "updatedAt"
} ] }
```

- 左側專案清單（狀態徽章 + 任務完成度 `done/total` + 未結案 issue 數量
  🐞）、右側編輯表單：名稱、狀態（規劃中/進行中/暫停/已完成）、起訖日期、
  說明。
- 編輯表單下方是「任務清單 / 月曆 / 甘特圖 / Issue 管理」四個分頁，共用
  同一份 `editingTasks`/`editingIssues` 記憶體狀態，切分頁不會遺失還沒
  儲存的編輯內容；月曆、甘特圖都是純前端即時運算，不另外存衍生資料。

### 7.1 任務清單

- 可新增（輸入框 + Enter）、行內編輯標題、指派給「虛擬團隊」裡的任何
  帳號（下拉選單）、狀態（待辦/進行中/已完成）、**開始日期**與**到期日**
  兩個日期欄位、移除。
- 任務狀態切換即時透過 `projects:task:setStatus` 持久化，不用等按
  「儲存專案」；結構性變更（新增/移除/編輯任務內容、日期）才需要按
  「儲存專案」。

### 7.2 月曆檢視

- 月曆格子上用小圓點標示當天「到期」的任務（顏色對應任務狀態）與 Issue
  （顏色對應優先度），超過 4 個項目用 `+N` 縮寫；今天用強調色外框標示。
- 上方「‹ › 回到今天」切換月份；點任一天格子，下方會列出當天所有到期
  項目的明細（圖示 + 標題）。
- 資料來源單純是 `editingTasks`/`editingIssues` 裡 `dueDate` 對到當天
  日期字串（`YYYY-MM-DD`，一律用本地日期，不用 `toISOString()` 避免時區
  位移），不需要開始日期。

### 7.3 甘特圖

- 只取「有開始日期或到期日」的任務畫成橫向色塊：只有到期日視為當天
  一天的任務、只有開始日期視為當天一天、兩者都有則畫成一段區間；色塊
  顏色對應任務狀態（待辦/進行中/已完成）。
- 時間軸範圍 = 所有色塊裡最早的開始日往前一天 ~ 最晚的到期日往後一天，
  用百分比定位（`left`/`width`）畫在一條 `.gantt-track` 上；表頭標出每個
  月份的分界；有一條紅色「今天」豎線（若今天落在時間軸範圍內）。
- 沒有任何任務帶日期時顯示提示文字，引導使用者去任務清單加上日期。
- 這是純 CSS/DOM 畫的簡易甘特圖，沒有引入額外圖表函式庫，也不支援拖曳
  調整日期（要改日期還是回任務清單分頁改）。

### 7.4 Issue 管理

- 每個專案有自己獨立的 issue 清單（不是全域共用），欄位：標題、描述
  （選填）、類型（🐞錯誤／✨功能／📋任務／🔧改善）、優先度（低/中/高/
  緊急）、狀態（待處理/處理中/已解決/已關閉）、指派對象（虛擬團隊帳號）、
  到期日、標籤（逗號分隔）。
- 「＋新增 Issue」在清單最下面加一張空白卡片並把游標移過去；每張卡片
  都是行內可編輯（跟任務清單一樣的模式，不用另開視窗/對話框）。
- 上方下拉選單可依狀態篩選（全部/待處理/處理中/已解決/已關閉）。
- Issue 狀態切換即時透過 `projects:issue:setStatus` 持久化，其餘欄位
  變更（標題/描述/類型/優先度/指派/到期日/標籤）跟任務一樣要按「儲存
  專案」才會寫檔。
- 左側專案清單會顯示這個專案「待處理 + 處理中」的 issue 數量（🐞
  數字），方便一眼看出哪個專案還有沒處理完的問題。

### 7.5 跨專案總覽

側邊列表工具列多一個「跨專案總覽」按鈕（跟「新增專案」並排），點下去會
把右側從單一專案編輯畫面切成一個**唯讀、把所有專案疊在一起看**的儀表板，
本身也有月曆／甘特圖／Issue 三個分頁（跟第 7.2～7.4 節的單一專案版本邏輯
共用，只是資料來源改成 `allProjects`（所有已存檔的專案）而不是正在編輯
中那一個專案的 `editingTasks`/`editingIssues`）：

- 每個專案依在清單中的順序固定分配一個顏色（8 色循環），畫面最上方有一排
  圖例（色點 + 專案名稱），點圖例上的專案名稱可以直接跳回那個專案的編輯
  畫面。
- 月曆格子的色點、甘特圖色塊的左側色條、Issue 總覽每一行前面的色點都用
  這個顏色標示「這是哪個專案的項目」；滑鼠移上去的 tooltip 會顯示
  「專案名稱：項目標題」。
- 月曆/甘特圖/Issue 清單裡的每一項都可以點擊，會直接跳回該項目所屬的
  專案（自動切到對應分頁：任務相關跳「任務清單」，Issue 跳「Issue
  管理」，甘特圖的列標籤跳「甘特圖」），方便看完全貌後直接鑽進去編輯。
- 這是**純讀取**的彙總畫面，不能在這裡編輯任務/Issue 內容；要編輯還是要
  跳回單一專案畫面。
- 因為資料來源是「已存檔」的 `allProjects`，正在某個專案編輯中但還沒按
  「儲存專案」的變更不會出現在總覽裡。

備份與還原同步支援專案資料（含 `tasks` 與 `issues`），匯入時已存在的
專案 id 略過。

---

## 8. 文件管理（`documents.html`）

資料檔 `documents.json` + 檔案存放資料夾 `documents/`（都在 DATA_DIR
底下，跟著「設定檔存放位置」一起搬移）：

```
{ id, name, tags: string[], notes, filePath, originalName, size,
  managed: boolean, sourceAccountId, sourcePlatform, createdAt }
```

- 兩種收錄方式：
  1. **自動登記**：每次「匯出當前對話」成功後（不論是跳存檔對話框還是
     略過對話框直接存），自動把匯出的檔案登記進文件庫——只記錄路徑引用
     不複製（檔案已經在使用者選擇/預設的位置），帶入來源帳號、平台、
     以平台名稱當標籤，`managed: false`。
  2. **手動匯入**：「匯入檔案」可一次選取多個任意檔案，複製一份到
     `documents/` 資料夾妥善保存，`managed: true`，不受原始檔案被移動/
     刪除影響。
- 每份文件可編輯名稱、標籤、備註；顯示原始檔名、來源（平台+帳號）、
  大小、建立時間、路徑；「開啟檔案」（`shell.openPath`）、「在資料夾中
  顯示」（`shell.showItemInFolder`）。
- 找不到原始檔案時（被移動/刪除）清單與詳細頁都顯示「檔案遺失」警示。
- 移除文件時，若是「已管理」的複本，會另外詢問是否連同實體檔案一起刪除，
  或只移除紀錄保留檔案；移除時也會清掉第 8.5 節「對話庫」裡任何引用到
  這份文件的關聯，避免懸空引用。
- 備份與還原同步支援文件庫中繼資料（已存在的 id 略過）；還原到不同機器/
  資料夾時，「已管理」複本的檔案本體不會被還原（不打包實體檔案，只還原
  紀錄），會顯示為「檔案遺失」，需要重新匯入。

### 8.5 對話庫（`conversation.html`）

資料檔 `conversations.json`：

```json
{ "conversations": [ {
  "id", "title", "tags": ["..."],
  "content": "Markdown 全文",
  "sourceAccountId", "sourcePlatform",
  "linkedDocumentIds": ["doc_xxx", "doc_yyy"],
  "createdAt", "updatedAt"
} ] }
```

- 跟「文件管理」是兩個獨立資料檔：文件庫存的是「檔案」本身（路徑引用或
  管理複本），對話庫存的是「對話內容」本身（Markdown 全文直接存在
  JSON 裡），兩者用 `linkedDocumentIds`（多對多）互相關聯，方便「這則
  對話後來衍生出了哪些文件」這種追蹤。
- **新增對話 Markdown**：
  1. 「新增對話」：空白編輯器，手動輸入標題、標籤、貼上或編寫 Markdown
     內容。
  2. 「擷取目前對話」：重用第 12 節的 DOM 擷取機制
     （`captureCurrentConversation` + `toMarkdown`），把目前作用中帳號
     畫面上的對話轉成 Markdown 直接帶入編輯器（不會立刻寫檔，只是預填
     內容，方便擷取後再編輯、加標籤），同時記住來源帳號/平台。
  3. 「匯入 Markdown 檔案」：跟第 5 節知識庫的「匯入 Markdown」是同一種
     模式——開檔案選取對話框（可多選 `.md`/`.markdown`/`.txt`），每個
     檔案直接變成一則新的對話（檔名去掉副檔名當標題，檔案全文塞進
     `content`，`tags`/`linkedDocumentIds` 都是空的），**不用先預覽、
     直接寫進 `conversations.json`**（這點跟「擷取目前對話」不一樣，
     擷取是先預填編輯器等使用者確認再儲存；匯入檔案因為內容就是使用者
     自己選的既有檔案，直接存檔，匯入完自動把最後一個匯入的項目打開在
     編輯器裡，方便馬上檢視/編輯內容）。
  4. 手動新增/擷取的方式都要按「儲存」才會寫進 `conversations.json`
     （`id` 為空時新增、有值時更新，沿用其他模組的慣例）。
- **匯出檔案**：「匯出檔案」跳存檔對話框（或依設定裡的「使用預設路徑時
  不再詢問」略過對話框），可選 Markdown（直接輸出 `content` 全文）或
  JSON（`{ title, tags, content }`）。匯出成功後：
  1. 自動把匯出的檔案登記進文件庫（沿用第 8 節「自動登記」邏輯，
     `managed: false`，只記錄路徑引用）。
  2. 自動把新登記的文件 id 加進這則對話的 `linkedDocumentIds`——也就是
     「將檔案與文件庫的文件檔案對應關聯」的其中一種來源：由匯出動作
     自動建立關聯。
- **手動關聯文件庫檔案**：編輯器「關聯文件」區塊列出這則對話目前關聯到
  的文件庫檔案（顯示名稱、遺失警示、可「開啟檔案」/「取消關聯」），
  下方下拉選單列出文件庫裡「尚未關聯」的檔案，選好按「關聯」即可手動
  建立多對多關聯，不需要透過匯出這條路徑，例如：對話是使用者自己貼上
  的內容，但想要把它跟之前手動匯入文件庫的某份參考資料連結在一起。
  `linkedDocumentIds` 是由 `conversations:linkDocument`/`unlinkDocument`
  這兩個獨立頻道維護的，跟「編輯標題/標籤/內容 → 按儲存」是分開的操作
  路徑——**`conversations:save` 收到的 payload 沒有帶
  `linkedDocumentIds` 時，一律沿用資料庫裡已經存的版本，不可以預設成
  空陣列去覆蓋**，不然使用者隨便改個標題存檔，剛建立好的文件關聯就會
  消失（1.21.1 修正過的真實 bug，見 `CHANGELOG.md`）。
- 對話被刪除時不影響原本已建立的文件庫紀錄，只是那份文件不再顯示跟這
  則對話的關聯；文件被刪除時，見第 8 節「連動清理」，對話庫裡引用到
  它的關聯會一併移除。
- 備份與還原同步支援對話庫資料（已存在的 id 略過，不覆蓋使用者後續的
  編輯）；`linkedDocumentIds` 若引用到還原環境裡不存在的文件 id，不強制
  清理，畫面上自然當成「關聯的文件已被移除」顯示，不影響其他資料。

---

## 9. 獨立子視窗架構

一開始「新增帳號」「知識庫」「設定」是疊在主視窗裡的 HTML 彈窗，後來發現
**`WebContentsView` 是原生疊層，不受 CSS z-index 控制**，彈窗開著時如果
`WebContentsView` 還顯示著，經常會蓋住彈窗、或在隱藏 `WebContentsView` 之後
沒把鍵盤焦點交還給主視窗，導致「點了沒反應」「打不進字」這類問題。最後改成
**獨立的 `BrowserWindow`**（`parent: mainWindow`，**不要用 `modal: true`**
——modal 視窗會在 OS 層級鎖住主視窗，跟「滑鼠選取 selector」這種需要切回
主視窗互動的功能會衝突），共用同一份 `preload.js`。

目前共有八個獨立子視窗：`account.html`（新增帳號）、`knowledge.html`
（知識庫）、`settings.html`（設定）、`team.html`（虛擬團隊主控台）、
`project.html`（專案計畫管理）、`documents.html`（文件管理）、
`conversation.html`（對話庫）、`log.html`（日誌主控台）。

用一個共用的 `openChildWindow(options)` helper 開窗，避免每個視窗各自
重複一份 `new BrowserWindow(...)` 的邏輯：

```js
function openChildWindow({
  getWindow,
  setWindow,
  htmlFile,
  width,
  height,
  minWidth,
  minHeight,
}) {
  const existing = getWindow();
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return;
  }
  const win = new BrowserWindow({
    width,
    height,
    minWidth: minWidth || 360,
    minHeight: minHeight || 400,
    parent: mainWindow,
    modal: false,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', htmlFile));
  win.on('closed', () => setWindow(null));
  setWindow(win);
}
```

### 9.1 新增帳號視窗（`account.html` / `account.js`）

平台下拉選單（Claude/ChatGPT/Gemini/Grok）+ 帳號名稱輸入框 + 角色（可選）
下拉選單 + 取消/確認新增按鈕。確認後呼叫 `addAccount()`、
`switchAccount()`，然後 `window.close()` 自己關掉，主程序透過 IPC 廣播
（`accounts:changed`）通知主視窗刷新帳號清單。

### 9.2 知識庫視窗

見第 5 節。

### 9.3 設定視窗（`settings.html` / `settings.js` / `settings.css`）

由上到下依序：

1. **語言**：下拉選單（繁體中文/English），選了呼叫
   `window.i18n.setLanguage(lang)`。
2. **設定檔存放位置**：顯示目前設定檔資料夾路徑（唯讀），「選擇外部資料夾」
   按鈕（跳 `dialog.showOpenDialog`），選好後主程序跳確認對話框問要不要
   立刻 `app.relaunch(); app.quit();` 重開 App（見第 9.6 節，用
   `app.quit()` 而不是 `app.exit()` 是刻意的）；「還原為預設位置」按鈕
   （只在非預設狀態時顯示）。
3. **擴充功能**：只支援「已解壓縮」格式（資料夾裡要有 `manifest.json`），
   **不做**「連去 Chrome 線上應用程式商店一鍵安裝」這種事。清單每項一個
   checkbox（啟用/停用）+ 移除按鈕；「新增擴充功能」跳資料夾選擇對話框，
   讀 `manifest.json` 拿 `name`/`version` 顯示。新增/停用/移除要立即套用
   到「目前已經開著」的所有帳號 session（`session.loadExtension` /
   `removeExtension`），不用重開 App。
4. **帳號角色管理**：見第 4 節。
5. **檔案預設儲存路徑**：「匯出當前對話」的預設存檔資料夾；勾選框「使用
   預設路徑時不再詢問，直接存檔」開啟後，匯出時跳過存檔對話框直接寫檔
   （處理檔名衝突：`name.md` 存在的話依序試 `name (2).md`、`name (3).md`...）。
6. **備份與還原**：「匯出備份」把帳號清單（平台/名稱/角色，不含登入資料）、
   角色、知識庫（items+groups）、專案、文件庫中繼資料、擴充功能、選擇器
   設定打包成一個 JSON 檔；「匯入備份」讀回這份檔案，各類資料都是「已
   存在的 id 略過，不覆蓋使用者後續的編輯」。
7. **選擇器設定**：見第 10 節。
8. **疑難排解**：
   - 「開啟目前帳號 DevTools」按鈕，呼叫
     `account.view.webContents.openDevTools({ mode: 'detach' })`。
   - 「清除快取」按鈕：對 `session.defaultSession` 跟每個目前開著的帳號
     各自的 `webContents.session` 呼叫 `clearCache()`（只清 HTTP 快取，
     刻意不用 `clearStorageData()`，才不會連 cookies/localStorage 一起
     清掉、把使用者的帳號登入狀態洗掉）。用來處理啟動時終端機印出
     `disk_cache` / `quota_database` 相關錯誤，或帳號畫面出現不明載入
     異常這類 Chromium 磁碟快取髒掉的疑難雜症（常見成因見第 9.6 節）。
9. **關於**：顯示目前版本號（`Platter v{version}`，`version` 是即時透過
   `app:getVersion` IPC 讀 `app.getVersion()`，不是寫死在畫面上的字串，
   打包時 `package.json` 的 `version` 改了這裡會自動跟著變）。主視窗側邊
   欄最下面也有同一個版本號（更小、更不顯眼的位置），這裡是比較正式、
   使用者會特地來找版本號時的地方。

### 9.4 虛擬團隊主控台、專案計畫管理、文件管理、對話庫

見第 6、7、8 節。

### 9.5 日誌主控台

見第 16 節。

### 9.6 App 穩定性：單一實例鎖、app.quit() vs app.exit()

- **單一實例鎖**（`app.requestSingleInstanceLock()`）：兩個 Platter 進程
  同時指向同一個 `userData` 資料夾時，會共用同一份 Chromium 磁碟快取／
  service worker／quota 資料庫，其中一個對這些檔案的讀寫動作會被另一個
  鎖住，這是啟動時終端機印出 `Unable to create cache`、`Unable to move
the cache`（Windows 上常見錯誤碼 `0x5` = 存取被拒）、`Could not open
the quota database, resetting` 這類錯誤最常見的成因。拿不到鎖的那個
  進程會直接 `app.quit()`；使用者「又點了一次啟動」時透過
  `second-instance` 事件把已經開著的主視窗 focus 過去，而不是真的再開
  一個進程出來跟自己搶同一份快取。
- **relaunch 一律用 `app.quit()`，不要用 `app.exit()`**：`app.exit()` 會
  立刻強制終止進程，跳過視窗關閉、session 清理這些正常收尾步驟，
  Chromium 的磁碟快取/資料庫可能來不及正常關閉就被砍斷，就會在下次啟動
  時被偵測成髒資料（quota database 需要 `resetting`）。`settings:
chooseDataDir`／`settings:resetDataDir` 兩個「切換設定檔存放位置後
  立即重啟」的 IPC handler 都是 `app.relaunch(); app.quit();`，讓
  Electron 走正常的關閉流程（觸發 `window-all-closed` 等事件、讓
  Chromium 有機會把快取/資料庫正常關閉）再重啟。
- 如果使用者還是在終端機看到這類錯誤（例如防毒軟體介入、`userData`
  資料夾在會被雲端同步鎖檔的路徑下、或帳號權限問題），這些通常不是
  App 本身邏輯造成的資料損毀，App 多半還是能繼續運作；設定裡「疑難
  排解 → 清除快取」（見第 9.3 節）可以讓使用者自己嘗試修復，不用整個
  移除資料夾/重灌。

### 9.7 SQLite 選型：為什麼用 sql.js，不用 better-sqlite3

日誌主控台（第 16 節）的資料庫是唯一一個真的落地成 SQLite 檔案
（`logs.sqlite`）的地方；其他模組（帳號、知識庫、專案、文件庫、對話庫）
目前仍然是 JSON 檔案，沒有一起搬過去——這是刻意先從風險最低、最適合
展示 SQL 查詢能力的模組開始，不是漏掉。

Electron 裡常見的 SQLite 方案是 `better-sqlite3`，但它是**原生模組**
（C++ 編譯出來的 `.node` 檔），要對應 Electron 內建的 Node.js ABI 重新
編譯（`@electron/rebuild` / `electron-builder install-app-deps`），
`.node` 檔案還不能被塞進 `.asar` 封存檔裡（要另外設定
`asarUnpack`），升級 Electron 版本還要重新跑一次 rebuild——對這個專案
「盡量不要有建置步驟、依賴越少越好」的風格來說，代價偏高。

改用 **`sql.js`**（純 WebAssembly 版 SQLite）：

- 沒有原生模組，`npm install` 完就能直接在 Electron 的 main process
  （本質上就是一個 Node.js 環境）裡 `require('sql.js')` 用，不用
  rebuild，也不用改 `asarUnpack`（`.wasm` 檔是用一般的 `fs.readFileSync`
  讀取，不是 `dlopen`，Electron 的 asar 檔案系統整合本來就支援直接讀取
  asar 內部的檔案）。
- 代價：**整個資料庫活在記憶體裡**，不是「開檔案直接對硬碟讀寫」，每次
  要落地存檔都要 `db.export()` 把整份資料庫匯出成 bytes 再整份寫回檔案
  （見 `lib/sqlite.js` 開頭的說明）。`logError`/`logAudit` 選擇「每次
  寫入就立刻存檔」，用效能換資料安全性，對日誌這種寫入頻率不高、資料量
  頂多幾千筆的情境完全夠用；但這個取捨代表 sql.js **不適合**拿來裝
  「大量資料、高頻寫入」的場景——如果之後真的要把帳號/專案/文件這些
  資料也搬進 SQLite，且資料量/寫入頻率明顯變高，屆時應該重新評估
  `better-sqlite3`（用同步 API + WAL 模式，效能明顯更好），而不是預設
  沿用 sql.js。
- `lib/sqlite.js` 把 `openDatabaseFile()`/`saveDatabaseFile()`/
  `queryAll()` 包成通用的小工具，之後如果要幫其他模組加 SQLite 表，
  直接重用這幾個函式即可，不用重寫一次 WASM 載入邏輯。

---

## 10. 選擇器設定與滑鼠選取工具

抓取對話用的 CSS selector 不寫死在程式碼裡，存成一份可編輯的設定
（`selectors.json`，結構是 `{ claude: {turn, userHint}, chatgpt: {...}, ... }`，
第一次啟動從 `extractors/default-selectors.json` 複製出廠預設值）。

UI：平台下拉選單、「訊息容器 selector」輸入框、「使用者訊息判斷關鍵字」
輸入框、「重設此平台為預設值」/「儲存」按鈕。

**滑鼠選取工具**：兩個按鈕「選取範例：使用者訊息」「選取範例：AI
回覆」，點下去呼叫主程序把設定視窗縮小（`settingsWindow.minimize()`）、
把主視窗帶到最前面，然後對目前帳號的 `WebContentsView` 執行
`executeJavaScript` 注入一段選取器腳本（`extractors/selectorPicker.js`），
等使用者在主視窗點擊一則訊息（或按 Esc 取消），拿到結果後（`finally`
區塊）把設定視窗 `restore()` 帶回來。兩個範例都選完後，比對兩者：

- `turn` selector：如果兩個候選 selector 相同就直接用；不同的話用逗號
  連接兩個（union selector，同時匹配兩種 pattern）。
- `userHint`：優先用使用者範例元素的 `data-message-author-role` 屬性值；
  沒有的話比對兩個範例的 class list，抓出「使用者範例有、AI 範例沒有」的
  第一個 class 名稱；都找不到就留空並提示使用者自己填。

**測試擷取預覽**：填好（或用滑鼠選取工具推導出）selector 後，不用先按
「儲存」也能點「測試擷取」直接看結果——用表單裡目前的值（不是
`selectors.json` 裡已儲存的版本）呼叫跟真正匯出同一套
`extractors/domCapture.js`，對「目前選擇的這個平台」跑一次擷取：

- 優先用目前作用中的帳號（如果剛好是這個平台）；不是的話找第一個開著
  的同平台帳號；一個都沒開就提示「請先新增或切換一個該平台的帳號」。
- 成功：直接在設定視窗裡列出擷取到的訊息數量跟前 5 則預覽（🧑/🤖 +
  截斷文字），不用真的匯出成檔案就知道 selector 抓得對不對。
- 失敗：顯示錯誤原因跟 `debug.matchedNodeCount`/`nonEmptyMessageCount`
  這兩個診斷數字（見第 12 節），引導使用者判斷是「selector 完全沒選到
  節點」還是「選到的是空容器」。
- 跟真正匯出的差異：**測試擷取故意不寫檔、不登記文件庫、也不記錯誤/
  稽核日誌**——調整 selector 本來就會反覆試錯，每次失敗都記錄會洗版
  日誌表、稀釋掉真正該注意的錯誤。

---

## 11. 多國語系（i18n）

- `renderer/locales/zh-TW.json`、`renderer/locales/en.json`：扁平 key-value
  結構，例如 `"sidebar.addAccount": "新增帳號"`。字串裡可以用 `{變數}` 佔位。
- `renderer/i18n.js`：所有視窗共用，掛在 `window.i18n`：
  - `t(key, vars)`：查表回傳翻譯字串，找不到 key 就回傳 key 本身。
  - `applyToDOM(root)`：掃描 `[data-i18n]`（`textContent`）、
    `[data-i18n-placeholder]`（`placeholder`）、`[data-i18n-title]`
    （`title`），套用翻譯。
  - `init()`：讀目前語言、`fetch('./locales/<lang>.json')` 載入翻譯、
    `applyToDOM()`、訂閱 `language:changed` 事件。
  - `setLanguage(lang)`：存到主程序，主程序存檔後對所有現存視窗廣播
    `language:changed`，各視窗重新套用；同時觸發 `i18n:updated`
    DOM 事件，讓各視窗自己重繪動態產生的內容（例如清單、空狀態提示）。
- JS 裡的動態字串（`alert()`/`confirm()` 訊息）一律用
  `window.i18n.t(key, vars)`，不要寫死。

---

## 12. 對話匯出（`extractors/domCapture.js`）

- 由 `main.js` 讀取這個檔案內容，跟一段呼叫程式碼組成字串，透過
  `webContents.executeJavaScript()` 注入到目前帳號的 `WebContentsView` 裡
  執行。**這個檔案本身不內建 selector**，selector 是從 `selectors.json`
  讀出來、當函式參數傳進去的。
- 擷取失敗（0 則訊息）時的錯誤訊息要引導使用者去「設定 → 選擇器設定」
  調整。成功的話，Markdown 輸出格式是每則訊息一個 `###` 標題（🧑 使用者 /
  🤖 AI）+ 內容；JSON 輸出就是原始擷取結果。
- 每次匯出成功都會自動登記進文件庫（見第 8 節）。
- 回傳結果一律帶 `debug: { selectorUsed, matchedNodeCount,
nonEmptyMessageCount, pageUrl }`，這是為了診斷「AI 平台網站的 DOM
  結構跟預設 selector 對不上」這種必然會隨網站改版而發生的問題：
  - `matchedNodeCount = 0` → selector 本身就沒選到任何節點，通常代表
    網站的 DOM 結構變了，`selectors.json` 裡那個平台的 `turn` selector
    已經過時，需要用「設定 → 選擇器設定」的滑鼠選取工具重新框選、
    重新產生 selector（`deriveSelectorFromSamples`，見第 10 節），而不是
    去改 `extractors/default-selectors.json` 這個寫死的預設值。
  - `matchedNodeCount > 0` 但 `nonEmptyMessageCount = 0` → selector 有
    選到節點，但抓出來的 `innerText` 是空的，通常是選到了外層容器
    （例如整個側邊欄或版面骨架）而不是實際訊息氣泡，一樣建議重新用滑鼠
    選取工具挑更精準的節點。
  - main.js 的 `captureCurrentConversation()` 每次呼叫都會把這組 debug
    數字連同 `platform`/`ok`/`error` 印一行到主控台（見第 16 節），失敗
    時額外記一筆錯誤日誌；前端「匯出當前對話」跟「對話庫 → 擷取目前
    對話」失敗時的提示視窗也會直接顯示這組數字，不用另外開日誌視窗才
    看得到。
- 也掛了頁面層級的診斷：`createAccountView()` 幫每個帳號的
  `WebContentsView` 接了 `did-fail-load`（頁面本身載入失敗，例如網路
  斷線、被導向登入頁）跟 `console-message`（頁面自己的 JS 噴錯）事件，
  轉送進第 16 節的主控台即時輸出，用來排除「根本不是 selector 的問題，
  而是頁面沒載入成功」這種情況。

---

## 13. IPC 事件總覽（跨視窗即時同步機制）

| 事件                    | 觸發時機                                                                                             | 訂閱方                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `accounts:changed`      | 帳號新增/切換/刪除/角色指派、角色 CRUD、備份匯入                                                     | 主視窗、虛擬團隊主控台、知識庫（刷新角色清單） |
| `knowledge:changed`     | 知識庫項目/套餐的新增、編輯、刪除、匯入、角色刪除清理                                                | 側邊欄「預設提示詞」區塊                       |
| `documents:changed`     | 文件匯入/儲存/刪除、對話匯出自動登記                                                                 | 文件管理視窗、對話庫視窗                       |
| `conversations:changed` | 對話庫新增/儲存/刪除、匯出自動登記、文件刪除連動清理關聯、備份匯入                                   | 對話庫視窗                                     |
| `logs:changed`          | 任何一筆錯誤/稽核日誌被寫入或清除                                                                    | 日誌主控台視窗                                 |
| `console:entry`         | main process 每呼叫一次 `console.log/info/warn/error`（含頁面 console-message 轉送），即時推送單一筆 | 日誌主控台視窗（主控台分頁）                   |
| `language:changed`      | 語言切換                                                                                             | 所有視窗（重新載入翻譯）                       |

---

## 14. 打包（electron-builder）

`package.json` 的 `build` 欄位設定 `appId`、`productName`、
`directories.output: "dist"`、`files`（main.js/preload.js/**`lib/**/*`**/
renderer/**/extractors/**，另外排除 `node_modules/sql.js/dist/` 裡用不到
的 asm.js/worker/browser 變體跟壓縮包，減少打包體積）、
`asarUnpack: ["extractors/**/*"]`、各平台 `target`
（win: nsis, mac: dmg, linux: AppImage）與對應 icon 路徑
（`assets/icons/icon.ico`/`.icns`/`.png`）。npm scripts：`start`、
`build`、`build:win`、`build:mac`、`build:linux`、`build:dir`（免安裝
資料夾，快速測試用）。

**`files` 陣列務必包含 `lib/**/*`**：electron-builder 只要你自己指定了
`files`，就只打包陣列裡列到的東西，不會自動囊括專案根目錄下所有檔案。
`main.js` 用 `require('./lib/utils')`、`require('./lib/sqlite')` 依賴
`lib/` 資料夾，如果漏掉沒列進 `files`，打包出來的成品會在啟動時直接
噴 `Cannot find module './lib/...'` 崩潰——這是本專案曾經真的存在過的
設定疏漏（`lib/utils.js` 一直都有在用，但 `files` 陣列一直沒列到它，
只是因為開發時都用 `npm start` 直接跑原始碼所以沒發現），加入
`lib/sqlite.js` 的時候一併修正。

**`sql.js` 不需要 `asarUnpack`**：它是純 WebAssembly，main.js 用一般的
`fs.readFileSync` 讀取 `.wasm` 檔（不是 `dlopen` 原生模組），Electron 的
asar 檔案系統整合本來就支援直接讀取封存檔內部的檔案，跟 `better-
sqlite3` 那種一定要解壓縮出來才能載入的原生模組不一樣。

**Windows 安裝程式（`build.nsis`）預設安裝到使用者的應用程式資料夾，
不是 `Program Files`**：

```json
"nsis": {
  "oneClick": false,
  "perMachine": false,
  "allowToChangeInstallationDirectory": true,
  "createDesktopShortcut": true,
  "createStartMenuShortcut": true,
  "shortcutName": "Platter"
}
```

- `perMachine: false` → 預設安裝路徑是 `%LOCALAPPDATA%\Programs\Platter`
  （使用者自己的 AppData 底下），不是需要系統管理員權限的
  `C:\Program Files\Platter`。單機單人用的桌面工具沒有必要要求 UAC
  提權，per-user 安裝也順便降低「使用者裝在權限受限資料夾、之後啟動時
  一堆檔案存取被拒」這類問題的機率（跟第 9.6 節提到的 Chromium 磁碟
  快取錯誤是相關但不同的兩件事：快取本身的存放位置一定是
  `app.getPath('userData')`、不受安裝路徑影響，但安裝路徑如果需要
  admin 權限，使用者日常操作、防毒軟體行為都會更容易出狀況）。
- `oneClick: false` → 顯示正常的安裝精靈視窗（不是靜默一鍵安裝），
  `allowToChangeInstallationDirectory: true` → 精靈裡有「選擇安裝路徑」
  這一步，預設值就是上面那個 AppData 路徑，使用者仍然可以自己改到別的
  地方（例如想裝到 D 槽）。
- mac（`dmg`）、linux（`AppImage`）本來就沒有「安裝到系統資料夾」這個
  概念（拖進 Applications / 直接執行檔案），不需要對應設定。

---

## 15. 檔案結構

```
main.js / preload.js / package.json
main.js                  # 只保留 App 生命週期（單一實例鎖、whenReady、視窗全關/啟用），
                         # 其餘邏輯都拆進 lib/**（1.17.0 模組化，之前是單一檔案近 2200 行）
lib/constants.js         # 靜態設定值：平台網址、側邊欄寬度、UI 狀態預設值
lib/state.js             # 共用可變狀態單例：視窗參照、帳號 View、appState、console 緩衝區……
lib/dataDir.js           # DATA_DIR 讀寫/搬移、各資料檔路徑、readJSONSafe/writeJSONSafe
lib/broadcast.js         # broadcastToAllWindows（跨視窗即時同步）
lib/console.js           # 主控台（Console）：攔截全域 console.*，即時緩衝區
lib/logs.js              # 日誌主控台：錯誤日誌 + 稽核日誌（sql.js/SQLite）
lib/stores.js            # 資料層：app-state/knowledge-base/selectors/projects/documents/conversations 的 loadX()/saveX()
lib/windows.js           # 視窗與帳號 WebContentsView 管理：主視窗、各子視窗、openChildWindow helper
lib/conversationCapture.js # 對話擷取/匯出（executeJavaScript 注入 extractors/domCapture.js）、選取器工具
lib/ipc/index.js         # 匯總註冊所有 IPC handlers
lib/ipc/accounts.js      # accounts:* / roles:* / ui:* IPC
lib/ipc/knowledge.js     # knowledge:* IPC
lib/ipc/settings.js      # settings:* IPC（資料目錄/擴充功能/儲存路徑/備份還原/選取器/疑難排解）
lib/ipc/windows.js       # window:* / app:getVersion IPC
lib/ipc/projects.js      # projects:* IPC
lib/ipc/documents.js     # documents:* IPC
lib/ipc/conversations.js # conversations:* / export:current IPC
lib/ipc/logs.js          # logs:* / console:* IPC
lib/utils.js             # 不依賴 Electron API 的純函式（字串處理、選擇器推導……）
lib/sqlite.js            # sql.js（WebAssembly 版 SQLite）的最小包裝：開檔/存檔/查詢
CHANGELOG.md / ROADMAP.md / README.md / PROJECT_SPEC.md / BUILD_PLAN.md
assets/ICON_PROMPTS.md
assets/icons/README.md（+ 之後補上的 icon.ico/.icns/.png）
extractors/domCapture.js
extractors/selectorPicker.js
extractors/default-selectors.json
renderer/index.html, renderer.js, renderer.css       # 主視窗（多層側邊欄）
renderer/account.html, account.js                    # 新增帳號視窗
renderer/knowledge.html, knowledge.js, knowledge.css # 知識庫（提示詞/套餐/檢核表/角色配置）
renderer/settings.html, settings.js, settings.css    # 設定視窗
renderer/team.html, team.js, team.css                # 虛擬團隊主控台
renderer/project.html, project.js, project.css       # 專案計畫管理
renderer/documents.html, documents.js, documents.css # 文件管理
renderer/conversation.html, conversation.js, conversation.css # 對話庫（新增對話 Markdown、匯出、跟文件庫互相關聯）
renderer/log.html, log.js, log.css                   # 日誌主控台（錯誤日誌／稽核日誌）
renderer/i18n.js
renderer/locales/zh-TW.json, en.json
```

`lib/**` 模組之間的共用慣例（新增功能或修 bug 時務必遵守，避免破壞這個
拆分方式）：

- 所有跨模組共用的可變狀態（視窗參照、帳號 View、appState、console 緩衝區、
  logsDb 連線……）都放在 `lib/state.js` 這個單例物件裡，其他模組一律用
  `state.appState.xxx`、`state.mainWindow` 這種「每次都重新讀取屬性」的
  寫法存取，不要在檔案頂層解構快取一份（`appState` 本身會在
  `loadAppState()` 整個被換掉，解構出來的參照會跟著失去同步）。
- `lib/broadcast.js` 故意獨立、不依賴其他 `lib/**` 模組，是為了讓
  `lib/logs.js`、`lib/console.js`、`lib/windows.js` 都能直接引用它廣播事件，
  不會互相循環依賴。新增模組如果也需要廣播，直接引用這個檔案就好，不要
  改成依賴 `lib/windows.js`。
- `lib/ipc/*.js` 每個檔案對應一個 `registerXxxIpc(ipcMain)` 函式，只負責
  註冊 IPC handler、呼叫其他 `lib/**` 模組已經寫好的函式，handler 內部
  不要再塞入本來該放在 `lib/windows.js`／`lib/stores.js`／
  `lib/conversationCapture.js` 的商業邏輯。
- 新增一種資料類型（例如未來的 XXX 資料）時，照現有慣例：`lib/stores.js`
  加一組 `loadXxx()`/`saveXxx()`，`lib/ipc/` 底下新增或擴充對應的
  `registerXxxIpc()`，不要直接寫進 `main.js`。

資料檔（存在 DATA_DIR，預設是 Electron `userData`，可搬到外部資料夾）：

```
app-state.json      # 帳號清單、UI 狀態（含側邊欄群組展開狀態）、擴充功能、角色
knowledge-base.json # 提示詞項目 + 套餐
projects.json        # 專案 + 任務 + 每個專案自己的 issue 清單
documents.json        # 文件中繼資料
documents/             # 文件庫「已管理」檔案複本存放資料夾
conversations.json     # 對話庫（對話標題/標籤/Markdown 內容/跟文件庫的關聯）
selectors.json          # 各平台的 DOM selector 設定
logs.sqlite             # 日誌主控台（錯誤日誌 + 稽核日誌，sql.js/SQLite，各自最多保留最新 500 筆）
logs.json.migrated     # 舊版（1.11 以前）JSON 格式日誌，升級時搬進 logs.sqlite 後留底，可以刪除
data-dir-pointer.json  # 指向自訂 DATA_DIR 的指標檔（永遠留在預設 userData）
```

---

## 16. 日誌主控台（`log.html`）

資料庫 `logs.sqlite`（**sql.js**：純 WebAssembly 版 SQLite，沒有原生
模組，不需要 `electron-rebuild`；細節與取捨見 `lib/sqlite.js` 開頭的
註解跟第 9.7 節）：

```sql
CREATE TABLE errors (id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, scope TEXT, message TEXT, stack TEXT);
CREATE TABLE audits (id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, category TEXT, action TEXT, detail TEXT);
```

- **錯誤日誌**：`main.js` 裡原本很多 `catch (err) { console.error(...) }`
  的地方（擴充功能載入失敗、對話擷取失敗、選取器工具失敗、文件匯入/
  刪除失敗……）都額外呼叫 `logError(scope, message, err)` 寫進來；另外在
  App 層級掛了 `process.on('uncaughtException'/'unhandledRejection')`，
  main process 任何沒被接住的例外也會自動記進來，不會只留在終端機、
  使用者完全看不到。`readJSONSafe`/`writeJSONSafe` 內部的 catch **刻意
  不**接進 `logError`，避免「寫日誌這件事本身失敗」造成無窮遞迴。
- **稽核日誌**：關鍵動作各自呼叫 `logAudit(category, action, detail)`
  記錄，`detail` 本身就是組好的可讀中文說明（例如「新增帳號「X」
  (chatgpt)」），不需要另外拼字串。目前有記錄的動作：帳號新增/移除、
  專案建立/刪除、文件匯入/刪除、對話新增/刪除/匯出/匯出失敗、備份匯出/
  匯入、設定檔存放位置搬遷、擴充功能安裝/移除。**對話匯出失敗**（不論是
  「匯出當前對話」還是「對話庫 → 匯出檔案」）現在都會記一筆
  `conversation` / `exportFailed` 稽核紀錄，並在 `logError` 那邊留一筆對應
  的錯誤日誌，之前這類失敗完全沒有落地記錄、只會在畫面上跳一次 alert
  就消失，回頭完全查不到發生過什麼事。
- 兩種日誌都各自最多保留最新 500 筆：每次寫入後跑
  `DELETE FROM <table> WHERE id NOT IN (SELECT id FROM <table> ORDER BY
timestamp DESC LIMIT 500)`，用 SQL 直接裁剪，避免 `logs.sqlite`
  無限長大。
- **升級搬遷**：1.11 以前的版本把日誌存在 `logs.json`。第一次用新版
  啟動時，`initLogsDatabase()` 建完表之後會檢查：如果偵測到舊的
  `logs.json` 檔案、而且新資料庫的 `errors`/`audits` 都還是空的，就把
  舊檔內容一筆筆 `INSERT OR IGNORE` 進新資料庫，再把舊檔改名成
  `logs.json.migrated` 留底（不直接刪除）。如果新資料庫已經有資料
  （代表已經搬過或是全新安裝），就不會再動舊檔，避免覆蓋。
- 視窗畫面用「錯誤日誌／稽核日誌／主控台」三個分頁：
  - 錯誤日誌可依來源（`scope`，例如 `documents:import`）篩選、關鍵字
    搜尋訊息；每筆若帶 `stack` 可以點開展開完整堆疊。
  - 稽核日誌可依類別（帳號/專案/文件/對話/備份/設定/擴充功能）篩選、
    關鍵字搜尋內容。
  - **主控台**：即時攔截 `console.log/info/warn/error`（含每個帳號
    `WebContentsView` 自己的 `console-message`、頁面 `did-fail-load`
    轉送過來的訊息，見第 12 節），逐行显示成終端機風格的即時輸出，只存
    在記憶體（`consoleBuffer`，上限 300 筆），App 關掉就沒了、不落地存檔
    也不算進備份。有「自動捲動」開關跟「清除主控台」按鈕。這個分頁存在
    的目的是讓使用者不用另外開終端機/DevTools，就能直接在 App 裡看到
    「這次擷取對話 matched 幾個節點、有內容的訊息幾則」這類除錯用的原始
    輸出，對排查「某個 AI 平台匯出失敗」這種必然跟網站當下 DOM 結構有關、
    沒辦法只靠改程式碼一勞永逸解決的問題特別有幫助。
  - 三個分頁都可以「清除」（各自獨立清除，會問確認）；錯誤/稽核日誌有
    「匯出日誌」把目前完整的 `errors`+`audits` 存成一份 JSON 檔，方便回報
    問題給其他人看（主控台的即時輸出不在這份匯出範圍內，因為它本來就
    只是暫時性的除錯輸出）。
- 不備份進 `settings:exportBackup`（日誌是診斷用的執行紀錄，不是使用者
  資料，換一台機器/重灌不需要帶著走）。

---

## 17. 深色主題視覺規範

CSS 變數：`--bg-main:#1e1e1e`、`--bg-sidebar:#171717`、
`--bg-hover:#2a2a2a`、`--bg-active:#2f3b52`、`--text-primary:#e6e6e6`、
`--text-secondary:#9a9a9a`、`--accent:#4f8cff`、`--danger:#e5484d`、
`--border:#2c2c2c`。全部視窗共用 `renderer.css`，個別視窗可以另外疊加自己的
`*.css` 補版面差異。角色色票另外定義 8 色供使用者挑選（見第 4 節）。

---

## 18. 明確排除的功能（不要做）

- 不做「連去 Chrome 線上應用程式商店一鍵安裝擴充功能」。
- 不做任何呼叫平台未公開 API 的自動化抓取（例如輪詢新訊息、背景自動
  匯出）。對話匯出永遠是「使用者手動觸發、擷取當前畫面 DOM」。
- 不把 cookie/localStorage 等登入憑證放進任何備份/匯出/文件庫檔案。
- 不寫自動繞過 X-Frame-Options 或類似安全性標頭的程式碼。
- 文件庫不打包「已管理」檔案的實體內容進備份 JSON（只還原中繼資料）。

---

## 19. 與 BUILD_PLAN.md 的關係

本文件是「最終狀態」的完整規格。`BUILD_PLAN.md` 把第 3～13 節的內容拆成
8 個可獨立驗收的建置階段，每個階段都有明確的交付項目與檢核表，方便另一個
AI 或開發者按順序重現整個專案，並隨時知道目前進度卡在哪個階段。
