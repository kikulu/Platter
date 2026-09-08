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
  4. 群組「內容工具」🧰：匯出當前對話、知識庫、文件管理
  5. 群組「團隊與專案」🧩：虛擬團隊、專案計畫
  6. 「設定」⚙️ 固定在最底部，不屬於任何可收合群組
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

### 3.3 帳號清單持久化

- 帳號清單的中繼資料（`id`、`platform`、`name`、`roleId`——**不含** cookie
  等實際登入資料）寫進設定檔（`app-state.json`）。開機時讀回來，用相同的
  id 依序重建每個帳號的 `WebContentsView`。

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
  "tasks": [ { "id", "title", "description", "assigneeId", "status": "todo|doing|done", "dueDate" } ],
  "createdAt", "updatedAt"
} ] }
```

- 左側專案清單（狀態徽章 + 任務完成度 `done/total`）、右側編輯表單：
  名稱、狀態（規劃中/進行中/暫停/已完成）、起訖日期、說明。
- 任務清單：可新增（輸入框 + Enter）、行內編輯標題、指派給「虛擬團隊」裡
  的任何帳號（下拉選單）、設定到期日、移除。
- 任務狀態（待辦/進行中/已完成）切換即時透過 `projects:task:setStatus`
  持久化，不用等按「儲存專案」；結構性變更（新增/移除/編輯任務內容）
  才需要按「儲存專案」。
- 備份與還原同步支援專案資料，匯入時已存在的專案 id 略過。

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
  或只移除紀錄保留檔案。
- 備份與還原同步支援文件庫中繼資料（已存在的 id 略過）；還原到不同機器/
  資料夾時，「已管理」複本的檔案本體不會被還原（不打包實體檔案，只還原
  紀錄），會顯示為「檔案遺失」，需要重新匯入。

---

## 9. 三個（現為五個）獨立子視窗架構

一開始「新增帳號」「知識庫」「設定」是疊在主視窗裡的 HTML 彈窗，後來發現
**`WebContentsView` 是原生疊層，不受 CSS z-index 控制**，彈窗開著時如果
`WebContentsView` 還顯示著，經常會蓋住彈窗、或在隱藏 `WebContentsView` 之後
沒把鍵盤焦點交還給主視窗，導致「點了沒反應」「打不進字」這類問題。最後改成
**獨立的 `BrowserWindow`**（`parent: mainWindow`，**不要用 `modal: true`**
——modal 視窗會在 OS 層級鎖住主視窗，跟「滑鼠選取 selector」這種需要切回
主視窗互動的功能會衝突），共用同一份 `preload.js`。

目前共有五個獨立子視窗：`account.html`（新增帳號）、`knowledge.html`
（知識庫）、`settings.html`（設定）、`team.html`（虛擬團隊主控台）、
`project.html`（專案計畫管理）、`documents.html`（文件管理）——共 6 個。

用一個共用的 `openChildWindow(options)` helper 開窗，避免每個視窗各自
重複一份 `new BrowserWindow(...)` 的邏輯：

```js
function openChildWindow({ getWindow, setWindow, htmlFile, width, height, minWidth, minHeight }) {
  const existing = getWindow();
  if (existing && !existing.isDestroyed()) { existing.focus(); return; }
  const win = new BrowserWindow({
    width, height, minWidth: minWidth || 360, minHeight: minHeight || 400,
    parent: mainWindow, modal: false, backgroundColor: '#1e1e1e',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
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
   立刻 `app.relaunch(); app.exit();` 重開 App；「還原為預設位置」按鈕
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
8. **疑難排解**：「開啟目前帳號 DevTools」按鈕，呼叫
   `account.view.webContents.openDevTools({ mode: 'detach' })`。

### 9.4 虛擬團隊主控台、專案計畫管理、文件管理

見第 6、7、8 節。

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

---

## 13. IPC 事件總覽（跨視窗即時同步機制）

| 事件 | 觸發時機 | 訂閱方 |
|---|---|---|
| `accounts:changed` | 帳號新增/切換/刪除/角色指派、角色 CRUD、備份匯入 | 主視窗、虛擬團隊主控台、知識庫（刷新角色清單） |
| `knowledge:changed` | 知識庫項目/套餐的新增、編輯、刪除、匯入、角色刪除清理 | 側邊欄「預設提示詞」區塊 |
| `documents:changed` | 文件匯入/儲存/刪除、對話匯出自動登記 | 文件管理視窗 |
| `language:changed` | 語言切換 | 所有視窗（重新載入翻譯） |

---

## 14. 打包（electron-builder）

`package.json` 的 `build` 欄位設定 `appId`、`productName`、
`directories.output: "dist"`、`files`（main.js/preload.js/renderer/**/
extractors/**）、`asarUnpack: ["extractors/**/*"]`、各平台 `target`
（win: nsis, mac: dmg, linux: AppImage）與對應 icon 路徑
（`assets/icons/icon.ico`/`.icns`/`.png`）。npm scripts：`start`、
`build`、`build:win`、`build:mac`、`build:linux`、`build:dir`（免安裝
資料夾，快速測試用）。

---

## 15. 檔案結構

```
main.js / preload.js / package.json
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
renderer/i18n.js
renderer/locales/zh-TW.json, en.json
```

資料檔（存在 DATA_DIR，預設是 Electron `userData`，可搬到外部資料夾）：

```
app-state.json      # 帳號清單、UI 狀態（含側邊欄群組展開狀態）、擴充功能、角色
knowledge-base.json # 提示詞項目 + 套餐
projects.json        # 專案 + 任務
documents.json        # 文件中繼資料
documents/             # 文件庫「已管理」檔案複本存放資料夾
selectors.json          # 各平台的 DOM selector 設定
data-dir-pointer.json  # 指向自訂 DATA_DIR 的指標檔（永遠留在預設 userData）
```

---

## 16. 深色主題視覺規範

CSS 變數：`--bg-main:#1e1e1e`、`--bg-sidebar:#171717`、
`--bg-hover:#2a2a2a`、`--bg-active:#2f3b52`、`--text-primary:#e6e6e6`、
`--text-secondary:#9a9a9a`、`--accent:#4f8cff`、`--danger:#e5484d`、
`--border:#2c2c2c`。全部視窗共用 `renderer.css`，個別視窗可以另外疊加自己的
`*.css` 補版面差異。角色色票另外定義 8 色供使用者挑選（見第 4 節）。

---

## 17. 明確排除的功能（不要做）

- 不做「連去 Chrome 線上應用程式商店一鍵安裝擴充功能」。
- 不做任何呼叫平台未公開 API 的自動化抓取（例如輪詢新訊息、背景自動
  匯出）。對話匯出永遠是「使用者手動觸發、擷取當前畫面 DOM」。
- 不把 cookie/localStorage 等登入憑證放進任何備份/匯出/文件庫檔案。
- 不寫自動繞過 X-Frame-Options 或類似安全性標頭的程式碼。
- 文件庫不打包「已管理」檔案的實體內容進備份 JSON（只還原中繼資料）。

---

## 18. 與 BUILD_PLAN.md 的關係

本文件是「最終狀態」的完整規格。`BUILD_PLAN.md` 把第 3～13 節的內容拆成
8 個可獨立驗收的建置階段，每個階段都有明確的交付項目與檢核表，方便另一個
AI 或開發者按順序重現整個專案，並隨時知道目前進度卡在哪個階段。
