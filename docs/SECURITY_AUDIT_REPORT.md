# Platter 資安檢查報告

| 項目     | 內容                                                                                                                                                 |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 對象版本 | `1.41.0`（commit `83df8fd`）                                                                                                                         |
| 檢查日期 | 2026-10-14                                                                                                                                           |
| 方法     | 靜態程式碼審查（Electron 設定、IPC、檔案存取、HTML 淨化、注入點）、對淨化函式實際餵入惡意輸入、機密掃描（工作樹與完整 git 歷史）、相依與 CI 設定檢視 |
| 未涵蓋   | 沒有在真實 Electron 環境動態測試；**沒有跑 `npm audit`**（本環境連不上 npm 套件庫，回應 403）；沒有檢查已打包的安裝檔                                |

## 1. 結論摘要

整體基礎做得不差：視窗都開了 `contextIsolation`、關了 `nodeIntegration`，每個頁面都有不含 `unsafe-inline` 腳本的 CSP，帳號之間用獨立 session 分區，Markdown 渲染會先跳脫再組標籤，OpenSpec 匯出有嚴格的路徑白名單，工作樹與 git 歷史裡沒有找到金鑰。

主要風險集中在三處：**特權視窗沒有任何導覽限制**、**Electron 版本已超出支援範圍**、**備份匯入完全信任檔案內容**。

| 嚴重度 | 數量 | 編號       |
| ------ | ---- | ---------- |
| 高     | 2    | H-1、H-2   |
| 中     | 5    | M-1 ～ M-5 |
| 低     | 6    | L-1 ～ L-6 |

「驗證方式」欄的意思：**已重現**＝我實際跑出結果；**程式碼推論**＝從程式碼讀出來的，沒有在 Electron 裡實際點過。

## 2. 發現

### 高

#### H-1：特權視窗沒有導覽／開窗限制，預覽內容的外部連結可把視窗導到外部網站

- **位置**：`lib/windows.js` 全檔（找不到任何 `will-navigate`、`will-redirect`、`setWindowOpenHandler`）；`renderer/documents.js:328`、`:358`（把 Markdown／`.docx` 預覽以 `innerHTML` 放進頁面）；`preload.js:3`（`contextBridge.exposeInMainWorld('workspaceAPI', …)`，共 127 個 IPC 方法）。
- **情境**：使用者匯入一份含 `[連結](https://evil.example)` 的 `.md`，或含超連結的 `.docx`，在文件庫預覽後點了連結。連結會被原樣渲染成 `<a href="https://evil.example">`（見下方重現），而且沒有任何程式攔截點擊或導覽。視窗（以及它的 preload）就會導覽到外部頁面。preload 會在每次導覽後重新注入，外部頁面因此拿得到 `window.workspaceAPI`，可以呼叫 `listKnowledge`、對話庫／專案／文件清單、`documents:getPdfBytes` 等，**讀走本機所有資料（含對話庫裡的 AI 對話內容）**，也能呼叫 `documents:openFile` 之類的動作。
- **重現（已重現部分）**：`markdownToHtml('[x](https://evil.example/steal)')` → `<p><a href="https://evil.example/steal">x</a></p>`；`sanitizeDocxHtml('<a href="https://evil.example" target="_blank">x</a>')` 原樣通過。「點了之後視窗真的導覽並取得 `workspaceAPI`」是依 Electron 行為推論，**未實機驗證**。
- **前提**：使用者要匯入並點擊惡意檔案裡的連結。
- **建議**：
  1. 對每個自己的視窗（主視窗、子視窗、托盤）加 `webContents.on('will-navigate', e => e.preventDefault())`（只放行自己的 `file://…/renderer/` 頁面），並加 `setWindowOpenHandler(() => ({ action: 'deny' }))`。
  2. 預覽區攔截 `<a>` 點擊：只對 `http(s):` 用 `shell.openExternal`（最好先跳確認），其他一律擋。
  3. 在 IPC handler 入口檢查 `event.senderFrame.url` 屬於自己的頁面（建議包成共用的 `handle()` 包裝）。
  4. 預覽 HTML 放進 `<iframe sandbox>` 或移除所有 `href`/`target`，只保留文字。

#### H-2：Electron 30 已超出官方支援範圍

- **位置**：`package.json:28`（`"electron": "^30.0.0"`）。
- **說明**：Electron 只維護最新的幾個主版本，30 已不在其中，內含的 Chromium 不會再收到安全修補。App 的核心用途就是在 `WebContentsView` 裡載入第三方網站並登入，所以瀏覽器引擎的漏洞直接暴露在攻擊面上。
- **驗證方式**：版本事實；具體有哪些 CVE 影響，需要用 `npm audit`／Electron 安全公告核對，**本次未能核對**。
- **建議**：先把 §H-1 的導覽限制做完、補上冒煙測試，再單獨一版升級 Electron（升級後重點驗證 `WebContentsView` 疊加、session 分區持久化、打包、sql.js WASM）。README 徽章已改回實際的 `^30`，升級後再改。

### 中

#### M-1：備份匯入沒有驗證內容，可竄改文件路徑與帳號網址

- **位置**：`lib/ipc/settings.js:264`（`settings:importBackup`）、`:277`（帳號）、`:340`（`documents.push(d)`）。
- **說明**：匯入時只用 `id` 判斷是否已存在，其餘欄位整包照收。備份裡的文件項目可以自帶 `filePath` 與 `managed: true`，之後：
  - `documents:openFile`（`lib/ipc/documents.js:148-152`）對任意路徑呼叫 `shell.openPath`；
  - `documents:getPdfBytes`（`:224`）讀取任意路徑；
  - `documents:saveDocxEdit`（`:204`）寫入任意路徑；
  - `documents:delete` 搭配 `alsoDeleteFile`（`:110-116`）會刪除 `managed` 文件指到的任意檔案。

  備份裡的帳號可帶任意 `url`（`platform: 'local'`），會被 `loadURL`，包含 `file://`。

- **前提**：使用者匯入一份別人給的惡意備份，並且在文件庫裡對那筆文件做動作。
- **建議**：匯入時對每個欄位做 schema 驗證；文件的 `filePath` 一律丟棄，只接受位於 `documentsDir()` 底下的路徑，或匯入後標成「檔案遺失」讓使用者重新指定；帳號 `url` 只接受 `http(s)`。

#### M-2：`.docx` 淨化器是黑名單式正規表達式，有多種繞過

- **位置**：`lib/utils.js:589-612`（`sanitizeDocxHtml`）。
- **重現（已重現）**，以下輸入經過淨化後**原樣保留**：
  - 單引號或無引號屬性：`<a href='javascript:alert(1)'>`、`<a href=javascript:alert(1)>`
  - 無引號事件屬性：`<img src=x onerror=alert(1)>`、`<svg onload=alert(1)>`
  - `<form action="https://evil.example">`、`<meta http-equiv="refresh" content="0;url=https://evil.example">`

  實際影響被兩件事壓低：輸入來自 mammoth 轉出的 HTML（會把屬性值跳脫並只產生有限標籤），而且 CSP 的 `script-src 'self'` 會擋掉行內腳本與 `javascript:`。但**導覽類**（`form`、`meta refresh`、`a`）不受 CSP 限制，與 H-1 疊加。另一條路徑是編輯後存回：`documents:saveDocxEdit` 收到的 `html` 來自可編輯區域，同樣依賴這個淨化器。

- **建議**：改用白名單式淨化（例如 DOMPurify，或在 main process 用 HTML parser 只保留 `p/h1-6/ul/ol/li/table/tr/td/th/strong/em/u/a/img/br` 與必要屬性），不要再靠正規表達式。

#### M-3：用系統預設程式開啟任意匯入檔案，包括可執行檔

- **位置**：`lib/ipc/documents.js:148-152`（`shell.openPath(doc.filePath)`）；`documents:import`（`:64-90`）接受任何副檔名。
- **說明**：使用者可把 `.exe`／`.bat`／`.lnk`／`.sh` 等匯入文件庫，點「開啟」就會執行。這是「用預設程式開啟」功能的本質風險，與 M-1 結合時攻擊者可以指定要開的路徑。
- **建議**：對可執行副檔名清單（`.exe .bat .cmd .com .scr .msi .ps1 .lnk .sh .app .jar` 等）改成只「在資料夾中顯示」，或開啟前跳確認。

#### M-4：本地服務網址在主程序沒有驗證

- **位置**：`lib/windows.js:53-56`、`:177-190`（`addAccount`）、`:203`（`updateLocalService`）、`:223-256`（`testLocalServiceConnection`）。
- **說明**：只有 renderer 有檢查 `http(s)://`，主程序直接信任傳入值：`loadURL` 可載入 `file://` 等；連線測試用 `net.request` 對任意網址發請求（在使用者自己操作的前提下是「測試連線」，但搭配 M-1 或 H-1 就變成可被別人觸發的內網探測）。
- **建議**：主程序統一用 `new URL()` 驗證，只接受 `http:`／`https:`。

#### M-5：擴充功能以完整檔案存取權限載入到所有帳號的 session

- **位置**：`lib/ipc/settings.js:113`、`:133`（`loadExtension(ext.path, { allowFileAccess: true })`）、`:87-122`（`settings:addExtension`）。
- **說明**：擴充功能會套用到每一個帳號分區，擴充功能本身可看到所有 AI 平台頁面與對話內容。這是使用者自己選的資料夾，屬於設計行為，但缺少風險提示，也沒有檢視 `manifest.json` 的權限宣告。
- **建議**：新增時顯示 manifest 要求的 `permissions`／`host_permissions` 讓使用者確認；`allowFileAccess` 預設改為 `false`；考慮讓擴充功能只套用到指定帳號。

### 低

| 編號 | 項目                                                                                                                                                                                                                                          | 位置                                             | 建議                                                                                                                                |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| L-1  | **`.bak` 讓「刪除」不是真的刪除**：`1.41.0` 起每次寫入都保留上一版 `.bak`，刪掉的對話／知識庫／文件中繼資料會在 `.bak` 裡多留一個版本，直到下次寫入。對話庫常含敏感內容，備份匯出也會包含。                                                   | `lib/utils.js:303-324`（`writeFileAtomicSync`）  | 在設定頁說明；提供「清除備份檔」；刪除對話庫項目時額外清掉 `.bak`。                                                                 |
| L-2  | **IPC 沒有輸入驗證與 sender 檢查**：127 個 handler 直接信任 payload 形狀（例如 `knowledge:save` 把整個物件展開存入）。renderer 目前可信，但與 H-1 疊加時沒有第二道防線。                                                                      | `lib/ipc/*.js`                                   | 共用 `handle()` 包裝：檢查 `senderFrame.url`、用 schema（例如手寫或 zod）驗證 payload。                                             |
| L-3  | **CSP 不完整**：缺 `base-uri`、`form-action`、`frame-ancestors`、`object-src`、`img-src`。缺 `img-src` 其實讓 `.docx` 內嵌的 `data:image/…` 圖片被擋掉（功能問題）；若直接加寬，要用 `img-src 'self' data:`，不要放行 `https:`。              | 全部 `renderer/*.html` 第 6-8 行                 | 補 `base-uri 'none'; form-action 'none'; object-src 'none'; img-src 'self' data:`。                                                 |
| L-4  | **第三方頁面的 console 輸出被收進主控台並廣播到所有視窗**：網站若在 console 印出 token 或個資，會出現在 Platter 主控台。只在記憶體（上限 `CONSOLE_BUFFER_MAX`），沒有寫進 `logs.sqlite` 或匯出。                                              | `lib/windows.js:118-135`、`lib/console.js:34-45` | 預設不收頁面 console，改成診斷時才開。                                                                                              |
| L-5  | **pdf.js 沒有關閉 `eval`**：`getDocument({ data })` 未傳 `isEvalSupported: false`。已隨附版本 `6.3.289`，新於已知 pdf.js 任意 JS 執行漏洞的修補版，所以不是現存漏洞，屬縱深防禦。                                                             | `renderer/documents.js:465`、`:492`              | 加 `isEvalSupported: false`。                                                                                                       |
| L-6  | **CI 與供應鏈**：workflow 沒有 `permissions:` 限縮；actions 只釘版本標籤沒釘 SHA；沒有 lockfile，`npm install` 每次解析最新符合範圍的版本並執行相依套件的 install script。`pdf-lib 1.17.1` 自 2021 年起沒有新版，卻在主程序解析不可信的 PDF。 | `.github/workflows/ci.yml`、`package.json:22-25` | `permissions: contents: read`；提交 `package-lock.json` 並用 `npm ci --ignore-scripts`；啟用 Dependabot；評估替換或隔離 `pdf-lib`。 |

### 資訊（不是弱點，但值得知道）

- **沒有程式碼簽章設定**：`package.json` 的 `build` 沒有 Windows／macOS 簽章與 notarization 設定，安裝檔會被系統警告，也無法讓使用者驗證來源。
- **資料明文存放**：`app-state.json`、`conversations.json`、`documents/`、備份檔都是明文 JSON／原檔，放在 `userData`。登入 session（cookie）由 Electron 分區管理，同樣明文存放在磁碟。這是桌面應用常見做法，但對話庫內容敏感，值得在文件裡明講，並建議使用者搭配系統磁碟加密。
- **備份不含登入憑證**這項設計原則（見 `PROJECT_SPEC.md` 第 2 節）：備份匯出的欄位來自帳號中繼資料，沒有 cookie；本次未發現違反。

## 3. 檢查過、沒有問題的項目

| 項目                   | 結果                                                                                                                                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 視窗安全設定           | 4 處 `webPreferences`（`lib/windows.js:89`、`:293`、`:396`、`:518`）全部 `contextIsolation: true`、`nodeIntegration: false`。Electron 20 之後預設啟用沙箱，這些視窗沒有關閉沙箱。帳號頁面視圖沒有掛 preload，第三方網站拿不到 `workspaceAPI`。 |
| 帳號隔離               | 每個帳號使用獨立的 `persist:<id>` session 分區，移除帳號時會清除分區資料（`lib/windows.js:84`、`:264`）。                                                                                                                                      |
| CSP 腳本政策           | 10 個頁面都有 CSP，`script-src 'self'` 沒有 `unsafe-inline`，行內事件處理器與 `javascript:` 網址在 renderer 內執行不了。                                                                                                                       |
| Markdown 渲染          | 已重現測試：`<img onerror>` 被跳脫成文字；`javascript:`（含大小寫混用）被換成 `#`；實體編碼與引號跳出（`"onmouseover=`）的嘗試被跳脫，無法形成屬性。                                                                                           |
| 注入到第三方頁面的腳本 | `executeJavaScript` 只有 3 處（`lib/conversationCapture.js:37`、`:276`、`:337`），組字串時對平台名稱與 selector 都用 `JSON.stringify`，沒有未跳脫的串接。                                                                                      |
| 子行程／eval           | 專案程式碼沒有 `child_process`、`eval`、`new Function`。                                                                                                                                                                                       |
| 檔案路徑               | 所有檔案選擇都由主程序對話框完成（renderer 無法指定任意路徑）；OpenSpec 匯出用白名單檢查（片段只能是 `[A-Za-z0-9._-]`、不以點開頭、必須 `.md`、限制深度）並做 `startsWith(changeDir + sep)` 二次檢查（`lib/openspec.js:40-56`、`:219-225`）。  |
| 機密                   | 工作樹與全部 git 歷史掃描 API key、私鑰、`ghp_`／`sk-`／`AKIA` 模式、`.env`／`.pem`／`.p12`，**無發現**；`.gitignore` 排除了 `node_modules/` 與 `dist/`。                                                                                      |
| 資料寫入               | `1.41.0` 起為暫存檔＋rename 的原子寫入，主檔損毀會讀 `.bak`（見 L-1 的隱私取捨）。                                                                                                                                                             |

## 4. 建議的修補順序

| 順序 | 內容                                                                                                | 對應          | 預估範圍                      |
| ---- | --------------------------------------------------------------------------------------------------- | ------------- | ----------------------------- |
| 1    | 所有視窗加 `will-navigate` 擋下、`setWindowOpenHandler` 拒絕；預覽區攔截連結點擊改走 `openExternal` | H-1           | 小：`lib/windows.js` 約 30 行 |
| 2    | 備份匯入加 schema 驗證，丟棄 `filePath`、限制帳號 `url`                                             | M-1、M-4      | 中                            |
| 3    | 可執行副檔名不直接 `openPath`                                                                       | M-3           | 小                            |
| 4    | `.docx` 預覽改白名單淨化                                                                            | M-2           | 中（需決定用哪個函式庫）      |
| 5    | CSP 補齊；pdf.js `isEvalSupported: false`；CI `permissions`、`npm ci`、提交 lockfile                | L-3、L-5、L-6 | 小                            |
| 6    | IPC 共用包裝（sender 檢查＋payload 驗證）                                                           | L-2           | 中                            |
| 7    | 升級 Electron（單獨一版）並在升級後重做這份檢查                                                     | H-2           | 中，需要實機驗證              |
| 8    | 擴充功能權限提示、`allowFileAccess` 預設關閉、`.bak` 清除機制、程式碼簽章                           | M-5、L-1      | 視需求                        |

建議第 1～3 項放進 `1.41.1`（純防禦、不改功能），第 4～6 項放 `1.42.0`，Electron 升級單獨一版。

## 5. 這份報告的限制

- 這是靜態審查加上對淨化函式的實際輸入測試，**沒有動態測試**：H-1 的導覽行為、M-3 的執行行為都是依 Electron 的行為推論，需要在真實環境驗證後再定嚴重度。
- 相依套件沒有漏洞掃描結果。請在有網路的環境執行 `npm audit`（或 `npm audit --omit=dev`），並把結果補進這份報告。
- 沒有檢查打包後的安裝檔、自動更新（目前專案沒有設定）、作業系統層級的權限（例如全域快捷鍵、`1.41.0` 新增）。
- 嚴重度是依「攻擊所需前提」與「影響」的判斷，不是 CVSS 計分。
