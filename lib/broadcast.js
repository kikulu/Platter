const { BrowserWindow } = require('electron');

// 跨視窗即時同步一律走這個 helper（不要用輪詢）：任何動作改了會影響其他
// 視窗顯示的資料後，呼叫 broadcastToAllWindows(channel, ...) 通知所有還
// 開著的視窗自己重新拉取資料。現有頻道列表見 PROJECT_SPEC.md 第 13 節。
//
// 獨立成一個沒有其他 lib/** 依賴的小模組，是為了讓 lib/logs.js、
// lib/console.js、lib/windows.js 都可以直接引用它而不會互相循環依賴
// （這幾個模組彼此之間有呼叫關係，但都不需要依賴對方才能廣播事件）。
function broadcastToAllWindows(channel, ...args) {
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed()) w.webContents.send(channel, ...args);
  });
}

module.exports = { broadcastToAllWindows };
