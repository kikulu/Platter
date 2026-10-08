# 平行開發：多對話分別開發再合併

用途：把專案資料夾放進多個新對話，各自完成一項功能，最後合併。

## 流程

1. 每個分支對話都上傳同一份基準（`Platter_v1_40_0.zip`，含 `.git`，tag `v1.40.0`），
   貼上對應的提示詞；只做一項功能，輸出 `<分支名稱>.patch` 與 `docs-fragments/<分支名稱>.md`。
2. 全部完成後，開合併對話，上傳基準 zip 與所有 patch／fragments，貼上
   [generic.md](./generic.md) 的「提示詞 2」。合併對話統一處理版本號、CHANGELOG、README、
   PROJECT_SPEC，並打新 tag。

## 檔案

| 檔案                                                                     | 內容                                                 |
| ------------------------------------------------------------------------ | ---------------------------------------------------- |
| [generic.md](./generic.md)                                               | 通用範本：分支對話提示詞（待填功能）＋合併對話提示詞 |
| [feature-a-conversation-preview.md](./feature-a-conversation-preview.md) | A：對話擷取預覽與重複儲存提示                        |
| [feature-b-tray-project-mode.md](./feature-b-tray-project-mode.md)       | B：托盤專案區塊顯示條件可設定                        |
| [feature-c-stage-prompts-edit.md](./feature-c-stage-prompts-edit.md)     | C：階段提示詞可編輯與從知識庫更新                    |
| [feature-d-tray-hotkey-recent.md](./feature-d-tray-hotkey-recent.md)     | D：托盤全域快捷鍵與最近使用                          |

## 衝突熱點

| 檔案                                    | 會動到的功能 | 注意                                                          |
| --------------------------------------- | ------------ | ------------------------------------------------------------- |
| `renderer/tray.js`／`tray.css`          | B、D         | B 集中改 `appendProjectSection()`；D 的最近使用做成獨立函式   |
| `lib/workflow.js`                       | B、C         | B 只改 `buildTrayProjectGroups()`；C 改 stagePrompts 相關函式 |
| `renderer/locales/*.json`、`preload.js` | 全部         | 合併後檢查 key／方法不重複、三語對齊                          |

建議套用順序：A → C → B → D（A 幾乎不碰共用檔案；C 先定 stagePrompts 欄位；B 其次；D 最後）。

## 注意

- 基準版本改變時（例如升到 1.41.0），要把提示詞裡的 `v1.40.0`、zip 檔名同步更新。
- 各分支對話看不到彼此的修改，所以每個功能說明都寫了「不要動的範圍」。
- 分支對話不改版本號與主要文件，避免合併時一定衝突。
