# AI 參與度 ☕

烘焙深度：用咖啡「杯數」表示 AI 介入程度。
AI做越多，人需要喝的咖啡就越少。

# Platter

<p align="center">
  <a href="./README.en.md">English</a> ·
  <a href="./README.ja.md">日本語</a> ·
  <strong>繁體中文</strong>
</p>

<p align="center">
  <strong>一個視窗，管理你所有的 AI 帳號。</strong><br />
  跨平台 AI 帳號聚合桌面工具——同時登入 Claude、ChatGPT、Gemini、Grok，
  各自獨立、互不干擾。
</p>

<p align="center">
  <img alt="platform" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-informational" />
  <img alt="electron" src="https://img.shields.io/badge/Electron-%5E31-47848F?logo=electron&logoColor=white" />
  <img alt="node" src="https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white" />
  <a href="./.github/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/badge/CI-GitHub%20Actions-2088FF?logo=githubactions&logoColor=white" /></a>
  <img alt="license" src="https://img.shields.io/badge/license-Unlicensed-lightgrey" />
</p>

---

## 為什麼會有這個專案

每天在 Claude、ChatGPT、Gemini、Grok 之間切來切去，開一堆瀏覽器分頁、
帳號常常互相登出、找不到之前存的 prompt——這個 App 想解決的就是這件事：

- 每個帳號都是完全獨立的登入 session（不是同一個瀏覽器分頁換帳號），
  互相看不到彼此的 cookie
- 側邊欄一鍵切換，毫秒級、不用重新登入
- 想留住的對話手動匯出成 Markdown / JSON
- 常用的 prompt / skill 範本集中管理，不用每次重打

不做的事也很明確（見下方「設計原則」）：不碰任何平台的未公開 API、不做
任何規避平台風控偵測的自動化、不把登入憑證塞進任何備份檔案。

## 目錄

- [功能總覽](#功能總覽)
- [安裝與執行](#安裝與執行)
- [使用方式](#使用方式)
- [設計原則](#設計原則)
- [架構](#架構)
- [開發](#開發)
- [打包發布](#打包發布)
- [專案結構](#專案結構)
- [設定檔位置](#設定檔位置)
- [文件索引](#文件索引)
- [貢獻](#貢獻)
- [License](#license)

## 功能總覽

| 功能                    | 說明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🗂️ 多帳號聚合           | Claude / ChatGPT / Gemini / Grok，每個帳號各自獨立登入、互不干擾，切換是毫秒級的                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 🔐 登入狀態持久化       | 重開程式不用重新登入                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ⚡ 懶載入               | 開機只載入上次選中的帳號，其他帳號等你點了才載入，帳號多也不會拖慢開機                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 📐 側邊欄摺疊           | 可摺成只顯示 icon 的窄版                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 🔍 跨模組快速搜尋       | `Ctrl/⌘+K` 打開命令面板，一次搜尋知識庫、文件庫、對話庫、專案（含任務/議題），選了直接跳到對應視窗跟項目                                                                                                                                                                                                                                                                                                                                                                                                       |
| 📚 知識庫（獨立視窗）   | 內建 56 組跨領域提示詞範本（企業日常作業/醫療軟體研發/論文寫作/研究計畫/專案開發/SDD 規格驅動開發/OpenSpec/企業角色範本），支援全文搜尋、標籤篩選，可匯出成 Markdown 或 JSON                                                                                                                                                                                                                                                                                                                                   |
| 📦 分階段提示詞套餐     | 套餐可以把步驟分成多個階段（例如「規劃 → 撰寫 → 投稿」），每個階段可「複製本階段」一次貼進同一段 AI 對話；內建 7 組分階段套餐範本（論文寫作、研究計畫、軟體專案開發、醫療器材軟體合規、專案例行溝通、SDD 規格驅動開發、OpenSpec 變更流程）                                                                                                                                                                                                                                                                     |
| 🧑‍💼 企業角色提示詞範本   | 內建 8 種常見企業職務角色（HR／行銷／業務／客服／PM／工程師／財務／高階主管），每種角色各配好 2 組任務範本，每組都拆成「系統提示詞」與「使用者提示詞」，開機即用，側邊欄「預設提示詞」可分別一鍵複製                                                                                                                                                                                                                                                                                                           |
| 📋 專案範本與階段流程   | 「專案計畫管理」可從範本建立專案：內建 SDD 規格驅動開發、OpenSpec 變更流程、敏捷 Scrum、傳統瀑布式、MVP 快速原型 5 組軟體開發範本。輸入專案主題後，在「階段流程」分頁依各階段的提示詞逐步執行——複製（自動帶入主題與前面步驟的產出）→ 貼回 AI 的產出 → 標記完成 → 下一步，每個步驟同步成一個專案任務；也能把調整過的流程另存為自己的範本。**OpenSpec 整合**：可匯入專案現有的 `openspec/specs` 當作差異規格的依據，並把提案、差異規格、設計、任務的產出一鍵匯出成專案裡的 `openspec/changes/<變更名稱>/` 資料夾 |
| 🧩 虛擬團隊主控台       | 把帳號依角色組織成團隊組織圖，並在「專案計畫管理」裡建立專案、拆分任務、指派給團隊裡的帳號、追蹤進度、記錄工時                                                                                                                                                                                                                                                                                                                                                                                                 |
| ⏰ 到期提醒             | 側邊欄角標顯示逾期／今天到期的任務與議題數量，有新的到期項目會另外跳一次系統通知                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 🗃️ 文件庫               | 統一保存對話匯出的檔案與手動匯入的任意檔案，.md 檔可直接預覽                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ➕ 新增帳號（獨立視窗） | 選平台、取自訂名稱，新增完直接切過去                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ⬇️ 對話匯出             | 把畫面上目前看得到的對話存成 Markdown 或 JSON，可另存到指定路徑、可勾選同時加入知識庫，也可設定自動存檔不跳對話框                                                                                                                                                                                                                                                                                                                                                                                              |
| ⚙️ 設定（獨立視窗）     | 語言切換、設定檔存放位置、擴充功能、預設匯出路徑、備份還原、選擇器設定（含測試擷取預覽）、滑鼠選取工具、疑難排解                                                                                                                                                                                                                                                                                                                                                                                               |
| 🌐 多國語系             | 繁體中文 / English / 日本語，可擴充                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 🧩 擴充功能             | 全域套用「已解壓縮」格式的 Chrome 擴充功能                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 🛡️ 資料安全             | 設定檔原子寫入 + 覆蓋前自動備份，匯入格式嚴格驗證                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## 安裝與執行

需求：[Node.js](https://nodejs.org/)（建議 LTS 版本，18 以上）、npm。

```bash
git clone <這個 repo 的網址>
cd ai-workspace-aggregator
npm install
npm start
```

## 使用方式

1. 開啟 App，點側邊欄「＋ 新增帳號」，選平台（Claude/ChatGPT/Gemini/Grok）、
   取個自訂名稱，跳出的網頁裡正常登入即可。
2. 側邊欄的帳號清單點一下就切換，重複步驟 1 可以加更多帳號。
3. 想匯出對話：切到該帳號、點「匯出當前對話」，選存 Markdown 或 JSON。
   第一次用建議先到「設定 → 選擇器設定」用滑鼠選取工具校正一下（見下方
   說明），不然可能抓不到內容。
4. 常用的 prompt 存進「知識庫」，之後點開複製貼上就好，不用重打。內建的
   「企業角色範本」（HR／行銷／業務／客服／PM／工程師／財務／高階主管）
   已經拆成系統提示詞／使用者提示詞兩欄，把帳號的角色設成對應職務後，
   側邊欄「預設提示詞」就能直接分別複製這兩欄，貼到不同的欄位（例如
   ChatGPT 的 Custom Instructions 用系統提示詞、對話輸入框用使用者
   提示詞）。多步驟的工作（寫論文、寫研究計畫、走專案流程……）可以用
   「套餐」：內建 7 組分階段套餐（含 SDD 規格驅動開發：原則 → 規格 → 規劃 → 任務 → 實作，以及 OpenSpec 變更流程），也能自己在套餐編輯器用「＋ 階段」加
   階段標題、用 ↑↓ 把步驟移到不同階段，每個階段按「複製本階段」就能一次
   複製該階段所有提示詞，步驟前的勾選框可以追蹤進度。
5. 「設定」裡可以調語言、換設定檔存放資料夾、裝擴充功能、備份還原整份
   設定。

## 設計原則

這三條原則貫穿整個專案的技術決策，任何新功能都要先過這一關：

1. **不呼叫任何平台的未公開 / 內部 API**，不做自動化規避風控偵測的行為。
   對話匯出靠讀取「當前畫面上已經渲染出來的 DOM 內容」，效果等同使用者
   手動框選複製。
2. **不做任何繞過網站保護機制的事**——不自動下載/解壓 Chrome 線上應用
   程式商店的擴充功能、不剝除第三方網站的安全性標頭。
3. **不把登入憑證打包進任何可攜式檔案**——備份/匯出檔案不含 cookie 或
   localStorage，那些永遠留在 Electron 自己管理、跟系統帳號綁定的位置。

## 架構

<details>
<summary>點開看技術細節（Session 隔離、多視窗設計、i18n、選取器工具...）</summary>

### Session 隔離與帳號管理

- 每個帳號用 `session.fromPartition('persist:<accountId>')` 建立獨立
  partition，Cookie / LocalStorage / IndexedDB 互不干擾，`persist:` 前綴
  讓資料寫到磁碟，重開程式後用同一個 id 接回登入狀態。
- 帳號畫面不是 `<iframe>` 或 `<webview>`，是 `WebContentsView`
  （Electron 30+ API）疊加在主視窗上，`setBounds()` 定位、`setVisible()`
  切換顯示，因此帳號切換是毫秒級的。
- **懶載入**：開機只註冊帳號 metadata，`WebContentsView` 是第一次
  `switchAccount()` 切過去才建立，帳號養得越多、開機資源占用差異越明顯。
  懶載入帳號第一次載入時，畫面會顯示 loading 提示。

### 獨立視窗架構

「新增帳號」「知識庫」「設定」都是獨立的 `BrowserWindow`
（`parent: mainWindow`，**非** modal），不是疊在主視窗裡的 HTML 彈窗——
WebContentsView 是原生疊層、不受 CSS z-index 控制，疊在主視窗裡的彈窗
容易被蓋住或搶走鍵盤焦點；用 modal 視窗又會鎖住主視窗，跟「滑鼠選取
selector」這種需要切回主視窗互動的功能衝突。三個視窗共用同一份
`preload.js`，`main.js` 裡的 `openChildWindow()` 是共用的開窗 helper。

### 多國語系

`renderer/locales/` 底下的 JSON 語言檔 + `renderer/i18n.js` 共用輔助
程式，靠 `data-i18n` 系列 HTML 屬性自動套用翻譯，動態字串用
`window.i18n.t(key, vars)`。語言偏好存檔、切換時廣播給所有視窗同步更新。

### 滑鼠選取 selector 工具

「設定 → 選擇器設定」可以直接用滑鼠點選畫面上的訊息來產生候選 CSS
selector，不用手動開 DevTools 找——點「選取範例：使用者訊息」和「選取
範例：AI 回覆」各一次，程式比對兩者算出訊息容器 selector 跟使用者訊息
判斷關鍵字。純粹是輔助猜測，套用後建議檢查、必要時手動微調。

### 資料安全

設定檔寫入統一走 `writeJsonFile()` helper：先寫 `.tmp` 檔、成功後才
`rename` 覆蓋正式檔（原子寫入），覆蓋前自動備份成 `.bak`。匯入功能
（知識庫、備份）會先驗證 JSON 結構，格式不對會給清楚的錯誤訊息。

</details>

## 開發

```bash
npm test              # 單元測試（純函式、資料層種子、IPC handler，node --test 內建測試框架；除 sql.js 外不需要額外套件）
npm run lint          # ESLint（main.js/preload.js/lib/test 用 Node 規則，renderer/** 用瀏覽器規則）
npm run format        # Prettier 自動排版（會直接覆寫檔案，跑之前建議先 commit）
npm run format:check  # 只檢查格式，不覆寫檔案
```

`main.js` 已經模組化完成：現在只剩 App 生命週期本身（約 70 行），資料層、
視窗管理、對話擷取/匯出、IPC handlers 都拆進 `lib/**`（依業務領域分成
`lib/ipc/` 底下 9 個檔案）。`lib/utils.js` 放不依賴 Electron API 的純函式
（字串處理、檔案系統輔助函式），跟其他模組分開才能直接用 `node --test`
測，不需要啟動 Electron。各模組職責分工、跨模組共用狀態的慣例見
`PROJECT_SPEC.md` 第 15 節「檔案結構」。

`lib/sqlite.js` 包了 `sql.js`（純 WebAssembly 版 SQLite，沒有原生模組、
不需要 `electron-rebuild`）的最小存取介面，目前給「日誌主控台」的
`logs.sqlite` 用；選型取捨見 `PROJECT_SPEC.md` 第 9.7 節。`npm install`
時會一併裝進 `sql.js` 這個 dependency，不需要額外設定。

> 目前 `main.js`/`preload.js`/`renderer/**` 還沒有整批套用過
> `npm run format`，先跑 `npm run format:check` 看目前有多少檔案不符合
> 排版規則；要一次套用到整個專案，直接跑 `npm run format` 即可，但這會
> 產生大量非功能性的排版 diff，建議跟其他改動分開提交。

## 打包發布

用 [electron-builder](https://www.electron.build/) 打包：

```bash
npm run build:win     # Windows：NSIS 安裝檔
npm run build:mac     # macOS：dmg
npm run build:linux   # Linux：AppImage
npm run build:dir     # 免安裝資料夾，快速測試用
```

輸出在 `dist/`。App 圖示放 `assets/icons/`（目前是空的），準備步驟見
[`assets/icons/README.md`](./assets/icons/README.md) 跟
[`assets/ICON_PROMPTS.md`](./assets/ICON_PROMPTS.md)——圖示備好之前打包
會找不到 icon 檔而失敗，這是預期中的。

## 專案結構

```
Platter/
├── main.js                # App 生命週期入口（單一實例鎖、視窗全關/啟用），其餘邏輯拆進 lib/**
├── preload.js              # contextBridge，所有視窗共用
├── package.json              # npm scripts + electron-builder 設定
├── lib/
│   ├── constants.js           # 平台網址、側邊欄寬度、UI 狀態預設值
│   ├── state.js                # 共用可變狀態單例（視窗參照、appState、console 緩衝區……）
│   ├── dataDir.js               # DATA_DIR 讀寫/搬移、各資料檔路徑
│   ├── broadcast.js              # broadcastToAllWindows（跨視窗即時同步）
│   ├── console.js                 # 主控台：攔截全域 console.*
│   ├── logs.js                     # 日誌主控台：錯誤日誌 + 稽核日誌（sql.js/SQLite）
│   ├── stores.js                    # 資料層：各資料檔的 loadX()/saveX()
│   ├── windows.js                    # 視窗與帳號 WebContentsView 管理
│   ├── conversationCapture.js         # 對話擷取/匯出、選取器工具
│   ├── reminders.js                    # 任務到期日提醒：到期摘要、排程、系統通知
│   ├── utils.js                        # 不依賴 Electron API 的純函式
│   ├── workflow.js                      # 專案階段流程與範本展開、組合提示詞（純函式）
│   ├── openspec.js                      # OpenSpec 整合：匯出成 openspec/changes/、匯入現有規格
│   ├── sqlite.js                        # sql.js 的最小包裝：開檔/存檔/查詢
│   └── ipc/                              # 依業務領域分組的 IPC handler 註冊檔（9 個 + index.js，含 search.js）
├── extractors/
│   ├── domCapture.js         # 注入頁面的對話擷取腳本
│   ├── selectorPicker.js      # 注入頁面的滑鼠選取工具
│   ├── default-selectors.json # 出廠預設 selector
│   ├── default-project-templates.json # 內建5組軟體開發專案範本（SDD／OpenSpec／Scrum／瀑布式／MVP）
│   ├── default-knowledge-base.json # 內建56組提示詞範本（一般40組＋企業角色範本16組）＋7組分階段套餐範本
│   └── default-roles.json     # 內建8種企業角色（app-state.json 不存在時當 roles 起始內容）
├── renderer/
│   ├── index.html / renderer.js / renderer.css   # 主視窗
│   ├── account.html / account.js                 # 新增帳號（獨立視窗）
│   ├── knowledge.html / knowledge.js / knowledge.css  # 知識庫（獨立視窗）
│   ├── settings.html / settings.js / settings.css     # 設定（獨立視窗）
│   ├── team.html, team.js, team.css              # 虛擬團隊主控台
│   ├── project.html, project.js, project.css     # 專案計畫管理
│   ├── documents.html, documents.js, documents.css # 文件庫（含 Markdown 預覽）
│   ├── i18n.js                                   # 多國語系
│   └── locales/zh-TW.json, en.json
└── assets/                    # App 圖示與生成提示詞
```

## 設定檔位置

執行時自動產生在 `app.getPath('userData')`：

```
config-location.json   # 指標檔：實際設定檔要去哪個資料夾讀
app-state.json          # 帳號清單、選中帳號、側邊欄狀態、預設匯出路徑、語言
knowledge-base.json     # 知識庫項目
selectors.json          # 抓取對話用的 selector
extensions.json         # 已安裝的擴充功能清單
```

可以在「設定 → 設定檔存放位置」把上面（`config-location.json` 除外）幾個
檔案改指到外部資料夾（例如雲端同步資料夾，多台機器共用同一份設定）。
**不含**實際登入的 cookie/localStorage。

## 文件索引

| 文件                                                               | 內容                                                                                                  |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| [CHANGELOG.md](./CHANGELOG.md)                                     | 版本歷程，每次加了什麼功能                                                                            |
| [ROADMAP.md](./ROADMAP.md)                                         | 還沒做、之後可能會做的方向                                                                            |
| [PROJECT_SPEC.md](./PROJECT_SPEC.md)                               | 完整規格提示詞，適合給有檔案系統工具的 agent（Claude Code / Cursor）重現整個專案                      |
| [BUILD_PLAN.md](./BUILD_PLAN.md)                                   | 分階段（目前 16 階段）的建置提示詞，適合給 Gemini / Grok / ChatGPT 這類沒有檔案系統工具的模型從零重建 |
| [NEW_FEATURE_BUILD_PROMPT.md](./NEW_FEATURE_BUILD_PROMPT.md)       | 既有階段都做完之後，要加新功能時用的提示詞模板                                                        |
| [FIX_EXISTING_FEATURE_PROMPT.md](./FIX_EXISTING_FEATURE_PROMPT.md) | 修正既有功能問題時用的提示詞模板                                                                      |
| [SPEC_ONLY_BUILD_PROMPT.md](./SPEC_ONLY_BUILD_PROMPT.md)           | 開新對話只附文件、不附原始碼時用的提示詞模板                                                          |
| [PARTIAL_FILES_BUILD_PROMPT.md](./PARTIAL_FILES_BUILD_PROMPT.md)   | 開新對話只附規格文件＋指定的部分檔案（不是整包原始碼）時用的提示詞模板                                |

## 貢獻

歡迎 fork 之後開 PR。目前還沒有接 CI，以下檢查都要自己在本機跑過一次，
送 PR 前請確認：

1. `npm test` 全部通過（`node --test`）
2. `npm run lint` 沒有新增的 error（既有的 1 個 warning 是預期中的，見
   `extractors/domCapture.js` 的說明，不用處理）
3. 有牽動到功能行為的改動，實際 `npm start` 跑過一輪再送出——上面兩項
   只涵蓋純函式、資料層與 IPC handler（用假的 electron 模組直接呼叫），
   真正的 Electron 視窗互動與版面要手動驗證
4. 新功能如果違反上面「設計原則」三條（呼叫未公開 API、繞過網站保護
   機制、把登入憑證放進備份檔案），不會被接受
5. 如果順手跑了 `npm run format`，記得跟功能改動分開成不同的 commit/PR，
   方便 review（格式化 diff 會很大，混在一起不好看變更內容）

## License

[MIT](<a href="./LICENSE.txt">LICENSE</a>)
