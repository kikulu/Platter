# 圖示檔案

請把以下檔案放在這個目錄下（打包設定已在 `package.json` 中指向這些路徑）：

- `icon.ico` — Windows 用
- `icon.icns` — macOS 用
- `icon.png` — Linux 用（建議 512x512）

產生方式可參考 `../ICON_PROMPTS.md`。在圖示準備好之前，`npm start` 仍可
正常執行（只有 `npm run build:*` 打包時才會需要這些檔案）。
