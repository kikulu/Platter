// lib/sqlite.js
//
// 用 sql.js（純 WebAssembly 的 SQLite，沒有原生模組，不用 electron-rebuild）
// 包一層最小可用的存取介面。
//
// 重要限制（呼叫端要知道的取捨）：
// sql.js 的資料庫整個活在記憶體裡，並不是「開一個檔案然後直接對硬碟讀寫」；
// 每次要落地存檔，都要呼叫 `db.export()` 把整個資料庫匯出成一份 bytes，
// 再整份寫回檔案。這代表：
//   1. 資料庫檔案大小成長到一定程度後，頻繁存檔的成本會跟著變高（整份
//      重寫，不是增量寫入）——這對 Platter 這種單機單人、資料量頂多幾千筆
//      的使用情境沒有問題，但不適合拿來裝很大量的資料。
//   2. 如果 App 在「資料庫已經在記憶體裡改了，但還沒呼叫存檔」的當下意外
//      關閉/崩潰，那筆變更就會遺失。呼叫端必須自己決定存檔時機（例如每次
//      寫入後就立刻存檔，犧牲一點效能換取不遺失資料）。
const fs = require('fs');
const path = require('path');

let sqlJsModulePromise = null;

// 載入 sql.js 的 WASM 模組（只需要做一次，之後重複呼叫拿到同一份）
function loadSqlJs() {
  if (!sqlJsModulePromise) {
    const initSqlJs = require('sql.js');
    sqlJsModulePromise = initSqlJs({
      // sql.js 需要知道去哪裡找 sql-wasm.wasm 這個二進位檔；直接指到套件
      // 自己 dist 資料夾裡的檔案，不依賴目前工作目錄。
      locateFile: (file) => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file),
    });
  }
  return sqlJsModulePromise;
}

// 開啟（或建立）一個 sql.js 資料庫檔案：檔案存在就讀進記憶體還原，不存在
// 就給一個全新的空白資料庫（呼叫端要自己接著建表）。
async function openDatabaseFile(filePath) {
  const SQL = await loadSqlJs();
  if (fs.existsSync(filePath)) {
    const fileBuffer = fs.readFileSync(filePath);
    return new SQL.Database(fileBuffer);
  }
  return new SQL.Database();
}

// 把記憶體裡的資料庫整份匯出、寫回硬碟。
function saveDatabaseFile(db, filePath) {
  const data = db.export();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from(data));
}

// 方便的查詢輔助：跑一段 SQL，回傳一整排 { 欄位名: 值 } 物件的陣列
// （sql.js 原生 API 是用 prepare/step/getAsObject 這種比較底層的寫法，
// 大多數地方其實只是想要「跑 SQL 拿一堆物件」，包一層減少重複程式碼）。
function queryAll(db, sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

module.exports = { loadSqlJs, openDatabaseFile, saveDatabaseFile, queryAll };
