const path = require('path');
const fs = require('fs');
const { app } = require('electron');

// ---------------------------------------------------------------------------
// 資料目錄（可由使用者搬到外部資料夾；指標檔永遠留在 Electron 預設 userData）
// ---------------------------------------------------------------------------

const DEFAULT_USER_DATA_DIR = app.getPath('userData');
const DATA_DIR_POINTER_FILE = path.join(DEFAULT_USER_DATA_DIR, 'data-dir-pointer.json');

function readJSONSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('讀取 JSON 失敗:', filePath, err);
    return fallback;
  }
}

function writeJSONSafe(filePath, data) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('寫入 JSON 失敗:', filePath, err);
    return false;
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
  getDataDir,
  setDataDir,
  resetDataDir,
  isDefaultDataDir,
  statePath,
  knowledgePath,
  selectorsPath,
  projectsPath,
  documentsMetaPath,
  documentsDir,
  conversationsMetaPath,
  seededDefaultsPath,
  legacyLogsJsonPath,
  logsDbPath,
};
