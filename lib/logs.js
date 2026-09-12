const fs = require('fs');
const { genId } = require('./utils');
const { openDatabaseFile, saveDatabaseFile, queryAll } = require('./sqlite');
const { logsDbPath, legacyLogsJsonPath } = require('./dataDir');
const { broadcastToAllWindows } = require('./broadcast');
const { LOG_MAX_ENTRIES } = require('./constants');
const state = require('./state');

// ---------------------------------------------------------------------------
// 日誌主控台：錯誤日誌 + 稽核日誌，存在 DATA_DIR/logs.sqlite（sql.js，
// 純 WebAssembly 版 SQLite，見 lib/sqlite.js 開頭的取捨說明），各自最多
// 保留最新 LOG_MAX_ENTRIES 筆（超過自動裁掉最舊的），避免無限成長。
//   errors 資料表: id, timestamp, scope, message, stack
//   audits 資料表: id, timestamp, category, action, detail
// 注意：lib/dataDir.js 的 readJSONSafe / writeJSONSafe 內部的 catch 刻意
// 不呼叫 logError，避免「寫日誌本身失敗」造成無窮遞迴。
//
// sql.js 的資料庫整個活在記憶體裡，每次寫入後都要手動呼叫
// saveLogsDatabase() 把整份資料庫匯出寫回硬碟，才不會在 App 意外關閉時
// 遺失最新的幾筆紀錄——這裡選擇「每次寫入就立刻存檔」，用效能換資料
// 安全（日誌寫入頻率對單機單人使用情境來說不高，這樣做完全夠用）。
// ---------------------------------------------------------------------------

async function initLogsDatabase() {
  state.logsDb = await openDatabaseFile(logsDbPath());
  state.logsDb.run(`
    CREATE TABLE IF NOT EXISTS errors (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      scope TEXT,
      message TEXT,
      stack TEXT
    );
    CREATE TABLE IF NOT EXISTS audits (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      category TEXT,
      action TEXT,
      detail TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_errors_timestamp ON errors(timestamp);
    CREATE INDEX IF NOT EXISTS idx_audits_timestamp ON audits(timestamp);
  `);

  migrateLegacyJsonLogsIfNeeded();

  state.logsDbReady = true;
  saveLogsDatabase();
  state.pendingLogEntries.splice(0).forEach(({ kind, entry }) => appendLogEntry(kind, entry));
}

function saveLogsDatabase() {
  if (!state.logsDb) return;
  saveDatabaseFile(state.logsDb, logsDbPath());
}

// 舊版（1.11 以前）把日誌存在 logs.json，第一次升級啟動、偵測到舊檔而且
// 新的 SQLite 資料庫還是空的，就搬過去一次，避免使用者原本的日誌歷史
// 憑空消失；搬完把舊檔改名成 .migrated 留底，不直接刪除。
function migrateLegacyJsonLogsIfNeeded() {
  const legacyPath = legacyLogsJsonPath();
  if (!fs.existsSync(legacyPath)) return;

  const errorCountRows = queryAll(state.logsDb, 'SELECT COUNT(*) AS c FROM errors');
  const auditCountRows = queryAll(state.logsDb, 'SELECT COUNT(*) AS c FROM audits');
  const hasExistingRows =
    (errorCountRows[0] && errorCountRows[0].c > 0) || (auditCountRows[0] && auditCountRows[0].c > 0);
  if (hasExistingRows) return; // 新資料庫已經有資料了，不要覆蓋

  try {
    const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf-8'));
    (Array.isArray(legacy.errors) ? legacy.errors : []).forEach((e) => {
      state.logsDb.run('INSERT OR IGNORE INTO errors (id, timestamp, scope, message, stack) VALUES (?, ?, ?, ?, ?)', [
        e.id || genId('log'),
        e.timestamp || new Date().toISOString(),
        e.scope || null,
        e.message || null,
        e.stack || null,
      ]);
    });
    (Array.isArray(legacy.audits) ? legacy.audits : []).forEach((a) => {
      state.logsDb.run('INSERT OR IGNORE INTO audits (id, timestamp, category, action, detail) VALUES (?, ?, ?, ?, ?)', [
        a.id || genId('log'),
        a.timestamp || new Date().toISOString(),
        a.category || null,
        a.action || null,
        a.detail || null,
      ]);
    });
    fs.renameSync(legacyPath, `${legacyPath}.migrated`);
    console.log('[logs] 已把舊版 logs.json 搬進 SQLite，原始檔案改名為 logs.json.migrated 留底');
  } catch (err) {
    console.error('[logs] 搬移舊版 logs.json 失敗', err);
  }
}

function loadLogs() {
  if (!state.logsDbReady) return { errors: [], audits: [] };
  return {
    errors: queryAll(state.logsDb, 'SELECT id, timestamp, scope, message, stack FROM errors ORDER BY timestamp ASC'),
    audits: queryAll(state.logsDb, 'SELECT id, timestamp, category, action, detail FROM audits ORDER BY timestamp ASC'),
  };
}

function trimLogTable(table) {
  state.logsDb.run(
    `DELETE FROM ${table} WHERE id NOT IN (SELECT id FROM ${table} ORDER BY timestamp DESC LIMIT ${LOG_MAX_ENTRIES})`
  );
}

function clearLogs(kind) {
  if (!state.logsDbReady) return;
  if (kind === 'errors' || kind === 'audits') {
    state.logsDb.run(`DELETE FROM ${kind}`);
  } else {
    state.logsDb.run('DELETE FROM errors');
    state.logsDb.run('DELETE FROM audits');
  }
  saveLogsDatabase();
  broadcastToAllWindows('logs:changed');
}

function appendLogEntry(kind, entry) {
  if (!state.logsDbReady) {
    // 極早期（initLogsDatabase 的 await 還沒完成）就有人呼叫，先排進這裡，
    // 等 DB 準備好再一次補寫進去，避免直接漏記。
    state.pendingLogEntries.push({ kind, entry });
    return;
  }
  const id = genId('log');
  const timestamp = new Date().toISOString();
  if (kind === 'errors') {
    state.logsDb.run('INSERT INTO errors (id, timestamp, scope, message, stack) VALUES (?, ?, ?, ?, ?)', [
      id,
      timestamp,
      entry.scope || null,
      entry.message || null,
      entry.stack || null,
    ]);
    trimLogTable('errors');
  } else if (kind === 'audits') {
    state.logsDb.run('INSERT INTO audits (id, timestamp, category, action, detail) VALUES (?, ?, ?, ?, ?)', [
      id,
      timestamp,
      entry.category || null,
      entry.action || null,
      entry.detail || null,
    ]);
    trimLogTable('audits');
  }
  saveLogsDatabase();
  broadcastToAllWindows('logs:changed');
}

// scope 例如 'documents:import'、'extensions:load'、'process'；err 可以是 Error 或字串或 undefined
function logError(scope, message, err) {
  console.error(`[${scope}]`, message, err || '');
  appendLogEntry('errors', {
    scope,
    message,
    stack: err && err.stack ? err.stack : err ? String(err) : null,
  });
}

// category 例如 'account'|'project'|'document'|'conversation'|'backup'|'settings'|'extension'
function logAudit(category, action, detail) {
  appendLogEntry('audits', { category, action, detail: detail || '' });
}

module.exports = {
  initLogsDatabase,
  saveLogsDatabase,
  loadLogs,
  clearLogs,
  appendLogEntry,
  logError,
  logAudit,
};
