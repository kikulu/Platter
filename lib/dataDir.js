const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { writeFileAtomicSync, readJsonFileWithBackup } = require('./utils');

// ---------------------------------------------------------------------------
// 資料目錄（可由使用者搬到外部資料夾；指標檔永遠留在 Electron 預設 userData）
// ---------------------------------------------------------------------------

const DEFAULT_USER_DATA_DIR = app.getPath('userData');
const DATA_DIR_POINTER_FILE = path.join(DEFAULT_USER_DATA_DIR, 'data-dir-pointer.json');

function readJSONSafe(filePath, fallback) {
  try {
    const result = readJsonFileWithBackup(filePath, fallback);
    if (result.source === 'backup') {
      console.error('主檔損毀，已改從備份（.bak）讀取:', filePath);
    } else if (result.error) {
      console.error('讀取 JSON 失敗:', filePath, result.error);
    }
    return result.data;
  } catch (err) {
    console.error('讀取 JSON 失敗:', filePath, err);
    return fallback;
  }
}

function writeJSONSafe(filePath, data) {
  try {
    // 原子寫入（暫存檔 → rename）並保留上一份 .bak，寫到一半當機不會留下被截斷的檔案
    writeFileAtomicSync(filePath, JSON.stringify(data, null, 2), { backup: true });
    return true;
  } catch (err) {
    console.error('寫入 JSON 失敗:', filePath, err);
    return false;
  }
}

/**
 * schema 升級前，把升級前的檔案複製一份成 `<檔名>.v<舊版本>.bak`（已存在就不覆蓋，
 * 所以永遠是「第一次升級前」的原貌）。失敗只記錄、不擋升級。
 */
function backupBeforeMigration(filePath, fromVersion) {
  try {
    const dest = `${filePath}.v${fromVersion}.bak`;
    if (fs.existsSync(filePath) && !fs.existsSync(dest)) fs.copyFileSync(filePath, dest);
  } catch (err) {
    console.error('升級前備份失敗:', filePath, err);
  }
}

function getDataDir() {
  const pointer = readJSONSafe(DATA_DIR_POINTER_FILE, null);
  if (pointer && pointer.dataDir && fs.existsSync(pointer.dataDir)) {
    return pointer.dataDir;
  }
  return DEFAULT_USER_DATA_DIR;
}

function setDataDir(newDir) {
  writeJSONSafe(DATA_DIR_POINTER_FILE, { dataDir: newDir });
}

function resetDataDir() {
  if (fs.existsSync(DATA_DIR_POINTER_FILE)) {
    fs.unlinkSync(DATA_DIR_POINTER_FILE);
  }
}

function isDefaultDataDir() {
  return getDataDir() === DEFAULT_USER_DATA_DIR;
}

function statePath() {
  return path.join(getDataDir(), 'app-state.json');
}
function knowledgePath() {
  return path.join(getDataDir(), 'knowledge-base.json');
}
function selectorsPath() {
  return path.join(getDataDir(), 'selectors.json');
}
function projectsPath() {
  return path.join(getDataDir(), 'projects.json');
}
// 使用者自己另存的專案範本（內建範本放在 extractors/default-project-templates.json，
// 唯讀、隨程式版本更新，不會複製進資料目錄）。
function projectTemplatesPath() {
  return path.join(getDataDir(), 'project-templates.json');
}
function documentsMetaPath() {
  return path.join(getDataDir(), 'documents.json');
}
function documentsDir() {
  return path.join(getDataDir(), 'documents');
}
function conversationsMetaPath() {
  return path.join(getDataDir(), 'conversations.json');
}
// 記錄「已經被種過哪些內建預設範本」，讓覆蓋安裝／版本升級時，新版
// extractors/default-knowledge-base.json 裡新增的範本可以補進使用者既有
// 的 knowledge-base.json，而不會動到使用者已刪除或編輯過的舊範本。
// 詳見 lib/stores.js 的 loadKnowledgeBase() / seedDefaultKnowledgeBase()。
function seededDefaultsPath() {
  return path.join(getDataDir(), 'seeded-defaults.json');
}
function legacyLogsJsonPath() {
  return path.join(getDataDir(), 'logs.json');
}
function logsDbPath() {
  return path.join(getDataDir(), 'logs.sqlite');
}

module.exports = {
  readJSONSafe,
  writeJSONSafe,
  backupBeforeMigration,
  getDataDir,
  setDataDir,
  resetDataDir,
  isDefaultDataDir,
  statePath,
  knowledgePath,
  selectorsPath,
  projectsPath,
  projectTemplatesPath,
  documentsMetaPath,
  documentsDir,
  conversationsMetaPath,
  seededDefaultsPath,
  legacyLogsJsonPath,
  logsDbPath,
};
