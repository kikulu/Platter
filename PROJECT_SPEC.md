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
6. 用「文件庫」統一保存對話匯出的檔案與手動匯入的任意檔案。

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
  4. 群組「內容工具」🧰：匯出當前對話、知識庫、文件庫、對話庫、
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
- **懶載入**：帳號的 `WebContentsView` 分兩階段——`registerAccountMeta()`
  只登記帳號的中繼資料（平台/名稱），不建立任何 `WebContentsView`、也不
  `loadURL()`；真正的頁面載入延後到 `ensureAccountViewLoaded()`，只在
  這個帳號**第一次**被切換過去時才觸發（`switchAccount()` 內部呼叫）。
  一個帳號的網頁本身是完整的 React SPA，同時開好幾個都在背景跑會吃掉
  可觀的 CPU/記憶體/GPU 合成資源，帳號數量一多（例如 6、7 個）很容易
  拖累目前正在用的那一個的滾動/互動流暢度——懶載入就是為了避免這個問題：
  不管帳號清單裡有多少個帳號，同一時間真正在跑頁面的，只有使用者實際
  點開過的那幾個。
- 新增帳號：先 `registerAccountMeta()` 登記，緊接著呼叫
  `switchAccount()`（因為新增帳號代表使用者現在就要用它），這一步才會
  觸發 `ensureAccountViewLoaded()` 真正建立獨立 partition 的
  `WebContentsView`，`mainWindow.contentView.addChildView(view)` 掛進
  主視窗，`loadURL()` 載入對應平台網址（`https://claude.ai`、
  `https://chatgpt.com`、`https://gemini.google.com`、
  `https://grok.com`）。
- 切換帳號：如果目標帳號還沒載入過，先 `ensureAccountViewLoaded()`
  觸發第一次載入；已經載入過的帳號不會重新建立或重新整理，單純
  `setVisible(true/false)` 切換顯示狀態，達成毫秒級無縫切換。
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
  等實際登入資料）寫進設定檔（`app-state.json`）。開機時讀回來，
  `rebuildAllAccountViews()` 只對每個帳號呼叫 `registerAccountMeta()`
  登記中繼資料——**不會**在開機時就把所有帳號的頁面都載入起來（見 3.2
  節的懶載入說明）。真正會在開機時載入頁面的只有一個：
  `state.appState.ui.lastActiveAccountId`（上一次切換到的帳號 id，
  `switchAccount()` 每次呼叫都會更新並存檔）指到的那個帳號；如果這個
  id 找不到對應帳號（例如那個帳號後來被刪除了）或這是第一次啟動，
  就退回帳號清單第一個。其他帳號要等使用者實際點過才會建立
  `WebContentsView`、才會真的耗用資源。
- **陣列順序就是使用者排序過的顯示順序**，拖曳排序本質上就是在改這個
  陣列的順序，跟哪個帳號的頁面有沒有載入是兩件獨立的事。

---

## 4. 帳號角色機制

- 角色是**可重複套用到多個帳號**的共用定義：
  `{ id, name, description, color, createdAt, updatedAt }`。
  `description` 可當成角色提示詞／system prompt 使用；`color` 是預先定義的
  8 色色票之一（`#4f8cff #e5484d #f5a623 #2ecc71 #9b59b6 #1abc9c #e91e8c
#95a5a6`）。
- 存在 `app-state.json` 的 `roles: []`。
- **內建預設角色**：`app-state.json` 完全不存在時（全新安裝、第一次
  開啟），`lib/stores.js` 的 `loadAppState()` 會用
  `extractors/default-roles.json` 裡內建的 8 種企業角色（人力資源、
  行銷企劃、業務銷售、客服支援、專案經理、軟體工程師、財務會計、
  高階主管）當 `roles` 起始內容，`id` 是固定字串（例如 `role_hr`），
  跟 `default-knowledge-base.json` 裡「企業角色範本」分類的提示詞項目
  的 `roleIds` 對得上，所以全新安裝一開機側邊欄「預設提示詞」（見
  第 5.4 節、第 8 節）就已經依角色分好內容，不用使用者自己重新建立
  一輪角色。跟 `seedDefaultKnowledgeBase()`／`loadSelectors()` 是同一套
  慣例：種子邏輯只在 `app-state.json` 完全不存在時觸發一次，一旦存過檔
  （哪怕使用者把角色刪光）就永遠讀使用者自己的版本。
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

**內建預設範本**：`knowledge-base.json` 完全不存在時（全新安裝、第一次
開啟知識庫），`lib/stores.js` 的 `loadKnowledgeBase()` 會用
`extractors/default-knowledge-base.json` 裡內建的 56 組提示詞範本當
起始內容，涵蓋 8 個分類（標籤對應分類名稱）：企業日常作業、
醫療軟體研發、論文寫作、研究計畫、專案開發（各 5 組，共 25 組，沿用
Stage 5 原始設計）、**SDD規格驅動開發**（7 組，1.28.0 新增）、
**OpenSpec**（8 組，1.30.0 新增；兩者見下方「內建分階段套餐範本」），
以及**企業角色範本**（8 種常見企業職務各 2 組，共 16 組，1.26.0 新增）。
前 40 組都用單一 `content` 欄位、Markdown 格式
撰寫（標題、角色與目標、輸入資訊、輸出要求）；企業角色範本則額外帶
`roleIds`（對應 `default-roles.json` 種子角色的固定 id，見第 4 節）跟
`systemPrompt`／`userPrompt` 拆分欄位——`systemPrompt` 定義這組範本的
人設／任務框架，`userPrompt` 是這次要交代的具體任務（沿用既有「資訊
不足就用 `[請填入]` 明確標示、不要自己編造」的風格），`content` 欄位
則是兩者合併起來的版本（向下相容舊有只認 `content` 的搜尋／匯出／
側邊欄複製邏輯）。這是跟 `default-selectors.json` 讓 `loadSelectors()`
有起手式一樣的慣例：全新安裝時整批種入；一旦寫過一次
`knowledge-base.json`（哪怕使用者把範本全部刪光只剩空清單），之後
永遠讀使用者自己的版本，絕對不會回頭覆蓋使用者已經編輯過的內容。
使用者可以自由編輯、刪除、或增加更多範本，內建範本不是唯讀的。

**覆蓋安裝／升級補種**：新版 `default-knowledge-base.json` 新增的內建
範本要能補進既有使用者的知識庫，但不能動到使用者刪除/編輯過的舊範本。
做法是資料目錄裡的 `seeded-defaults.json` 記錄「已經種過的內建範本
`defaultId`」（`knowledgeBase`：提示詞；`knowledgeGroups`：分階段套餐，
1.27.0 新增），`loadKnowledgeBase()` 每次載入時比對，只補清單裡沒有的
`defaultId`；補種的項目會帶 `defaultId` 欄位追蹤來源。沒有
`seeded-defaults.json` 的舊安裝第一次跑這個機制時，用「標題完全相同」
回溯標記既有的內建提示詞，避免整批重複塞入。

**內建分階段套餐範本**（1.27.0 新增）：`default-knowledge-base.json` 除了
`items` 還有 `groups`，內含 7 組分階段套餐（論文寫作、研究計畫、軟體專案
開發、醫療器材軟體合規、專案例行溝通，以及 1.28.0 新增的 **SDD 規格驅動
開發流程**、1.30.0 新增的 **OpenSpec 變更流程**，標籤都帶「分階段範本」）。範本用
`stages: [{ title, itemDefaultIds: [...] }]` 描述，以內建提示詞的
`defaultId` 引用（不綁死使用者資料裡隨機產生的 item id）；種入時由
`lib/utils.js` 的 `buildGroupFromDefault()` 對照使用者知識庫實際的 item id，
展開成扁平 `steps`、每步帶上所屬階段名稱 `stage`。引用的提示詞已被使用者
刪掉的步驟直接略過，整份套餐一步都對不上就不種。從 1.26.x 升級的既有安裝
沒有 `knowledgeGroups` 紀錄，第一次升級會補進全部內建套餐一次，之後使用者
刪除/編輯都不會被補回來；往後新版再新增的內建套餐（例如 1.28.0 的 SDD）
同樣以 `defaultId` 增量補進，且會先補完它引用的新提示詞再展開步驟。

**SDD 規格驅動開發套餐**（1.28.0 新增）：SDD（Spec-Driven Development）
把「做什麼／為什麼」先寫成可檢驗的規格，再由規格驅動技術規劃、任務拆解
與實作。內含 7 組標籤為「SDD規格驅動開發」的提示詞（`kb-default-042` ~
`048`，流程參考 GitHub Spec Kit），由 `kb-group-default-006` 分三個階段
串起來：**階段 1 原則與規格**（專案原則 Constitution → 功能規格 Specify →
規格釐清 Clarify）、**階段 2 規劃與任務**（技術規劃 Plan → 任務拆解
Tasks）、**階段 3 檢查與實作**（一致性分析 Analyze → 依任務實作
Implement）。撰寫時的幾個刻意設計：規格只談做什麼、不談技術棧；釐清
最多問 5 題、使用者回答前不擅自修改規格；分析是唯讀、不改任何文件；
實作遇到與規格衝突要停下來詢問，不自行改規格。建議在同一段 AI 對話裡
依序貼上，讓前面的產出成為後面的上下文，並把每份產出存成
`constitution.md`／`spec.md`／`plan.md`／`tasks.md`。

**OpenSpec 變更流程套餐**（1.30.0 新增）：OpenSpec
（[Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec)）是輕量的規格
驅動開發框架，特別適合在既有專案上逐步修改行為（brownfield）：每個變更
（change）放在 `openspec/changes/<變更名稱>/`，內含 `proposal.md`、差異規格
`specs/<capability>/spec.md`（用 `ADDED`／`MODIFIED`／`REMOVED Requirements`
描述「相對現有規格改了什麼」，每個需求 `### Requirement:` 底下用
`#### Scenario:` 寫 GIVEN／WHEN／THEN）、`design.md`、`tasks.md`；實作後封存，
把差異規格合併進 `openspec/specs/`。內含 8 組標籤為「OpenSpec」的提示詞
（`kb-default-049` ~ `056`），由 `kb-group-default-007` 分四個階段串起來：
**階段 1 探索與提案**（探索想法 Explore → 變更提案 proposal.md）、**階段 2 規格與
設計**（差異規格 Delta Specs → 技術設計 design.md）、**階段 3 任務與實作**（任務清單
tasks.md → 依任務實作 Apply）、**階段 4 驗證與封存**（實作驗證 Verify → 封存前預演
Archive）。提案、差異規格、設計、任務四組提示詞直接要求輸出 OpenSpec 的檔案格式且
「只輸出檔案內容」；差異規格要求 MODIFIED 貼完整需求（封存時整段取代）、需求名稱與現有
規格一字不差（找不到就標「待確認」、不杜撰）、多個 capability 各加一行
`=== FILE: specs/<capability>/spec.md ===` 標記（供匯出成檔案，見第 7.7 節）；提案在最後補
「建議變更名稱：xxx」；探索、驗證、封存預演都是唯讀，且封存預演明確聲明只是預演、實際封存
要用 OpenSpec 的 `/opsx:archive`（或 CLI 的 `openspec archive`）。

### 5.1 提示詞項目（items）

```
{ id, title, content, tags: string[],
  checklist: [{ id, text, checked }],
  roleIds: string[],
  systemPrompt: string, userPrompt: string,
  createdAt, updatedAt }
```

- 兩欄式版面：左邊項目清單（含標籤篩選下拉選單）+ 匯出全部/匯入按鈕，
  右邊編輯表單（名稱、標籤（逗號分隔）、系統提示詞 textarea、使用者
  提示詞 textarea、內容 textarea）。
- **系統提示詞／使用者提示詞（1.26.0 新增）**：`systemPrompt`／
  `userPrompt` 是 `content` 之外新增的可選拆分欄位，分別對應各自的
  textarea 跟「複製內容」按鈕（`btn-copy-system`／`btn-copy-user`），
  方便貼到不同用途的欄位（例如系統提示詞貼到平台的 Custom
  Instructions、使用者提示詞貼到對話輸入框）。兩者皆空字串時代表這個
  項目沿用舊式的單一 `content` 寫法；`content` 欄位保留供舊資料與
  自由格式提示詞使用，並在編輯器顯示提示文字說明「已填寫上方兩欄時
  這裡可以留空」。主要的「複製內容」按鈕（`btn-copy`）在 `content`
  為空時，會自動改複製 `systemPrompt`＋`userPrompt` 組合起來的版本，
  維持「一鍵複製完整提示詞」的行為不變。
- 「複製內容」用瀏覽器原生 `navigator.clipboard.writeText()`。
- 標籤篩選：從目前所有項目的標籤動態組出下拉選單選項，選了就在記憶體裡
  篩選清單（不用重打 IPC）。
- **全文搜尋**：工具列的搜尋框即時（`input` 事件，不用按 Enter）在記憶體
  裡篩選清單，跟標籤篩選是 AND 關係（可以同時用）。提示詞項目比對標題／
  內容／`systemPrompt`／`userPrompt`／標籤；套餐額外比對說明、**階段
  名稱**（1.27.0），以及**套餐裡任一步驟引用的提示詞標題**（方便直接搜
  「這個提示詞被用在哪些套餐裡」，不用逐一點開套餐檢查步驟）。篩選後完全沒有符合的項目時，清單
  區塊顯示「沒有符合搜尋條件的項目」，跟「這個分頁本來就還沒建立任何
  項目/套餐」的空狀態提示分開，避免使用者誤以為是清單本身是空的。
- 「匯入」按鈕匯入的是完整的知識庫 JSON 備份格式（`{items, groups}`，
  沿用 Stage 5 原始設計）；「匯入 Markdown」是另一個按鈕，只在「提示詞」
  分頁顯示，可一次多選任意 `.md`/`.markdown`/`.txt` 檔案，逐一讀成新的
  提示詞項目（檔名去掉副檔名當標題，檔案全文塞進 `content`，`tags`/
  `checklist`/`roleIds`/`systemPrompt`/`userPrompt` 都是空的），匯入完
  自動把最後一個匯入的項目打開在編輯器裡，方便馬上檢視/編輯內容，不用
  另外手動點開。這兩個「匯入」按鈕處理的是完全不同的檔案格式，不要搞混。

### 5.2 檢核表機制（單一項目自帶）

- 每個提示詞項目可選擇附帶一份獨立檢核表（例如「發布前檢查清單」）。
- 編輯器裡的「檢核表」區塊：可新增/勾選/移除檢核項目，隨項目一起儲存
  （記憶體內編輯，按「儲存」才寫入）。

### 5.3 群組順序提示詞套餐（groups，可分階段）

```
{ id, defaultId?, title, description, tags: string[],
  steps: [{ id, itemId, checked, stage }],
  createdAt, updatedAt }
```

- 「套餐」分頁：把多個已存在的提示詞項目依指定順序組成一個套餐。
- **分階段（1.27.0 新增）**：`step.stage` 是選填的階段名稱字串（例如
  「階段 1：文獻與架構規劃」）。**相鄰且 `stage` 相同**的步驟屬於同一階段；
  順序永遠只由 `steps` 陣列本身決定，階段只是「哪幾步歸在同一組」的標示。
  舊資料沒有 `stage`、或是空字串，都代表沒有分階段——`loadKnowledgeBase()`
  載入時會把缺少的欄位補成空字串，畫面與行為跟加入階段功能之前完全一樣。
  `lib/utils.js` 的 `groupStepsByStage()` 是把 `steps` 依 `stage` 切成連續
  區段的純函式（Markdown 匯出用，有單元測試）。`defaultId` 只有從內建範本
  種進來的套餐才有（見第 5 節「內建分階段套餐範本」），儲存時會保留。
- 套餐編輯器：名稱、標籤、說明、步驟清單。清單是「**階段標題列 + 步驟列**」
  混排：步驟屬於它上方最近的階段標題，所以「把步驟移到別的階段」就是用
  ↑↓ 越過標題列（標題列本身也能用 ↑↓ 移動），不需要另外的指派介面；
  「＋ 階段」在清單尾端加一個標題（預設名稱「階段 N」，可直接改名，清空會
  退回預設名稱），之後用下拉選單加入的步驟會歸在它底下。階段標題列另有
  該階段完成進度、「複製本階段」、「移除階段標題」（只移除標題，步驟保留）。
  資料檔裡不存標題列：儲存時 `rowsToSteps()` 把標題攤平成每個步驟的
  `stage`，讀取時 `stepsToRows()` 再還原成標題列；**沒有任何步驟的空階段
  不會被存下**，存完會用實際存下的內容重畫編輯器。單步複製、移除的行為
  不變。
- **檢核表機制第二種應用**：每個步驟都有一個勾選框，追蹤「這個步驟是否
  已經使用/完成」，勾選狀態即時透過 IPC（`knowledge:group:toggleStep`）
  持久化，不用等按「儲存套餐」；「重置進度」可一次清空整份套餐的勾選
  狀態。結構性變更（新增/移除/重排步驟與階段、編輯標題說明）才需要按
  「儲存套餐」。
- **複製**：單步複製與「複製全部內容」用同一個規則取得項目的完整文字——
  有 `content` 就用 `content`，`content` 為空（只填了系統／使用者兩欄）就把
  `systemPrompt`＋`userPrompt` 組起來，跟項目編輯器「複製內容」按鈕一致。
  「複製全部內容」依序把所有步驟串接起來（用 `---` 分隔）；有分階段時每個
  階段前加一行 `=== 階段名稱 ===`、階段之間同樣用 `---` 分隔，沒有分階段的
  套餐輸出跟原本完全相同。「複製本階段」只複製該階段內的步驟（不含標題列）。
- 套餐清單每一列顯示階段數（「N 個階段」，沒有分階段就不顯示）與完成進度。

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
  `#tag1 #tag2`、檢核表用 `- [x]/[ ]` 條列；有拆分 `systemPrompt`／
  `userPrompt` 的項目分成「### 系統提示詞（System Prompt）」「### 使用者
  提示詞（User Prompt）」兩個小節匯出，沒有拆分的項目維持原本直接輸出
  `content` 的寫法；套餐額外標示 `📦 套餐：`、步驟依序條列並標示完成
  狀態，有分階段的套餐在每個階段前加一行 `### 階段名稱`（步驟編號跨階段
  連續），沒有分階段就維持純條列；項目間用 `---` 分隔）或 **JSON**（結構化，給匯入用，包含完整
  `items`/`groups`，`systemPrompt`/`userPrompt` 原樣保留）。
- 匯入：只接受 JSON。項目重新產生 id（避免撞號），`roleIds` **不**帶入
  來源檔案的角色配置（角色是各安裝環境自己的資料）；`systemPrompt`/
  `userPrompt` 則照原樣帶入；套餐的 `steps.itemId` 依新舊 id 對照表
  自動轉換，找不到對照的步驟捨棄；步驟的 `stage`（階段名稱）照原樣保留
  （缺少視為空字串）。全部附加到現有清單後面，不覆蓋既有
  項目。

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
  "workflow": { ... },   // 選填，從範本建立的專案才有，見第 7.6 節
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

**工時紀錄**：每個任務可以記錄多筆工時（日期 + 小時數 + 備註選填），
點任務列上的「⏱」按鈕展開/收合這個任務的工時紀錄面板，列出已有的紀錄
（可個別移除），下方是新增一筆的小表單（日期預設今天）。任務清單上方
會顯示這個專案目前所有任務加總的總工時。

跟任務狀態一樣，新增/移除工時紀錄透過 `projects:task:addTimeEntry`／
`removeTimeEntry` 即時持久化，不用等按「儲存專案」——工時紀錄本質上是
「事件」而不是使用者會反覆編輯的欄位，即時存檔可以避免記完工時忘記
按儲存就白做工。新建立、還沒按過「儲存專案」的任務暫時不能記工時
（面板顯示「請先儲存專案」提示），因為後端沒有對應的任務 id 可以掛。

`task.timeEntries` 這個欄位**不是**「編輯任務標題/指派/日期 → 按儲存
專案」這條路徑負責維護的——render 層的 `editingTasks` 是從
`projects:list` 載入的完整 task 物件 spread 出來，會一路帶著
`timeEntries`，但後端 `projects:save` 重建 task 物件時必須明確保留這個
欄位，不能預設成空陣列去覆蓋（不然使用者隨便改個任務標題存檔，工時
紀錄就會消失——這是對話庫 `linkedDocumentIds` 踩過的真實 bug，見
`CHANGELOG.md` 1.21.1，這次加這個功能時特別留意避免重蹈覆轍）。

**到期日提醒**：主視窗側邊欄「專案計畫」按鈕上會顯示一個紅色角標，數字
是所有專案裡「還沒完成、且到期日 ≤ 今天」的任務與 issue 加總（已完成/
已解決/已關閉的不算）。這個計算跟通知排程都在 `lib/reminders.js`：

- App 開機立刻檢查一次，之後每小時再檢查一次；任何一次
  `projects:save`／狀態切換／工時紀錄異動之後也會立刻重算一次，不用
  等到下一次排程（例如把逾期任務標成完成，角標要馬上消失）。
- 有新的到期項目（逾期或今天到期）時會另外跳一次系統原生通知（三語
  文案，依 `state.appState.ui.language` 挑選），標題「Platter 專案
  提醒」/ "Platter Project Reminder" / 「Platter プロジェクト
  リマインダー」。用「這批到期項目 id + 逾期/今天到期狀態」組出的
  指紋比對是否跟上次通知過的內容相同，相同就不重複跳通知，避免每小時
  排程檢查都彈一次一樣的內容——但只要有任何項目變成到期（新加的、或
  時間走到隔天讓昨天沒過期的東西變逾期），指紋就會變、就會再通知一次。
- `projects:getDueSummary` 回傳 `{ overdueCount, dueTodayCount, items }`
  給角標跟通知共用；`reminders:changed` 廣播只帶 `{ overdueCount,
dueTodayCount }` 給側邊欄即時刷新角標數字（見第 13 節）。

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

### 7.6 專案範本與階段流程（SDD）

專案可以從**範本**建立，並帶一份**階段流程（`project.workflow`）**：一串分階段的
提示詞步驟。使用者輸入專案主題後，依序把每個步驟的提示詞（自動帶入主題與前面
步驟的產出）複製給 AI、把 AI 的產出貼回來、標記完成，再進下一步——把「分階段提示詞
套餐」（第 5.3 節）和專案管理接在一起，並多了「主題」「產出接力」「進度」。邏輯放在
`lib/workflow.js`（不依賴 Electron 的純函式，有單元測試），IPC handler
（`lib/ipc/projects.js`）只負責讀寫資料與廣播。

**內建範本**（`extractors/default-project-templates.json`，唯讀、隨程式版本更新，
不複製進資料目錄）共 5 組軟體開發流程：

| 範本                     | 階段                                                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SDD 規格驅動開發         | 原則與規格（Constitution → Specify → Clarify）→ 規劃與任務（Plan → Tasks）→ 檢查與實作（Analyze → Implement），重用知識庫 7 組 SDD 提示詞，順序與 SDD 分階段套餐一致                                                                  |
| OpenSpec 變更流程        | 探索與提案（Explore → proposal.md）→ 規格與設計（差異規格 → design.md）→ 任務與實作（tasks.md → Apply）→ 驗證與封存（Verify → Archive 預演），重用知識庫 8 組 OpenSpec 提示詞，可匯出成專案的 `openspec/changes/` 資料夾（第 7.7 節） |
| 敏捷 Scrum 迭代開發      | 產品願景與 Backlog → Sprint 規劃 → 開發與驗收 → Sprint 回顧                                                                                                                                                                           |
| 傳統瀑布式開發           | 需求分析 → 系統設計 → 實作與測試 → 部署與維運                                                                                                                                                                                         |
| MVP 快速原型（精實驗證） | 問題與假設 → 原型實作 → 驗證與迭代                                                                                                                                                                                                    |

範本格式：`{ id, name, description, stages: [{ title, steps: [{ title?, prompt?, itemDefaultId?, artifact?, useBaseContext? }] }] }`
（`artifact`／`useBaseContext` 是 1.30.0 新增的選填旗標，OpenSpec 整合用，見第 7.7 節）。
步驟可以**內嵌 `prompt`**，或用 **`itemDefaultId` 引用知識庫的內建提示詞**（大量重用，
不重複維護同一段文字）。引用時優先用**使用者知識庫裡**帶有該 `defaultId` 的項目——
使用者調整過提示詞，之後建立的專案就會用調整後的版本；項目被刪掉時退回內建檔的原始
內容（`lib/stores.js` 的 `makeKnowledgePromptResolver()`）。

**使用者範本**存在資料目錄 `project-templates.json`（`{ templates: [...] }`，格式同上，
步驟一律內嵌 `prompt`），由專案的「另存為專案範本」產生，可在範本選擇畫面刪除；內建範本
不能刪。備份匯出的 `projectTemplates` 欄位一併帶上、還原時已存在的 id 略過。

**`project.workflow`**：

```json
{ "templateId", "templateName", "topic",
  "contextMode": "all|previous|none", "currentStepId",
  "steps": [ { "id", "stage", "title", "prompt", "output",
               "status": "todo|doing|done", "taskId" } ] }
```

- 階段沿用套餐的做法：`step.stage` 是階段名稱字串，相鄰且相同的步驟屬於同一階段。
- **建立時提示詞「快照」進 `steps[].prompt`**：之後改動或刪除知識庫項目，不影響已經在跑的
  專案，備份還原也自成一體。使用者可在專案內改單一步驟的提示詞原文（只影響這個專案）。
- **一步一任務**：建立專案時每個步驟同時建立一個任務（標題如 `1-1 SDD 專案原則
（Constitution）`，編號是「階段序號-階段內序號」），`taskId` 互相對應。步驟狀態與任務
  狀態**雙向一致**：步驟改狀態 → `projects:workflow:setStepStatus` 同步對應任務；使用者
  在任務清單改任務狀態（`projects:task:setStatus`，或按「儲存專案」）→
  `syncStepStatusFromTasks()` 反向同步。所以既有的任務清單、月曆、甘特圖、進度、到期提醒
  都直接可用。對應任務被使用者刪掉時，步驟照常運作、只是不再同步。
- **組合提示詞**（`composeStepPrompt()`）：`# 專案主題` → `# 目前步驟`（階段、編號、第 n/總數
  步）→ `# 前面步驟的產出` → `# 本步驟提示詞` → `# 補充說明`（請 AI 依主題與前面產出帶入提示詞
  裡的 `[請填入]`，無法得知的標「待確認」、不要編造）。提示詞內的 `{{topic}}` 會被替換成專案
  主題（給自訂範本用）。`contextMode` 決定帶入哪些前面步驟的產出：`all`（預設，所有有產出的
  前面步驟）／`previous`（只帶緊鄰的上一步）／`none`（同一段 AI 對話已經有前面內容時省 token）。
  沒有產出的步驟不會出現空段落。組合只在主行程做（`projects:workflow:compose`），畫面端只
  顯示與複製，避免兩邊各寫一份。
- `nextCurrentStepId()`：標成完成時「目前步驟」往後移到第一個還沒完成的步驟（全做完就留在
  原地）；選取步驟也會記住，重開視窗後接續。
- 一般 `projects:save` **不會蓋掉 `workflow`**：渲染層送來的專案物件沒有這個欄位，沿用既有的
  展開合併保留它（跟 `timeEntries` 同一類要小心的欄位，有測試守著）。`loadProjects()` 載入
  時補齊缺少的欄位，結構壞掉（`steps` 不是陣列）的 workflow 直接丟掉。

**IPC**（見 `preload.js`）：`projectTemplates:list`（內建在前、自訂在後，只回傳階段與
步驟標題預覽、不含提示詞全文）、`projectTemplates:delete`、`projects:createFromTemplate`
（`{ templateId, topic, name? }`，主題必填）、`projects:workflow:setMeta`（主題／帶入方式／
目前步驟）、`projects:workflow:updateStep`（只接受 `output`／`prompt`／`title`）、
`projects:workflow:setStepStatus`、`projects:workflow:compose`、
`projects:workflow:saveAsTemplate`。快速搜尋的專案比對也涵蓋專案主題。

**畫面**（`project.html` / `project.js`）：

- 專案清單工具列的「**從範本建立**」：右側顯示範本卡片（名稱、內建/自訂、階段與步驟數、
  各階段的步驟預覽），輸入專案主題（必填）與專案名稱（選填，預設用主題）後建立，建立完直接
  切到新專案的「階段流程」分頁。
- 「**階段流程**」分頁（只有帶 `workflow` 的專案才顯示）：上方是專案主題（可隨時修改）與前面
  產出的帶入方式；左側依階段列出步驟（○ 待辦／◐ 進行中／● 已完成，每階段完成進度）；右側是
  目前步驟——提示詞預覽（唯讀、已帶入主題與前面產出）、可展開編輯提示詞原文、「複製提示詞」
  （順便把待辦步驟標成進行中）、貼回 AI 產出的欄位（離開輸入框即存檔）、上一步／重設為待辦／
  標記完成並前往下一步；底部可「另存為專案範本」（含專案內改過的提示詞，不含產出與狀態）。
- 步驟狀態改變後主行程回傳完整專案清單，畫面端把已持久化的任務狀態同步回 `editingTasks`
  並重繪任務清單——否則之後按「儲存專案」會把任務狀態蓋回舊值。

備份與還原同步支援專案資料（含 `tasks`、`issues` 與 `workflow`），匯入時已存在的
專案 id 略過。

### 7.7 OpenSpec 整合

「OpenSpec 變更流程」範本（第 7.6 節）多了兩個與使用者專案的 OpenSpec 資料夾交換檔案的功能。
Platter **不執行 OpenSpec CLI、不修改使用者專案的程式碼**——它只負責產生規格文件，再由使用者
用 OpenSpec 的指令驗證、實作、封存。邏輯在 `lib/openspec.js`（純函式與 `fs`，不依賴 Electron，
有單元測試）。

**範本步驟的兩個選填旗標**（建立專案時複製進 `workflow.steps[]`，另存為範本時保留）：

- `artifact`：這一步的產出要匯出成變更資料夾裡的哪個檔案（`proposal.md`、`design.md`、
  `tasks.md`、`specs/general/spec.md`）。
- `useBaseContext`：這一步的提示詞要不要帶入「既有規格」（範本裡只有差異規格與封存預演兩步）。

**匯出成 `openspec/changes/<變更名稱>/`**：

- 檔案怎麼拆：預設整份產出寫到步驟的 `artifact` 路徑；產出裡若有 `=== FILE: 路徑 ===` 標記行，
  則每個標記到下一個標記之間是一份檔案（差異規格一個 capability 一份，例如
  `specs/membership/spec.md`），第一個標記之前的前言忽略。AI 常把整份檔案包在 ``` 圍欄裡，
  最外層剛好是一個圍欄時會自動拿掉；提案提示詞請 AI 在最後補的「建議變更名稱：xxx」那行不屬於
  檔案內容，寫檔前移除。沒有標記的差異規格寫到 `specs/general/spec.md` 並警告使用者匯出後自行
  改 capability 資料夾名稱；沒有產出的步驟略過並回報；同一路徑被多個步驟寫到時，後面的覆蓋前面的。
- **AI 的產出是不可信輸入**：所有路徑都經 `sanitizeRelativePath()`——只允許相對路徑、副檔名必須
  是 `.md`、每個片段只含英數與 `._-` 且不以點開頭（所以沒有 `.`／`..`／隱藏檔）、深度 ≤ 5、長度
  ≤ 120；不合法的標記路徑記入 `rejected` 並在畫面顯示，不寫。寫檔前 `writeExportFiles()` 再確認
  最終路徑仍在變更資料夾之內（縱深防禦）。變更名稱必須是 kebab-case（小寫英數與連字號、≤ 60 字）。
- 變更名稱建議值：優先用 AI 在提案產出裡建議的名稱，否則由專案主題轉 kebab-case，全中文（轉完是空的）
  就退回 `change-YYYYMMDD`；畫面上的輸入框使用者可自行修改，改過之後不再被建議值覆蓋。
- 流程：`projects:workflow:exportOpenSpec` 讓使用者選專案資料夾 → 目標已有同名檔案時列出清單、
  問是否覆蓋（取消不動任何檔案）→ 寫入 `<專案資料夾>/openspec/changes/<名稱>/…` → 寫稽核日誌。
  畫面上的檔案清單預覽（`projects:workflow:openspecInfo`，不寫檔）會隨產出變化即時更新。

**匯入現有規格**（brownfield 專案）：差異規格的 `MODIFIED`／`REMOVED` 要對得上現有需求的名稱才寫得對，
所以可以「匯入現有規格…」——選專案根目錄（或 `openspec`、`specs` 資料夾），讀
`openspec/specs/<capability>/spec.md`（每個 capability 一層子資料夾；單檔 > 200KB 略過），依名稱
排序組成文字存進 `workflow.baseContext`（`{ source, text, capabilityCount, includedCount, truncated,
chars, importedAt }`，總長上限 6 萬字，放不下的 capability 記入 `truncated` 並在文字裡註明）。
`composeStepPrompt()` 在標了 `useBaseContext` 的步驟的「目前步驟」與「前面步驟的產出」之間插入
`# 既有規格（專案 openspec/specs 目前的內容）` 段落；其他步驟不帶，避免提示詞無謂膨脹。可隨時清除。

**畫面**：帶 `artifact` 或 `useBaseContext` 步驟的流程，「階段流程」分頁多一個「OpenSpec 整合」
區塊（既有規格狀態＋匯入／清除、變更名稱＋匯出、即將匯出的檔案預覽與警告）；SDD、Scrum、瀑布式、
MVP 範本不顯示。

**IPC**：`projects:workflow:openspecInfo`、`projects:workflow:importOpenSpecSpecs`、
`projects:workflow:clearBaseContext`、`projects:workflow:exportOpenSpec`（見 `preload.js`）。

**已知限制**：不會自動把提示詞送進 AI 帳號視窗或讀取專案的程式碼；不做 OpenSpec 語法驗證
（請用 OpenSpec 自己的 `openspec validate`）；不處理 `openspec/config.yaml` 與 `changes/archive/`；
匯出不寫 `.openspec.yaml` 變更中繼資料（選填檔，OpenSpec 會依預設處理）。

---

## 8. 文件庫（`documents.html`）

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
- **Markdown 預覽**：副檔名是 `.md`/`.markdown` 的文件，編輯區多一個
  「預覽 Markdown」按鈕，點下去呼叫 `documents:getMarkdownPreview` 讀取
  檔案內容、轉成 HTML 就地顯示，不用另外開外部程式。轉換用
  `lib/utils.js` 的 `markdownToHtml()`——刻意手刻的極簡轉換器，涵蓋
  標題/粗體斜體/行內程式碼/fenced code block/清單/引言/連結圖片/分隔線，
  不支援表格、巢狀清單、原始 HTML 穿透。安全性：來源文字一律先 HTML
  escape、只有轉換器自己產生的標籤未跳脫，連結／圖片網址限制只接受
  `http(s)://`、`mailto:` 或相對路徑，`javascript:`/`data:` 一律擋掉
  換成 `#`——因為渲染層是直接把回傳的 HTML 用 `innerHTML` 插入畫面
  （見 `renderer/documents.js`），這個安全邊界不能鬆動。
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

- 跟「文件庫」是兩個獨立資料檔：前者存的是「檔案」本身（路徑引用或
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
`project.html`（專案計畫管理）、`documents.html`（文件庫）、
`conversation.html`（對話庫）、`log.html`（日誌主控台）。

用一個共用的 `openChildWindow(options)` helper 開窗，避免每個視窗各自
重複一份 `new BrowserWindow(...)` 的邏輯，子視窗的寬度**不超過主視窗
寬度的 80%**（取「各視窗設計寬度」跟「80% 主視窗寬度」兩者較小值，
`minWidth` 仍是最終下限）——主視窗開得比較小的時候，沿用設計寬度反而
會比主視窗還寬，看起來很不協調；主視窗開得很大的時候，單純的小表單
（例如新增帳號）也不需要硬撐開：

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
    return existing;
  }

  const effectiveMinWidth = minWidth || 360;
  const effectiveMinHeight = minHeight || 400;

  let effectiveWidth = width;
  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    const cappedByMainWindow = Math.round(state.mainWindow.getBounds().width * 0.8);
    effectiveWidth = Math.max(effectiveMinWidth, Math.min(width, cappedByMainWindow));
  }

  const win = new BrowserWindow({
    width: effectiveWidth,
    height,
    minWidth: effectiveMinWidth,
    minHeight: effectiveMinHeight,
    parent: state.mainWindow,
    modal: false,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', htmlFile));
  win.on('closed', () => setWindow(null));
  setWindow(win);
  return win;
}
```

只限制寬度，不限制高度——各視窗原本設計的高度已經是依內容調校過的值，
不需要跟著主視窗變動。`state.mainWindow` 理論上不會是 `null`（子視窗
一定是在主視窗開著的情況下才會被開啟），但這裡仍然防呆處理，萬一真的
拿不到就直接用設計寬度，不會噴錯。

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

### 9.4 虛擬團隊主控台、專案計畫管理、文件庫、對話庫

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

### 9.8 跨模組快速搜尋（命令面板）

主視窗按 `Ctrl/⌘+K`（或點側邊欄「快速搜尋」按鈕）開啟一個置頂的命令
面板，輸入時即時（`input` 事件，不用按 Enter）橫跨知識庫（提示詞＋
套餐）、文件庫、對話庫、專案（含任務、issue）搜尋，方向鍵上下選、
Enter 跳到選中的項目，Esc 或點背景關閉。比對範圍跟各自視窗內建的搜尋
一致（標題/內容/說明/標籤），結果最多回傳 30 筆（`lib/ipc/search.js`
的 `RESULT_LIMIT`）。

**「跳到項目」的實作方式**——這是這個功能最需要小心處理的地方：

- 每個結果帶一個 `open: { windowKey, id, tab? }`（`windowKey` 是
  `knowledge`/`documents`/`conversations`/`projects` 其中之一），點選
  後呼叫 `search:jumpTo`。
- `search:jumpTo` 內部：把 `{ id, tab }` 存進
  `state.pendingSelections[windowKey]`，然後呼叫對應的
  `openXxxWindow()`（已開著就 focus 現有視窗、沒開就新建，見
  `lib/windows.js` 的 `openChildWindow`）。
- 目標視窗**主動拉取**（pull）這個待選項目，而不是單純被動接收
  （push）：每個目標視窗的 renderer 初始化流程跑完基本資料載入後，
  會呼叫一次 `search:consumePendingSelection(windowKey)`，拿到就套用、
  拿完後端就把這筆記錄清掉。這是為了避開「視窗剛建立、還在載入，這時
  候如果直接 `webContents.send()` 推訊息過去，訊息會在 renderer 還沒
  開始監聽之前就送達、直接遺失」這個 race condition——用主動拉取，
  視窗永遠是自己準備好了才去問「有沒有人要我選什麼」，不會漏接。
- 如果目標視窗**已經開著、已經載入完成**（不會重新走一次初始化流程，
  上面那次拉取的時機已經過了），`search:jumpTo` 會額外直接
  `webContents.send('search:select', { id, tab })` 推一個即時事件，
  每個目標視窗的 renderer 同時也長期監聽這個事件，兩條路徑合起來才能
  同時處理「視窗剛開」跟「視窗已經開著」這兩種情況。
- 專案的結果（task/issue）目前只會跳到對應的專案＋切換到正確的分頁
  （任務結果跳「任務」分頁、issue 結果跳「議題」分頁），不會標記出
  清單裡具體哪一列——這是刻意的簡化，多數專案的任務/issue 清單不會長
  到需要精準定位單一列。

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

- `renderer/locales/zh-TW.json`、`renderer/locales/en.json`、
  `renderer/locales/ja.json`：扁平 key-value 結構，例如
  `"sidebar.addAccount": "新增帳號"`。字串裡可以用 `{變數}` 佔位，三份
  檔案的 key 集合跟每個 key 裡的 `{變數}` 都必須完全一致（新增/修改字串
  時三份一起改，不要只改一份）——`settings.html` 語言下拉選單新增語言
  只要加一個 `<option>` 跟一份對應的 locale json，`renderer/i18n.js`
  完全通用，不用改任何程式碼。
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

**匯出選項對話框**（主視窗側邊欄「匯出當前對話」按鈕）：點下去先跳一個
選項對話框，不是直接匯出——選 Markdown/JSON 格式、可以按「另存到其他
路徑」這次額外跳存檔對話框自己選位置（即使「設定 → 儲存路徑」已經開了
「使用預設路徑時不再詢問」，這次也還是會跳，因為使用者當下就是想自己
選，不該被全域設定蓋過去）、可以勾選「同時加入知識庫」（這個勾選狀態
會記住，下次打開對話框預設沿用上次選的值）。

- `exportCurrentConversation(format, { forceChoosePath, addToKnowledge })`
  （`lib/conversationCapture.js`）：`forceChoosePath` 為 true 時，不管
  `state.appState.ui.skipSaveDialog` 是不是開著，都照樣跳
  `dialog.showSaveDialog()`；`addToKnowledge` 為 true 時，匯出檔案成功
  登記進文件庫的同時，**另外**在知識庫（見第 5 節）新增一筆項目——
  內容一律存成 `toMarkdown(result)`（人類好讀的 Markdown），跟使用者
  這次選的檔案格式（md/json）無關，因為知識庫本來就是拿來當提示詞/
  參考資料用的，原始 JSON 丟進去不好閱讀也不方便直接複製貼上。
- 「同時加入知識庫」的持久化偏好存在
  `state.appState.ui.autoAddToKnowledgeOnExport`，透過
  `settings:setAutoAddToKnowledgeOnExport` 更新，跟「另存到其他路徑」
  是分開的兩件事——後者是「這一次」的選擇，不持久化。
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
- 也掛了頁面層級的診斷：`ensureAccountViewLoaded()` 幫每個帳號的
  `WebContentsView` 接了 `did-fail-load`（頁面本身載入失敗，例如網路
  斷線、被導向登入頁）跟 `console-message`（頁面自己的 JS 噴錯）事件，
  轉送進第 16 節的主控台即時輸出，用來排除「根本不是 selector 的問題，
  而是頁面沒載入成功」這種情況。

---

## 13. IPC 事件總覽（跨視窗即時同步機制）

| 事件                    | 觸發時機                                                                                               | 訂閱方                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `accounts:changed`      | 帳號新增/切換/刪除/角色指派、角色 CRUD、備份匯入                                                       | 主視窗、虛擬團隊主控台、知識庫（刷新角色清單） |
| `knowledge:changed`     | 知識庫項目/套餐的新增、編輯、刪除、匯入、角色刪除清理                                                  | 側邊欄「預設提示詞」區塊                       |
| `documents:changed`     | 文件匯入/儲存/刪除、對話匯出自動登記                                                                   | 文件庫視窗、對話庫視窗                         |
| `conversations:changed` | 對話庫新增/儲存/刪除、匯出自動登記、文件刪除連動清理關聯、備份匯入                                     | 對話庫視窗                                     |
| `projects:changed`      | 專案/任務/issue 的新增、儲存、刪除、狀態切換、工時紀錄新增/移除                                        | （目前沒有其他視窗訂閱，保留給未來擴充）       |
| `reminders:changed`     | 到期摘要重新計算後（每小時排程、或任一次 `projects:changed` 之後都會立刻重算一次）                     | 主視窗（側邊欄「專案計畫」角標）               |
| `logs:changed`          | 任何一筆錯誤/稽核日誌被寫入或清除                                                                      | 日誌主控台視窗                                 |
| `console:entry`         | main process 每呼叫一次 `console.log/info/warn/error`（含頁面 console-message 轉送），即時推送單一筆   | 日誌主控台視窗（主控台分頁）                   |
| `language:changed`      | 語言切換                                                                                               | 所有視窗（重新載入翻譯）                       |
| `search:select`         | 命令面板 `search:jumpTo` 命中「目標視窗已經開著」的情況（見第 9.8 節），只送給那個視窗，不是廣播給全部 | 被跳轉到的那個視窗                             |

---

## 14. 打包（electron-builder）

`package.json` 的 `build` 欄位設定 `appId`、`productName`、
`directories.output: "dist"`、`files`（main.js/preload.js/**`lib/**/_`**/
renderer/**/extractors/**，另外排除 `node_modules/sql.js/dist/`裡用不到
的 asm.js/worker/browser 變體跟壓縮包，減少打包體積）、`asarUnpack: ["extractors/\*\*/_"]`、各平台 `target`
（win: nsis, mac: dmg, linux: AppImage）與對應 icon 路徑
（`assets/icons/icon.ico`/`.icns`/`.png`）。npm scripts：`start`、
`build`、`build:win`、`build:mac`、`build:linux`、`build:dir`（免安裝
資料夾，快速測試用）。

**`files` 陣列務必包含 `lib/**/\*`**：electron-builder 只要你自己指定了
`files`，就只打包陣列裡列到的東西，不會自動囊括專案根目錄下所有檔案。
`main.js`用`require('./lib/utils')`、`require('./lib/sqlite')`依賴`lib/`資料夾，如果漏掉沒列進`files`，打包出來的成品會在啟動時直接
噴 `Cannot find module './lib/...'` 崩潰——這是本專案曾經真的存在過的
設定疏漏（`lib/utils.js`一直都有在用，但`files`陣列一直沒列到它，
只是因為開發時都用`npm start`直接跑原始碼所以沒發現），加入`lib/sqlite.js` 的時候一併修正。

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
lib/reminders.js         # 任務到期日提醒：到期摘要計算、每小時排程、原生系統通知
lib/ipc/index.js         # 匯總註冊所有 IPC handlers
lib/ipc/accounts.js      # accounts:* / roles:* / ui:* IPC
lib/ipc/knowledge.js     # knowledge:* IPC
lib/ipc/settings.js      # settings:* IPC（資料目錄/擴充功能/儲存路徑/備份還原/選取器/疑難排解）
lib/ipc/windows.js       # window:* / app:getVersion IPC
lib/ipc/projects.js      # projects:* IPC（含工時紀錄、到期摘要）
lib/ipc/documents.js     # documents:* IPC（含 Markdown 預覽）
lib/ipc/conversations.js # conversations:* / export:current IPC
lib/ipc/logs.js          # logs:* / console:* IPC
lib/ipc/search.js        # 跨模組快速搜尋（命令面板）：search:* IPC
lib/utils.js             # 不依賴 Electron API 的純函式（字串處理、選擇器推導……）
lib/workflow.js          # 專案階段流程（第 7.6 節）：範本展開、組合提示詞、步驟/任務狀態同步（純函式）
lib/openspec.js          # OpenSpec 整合（第 7.7 節）：匯出成 openspec/changes/、匯入現有規格、路徑安全檢查
lib/sqlite.js            # sql.js（WebAssembly 版 SQLite）的最小包裝：開檔/存檔/查詢
CHANGELOG.md / ROADMAP.md / README.md / PROJECT_SPEC.md / BUILD_PLAN.md
assets/ICON_PROMPTS.md
assets/icons/README.md（+ 之後補上的 icon.ico/.icns/.png）
extractors/domCapture.js
extractors/selectorPicker.js
extractors/default-selectors.json
extractors/default-knowledge-base.json  # 內建的56組提示詞範本（企業日常作業/醫療軟體研發/論文寫作/研究計畫/專案開發各5組，SDD規格驅動開發7組，OpenSpec 8組，企業角色範本8種職務各2組）＋7組分階段套餐範本（groups）
extractors/default-project-templates.json # 內建的5組軟體開發專案範本（SDD／OpenSpec／Scrum／瀑布式／MVP，第 7.6 節）
extractors/default-roles.json           # 內建的8種企業角色（人力資源/行銷企劃/業務銷售/客服支援/專案經理/軟體工程師/財務會計/高階主管），app-state.json 不存在時當 roles 起始內容
renderer/index.html, renderer.js, renderer.css       # 主視窗（多層側邊欄）
renderer/account.html, account.js                    # 新增帳號視窗
renderer/knowledge.html, knowledge.js, knowledge.css # 知識庫（提示詞/套餐/檢核表/角色配置）
renderer/settings.html, settings.js, settings.css    # 設定視窗
renderer/team.html, team.js, team.css                # 虛擬團隊主控台
renderer/project.html, project.js, project.css       # 專案計畫管理
renderer/documents.html, documents.js, documents.css # 文件庫
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
knowledge-base.json # 提示詞項目 + 套餐（步驟可帶 stage 階段名稱）
seeded-defaults.json # 已種過的內建範本 defaultId（knowledgeBase／knowledgeGroups），升級補種用
projects.json        # 專案 + 任務 + 每個專案自己的 issue 清單（從範本建立的專案另帶 workflow 階段流程）
project-templates.json # 使用者自訂的專案範本（內建範本不在這裡，見第 7.6 節）
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
