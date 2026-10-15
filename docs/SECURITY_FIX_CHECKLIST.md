# 資安修補清單檢核表

> 依據：[`SECURITY_AUDIT_REPORT.md`](./SECURITY_AUDIT_REPORT.md)（2026-10-14，對象 `1.41.0`）。
> 目標版本：`1.42.0`。順序依「攻擊面大小 → 修補成本」排列，每一組修完就 commit 一次。
>
> 狀態圖例：`[x]` 已修並有測試；`[~]` 已修但只能靠人工在真實 Electron 驗證（單元測試涵蓋不到）；
> `[ ]` 未修；`[-]` 這次刻意不修（附原因）。

## 進度總表

| 組  | 內容                          | 對應發現         | 狀態 |
| --- | ----------------------------- | ---------------- | ---- |
| A   | 導覽限制與 IPC 來源檢查       | H-1、L-2         | [x]   |
| B   | 輸入驗證                      | M-1、M-4、M-3    | [x]   |
| C   | 淨化與 CSP                    | M-2、L-3、L-5    | [x]   |
| D   | 擴充功能、備份檔、頁面 console | M-5、L-1、L-4    | [ ]  |
| E   | CI 與供應鏈                   | L-6              | [ ]  |
| F   | Electron 升級、lockfile、簽章 | H-2、L-6、資訊項 | [-]  |

## A. 導覽限制與 IPC 來源檢查

- [x] **H-1-1** 自己的視窗（主視窗、各子視窗、托盤）：`will-navigate`／`will-redirect` 只放行
      `renderer/` 底下的 `file://` 頁面，其餘一律擋下。`lib/windows.js`、`lib/security.js`
- [x] **H-1-2** 自己的視窗：`setWindowOpenHandler` 一律拒絕。
- [x] **H-1-3** 帳號視圖（第三方網站）：擋 `file:` 等非網頁協定的導覽與開窗（不擋 http(s)，避免弄壞 OAuth 彈窗登入）。
- [x] **H-1-4** 文件庫預覽內的連結：攔截點擊，只接受 `http(s):`／`mailto:`，確認後交給系統瀏覽器；新增 IPC `app:openExternal`（主程序再驗一次）。
- [x] **L-2-1** 所有 IPC handler 統一檢查 `event.senderFrame.url` 必須是 `renderer/` 底下的頁面，否則拒絕並寫入錯誤日誌。`lib/ipc/index.js`
- [x] 測試：`test/security.test.js`（網址判斷、sender 判斷、`guardIpc`、`hardenAppWebContents` 以假物件驗證）

## B. 輸入驗證

- [x] **M-1-1** 備份匯入：逐筆驗證欄位型別，帳號只留白名單欄位（`id`／`platform`／`name`／`roleId`／`url`／`serviceType`）。
- [x] **M-1-2** 備份匯入：文件的 `filePath` 只接受 `documents/` 資料夾底下的路徑，其餘清空（清單顯示「檔案遺失」）。
      **取捨**：原本指向外部檔案的未管理文件，還原後需要重新匯入。
- [x] **M-1-3** 刪除文件時，`alsoDeleteFile` 只刪「`managed` 且位於 `documents/` 底下」的檔案（第二道防線）。
- [x] **M-4-1** 主程序驗證本地服務網址：`addAccount`、`updateLocalService`、連線測試、載入時都只接受 `http:`／`https:`。
- [x] **M-4-2** `addAccount` 的 `platform` 必須是已知平台或 `local`。
- [x] **M-3-1** `documents:openFile` 對可執行／腳本／容易夾帶指令的副檔名（`.exe .bat .ps1 .sh .lnk .jar .html .svg`、巨集文件等）拒絕開啟，畫面提示改用「在資料夾中顯示」。
- [x] 測試：`test/backup-sanitize.test.js`、`test/security.test.js` 的網址與副檔名案例

## C. 淨化與 CSP

- [x] **M-2-1** `.docx` 預覽／存回的 HTML 淨化改成**白名單**（標籤與屬性），取代正規表達式黑名單；
      屬性值先解碼 HTML 實體再判斷網址協定；`<form>`、`<meta>`、無引號／單引號屬性都不再通過。`lib/utils.js`
- [x] **M-2-2** `safeUrl()` 補強：判斷前先去掉空白與控制字元（擋 `java<TAB>script:`）、擋 `//` 與反斜線開頭的協定相對網址。
- [x] **L-3-1** 10 個頁面的 CSP 補上 `base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'; img-src 'self' data:`
      （同時讓 `.docx` 內嵌圖片能顯示；先前被 `default-src 'self'` 擋掉）。
- [x] **L-5-1** pdf.js `getDocument` 加 `isEvalSupported: false`（2 處）。
- [x] 測試：`test/docx-sanitize.test.js`（報告裡重現過的所有繞過字串）、`test/csp.test.js`（每個頁面都有必要指令）

## D. 擴充功能、備份檔、頁面 console

- [ ] **M-5-1** 新增擴充功能前顯示 `manifest.json` 的 `permissions`／`host_permissions`，使用者確認才安裝；範圍過大（`<all_urls>`）加註警告。
- [ ] **M-5-2** `loadExtension` 的 `allowFileAccess` 改為 `false`（3 處）。
      **取捨**：需要讀本機檔案的擴充功能會失效。
- [ ] **L-1-1** 「設定 → 疑難排解」新增「清除備份檔（.bak）」按鈕。
- [ ] **L-1-2** 刪除對話庫項目後立刻清掉 `conversations.json.bak`。
- [ ] **L-4-1** 第三方頁面的 console 輸出預設**不再**收進主控台；「設定 → 疑難排解」新增開關，診斷擷取問題時再打開。
- [ ] 測試：`test/security.test.js`（權限摘要、`.bak` 清除）

## E. CI 與供應鏈

- [ ] **L-6-1** workflow 加 `permissions: contents: read`。
- [ ] **L-6-2** `npm install` 改成 `npm install --ignore-scripts`（相依套件的 install script 不執行；測試只需要純 JS 套件）。
- [ ] **L-6-3** 新增 `.github/dependabot.yml`（npm 與 GitHub Actions，每週）。

## F. 這次刻意不修（需要網路或真實環境）

- [-] **H-2** Electron 30 → 支援中的版本：本環境連不上 npm 套件庫，無法安裝與驗證，盲改版本號風險大於收益。
      建議在完成冒煙測試後單獨一版升級。
- [-] **L-6** `package-lock.json` 與 `npm ci`：同上，需要在有網路的環境產生並提交。
- [-] **L-6** GitHub Actions 釘 commit SHA：無法在這裡查到正確的 SHA，亂填會讓 CI 壞掉；交給 Dependabot 維護。
- [-] **L-6** 替換或隔離 `pdf-lib`：需要評估替代方案與回歸測試，列入 ROADMAP。
- [-] **資訊** 程式碼簽章、資料明文存放：屬於發佈流程與產品決策，已記在報告，不是程式修補。
- [-] **新增依賴**：不引入 DOMPurify 等新套件（同樣裝不了），改用自寫的白名單淨化器並以測試固定行為。

## 修完後仍需人工驗證（單元測試涵蓋不到）

- [ ] 文件庫預覽 Markdown／`.docx` 內的連結：點了會跳確認、不會讓預覽視窗本身導覽離開
- [ ] 所有子視窗與托盤正常開啟、IPC 正常運作（`senderFrame` 檢查在真實 Electron 下沒有誤擋）
- [ ] 帳號頁面的 OAuth 彈窗登入（Google／GitHub 等）沒有被誤擋
- [ ] `.docx` 預覽的圖片現在會顯示；編輯後存回格式沒壞
- [ ] PDF 預覽在加了 `isEvalSupported: false` 與新 CSP 後仍正常（含 Web Worker）
- [ ] 擴充功能新增流程的確認對話框；設定頁新增的兩個按鈕／開關
