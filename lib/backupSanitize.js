'use strict';

/**
 * lib/backupSanitize.js
 *
 * 備份匯入（settings:importBackup）的資料驗證（1.42.0，見 docs/SECURITY_AUDIT_REPORT.md M-1）。
 * 備份檔是外部輸入：不能假設它是自己匯出的。這裡的函式都是純函式，不碰檔案系統。
 *
 *   - sanitizeBackupAccount：帳號只留白名單欄位，平台必須已知，本地服務網址必須是 http(s)
 *   - sanitizeBackupDocument：文件的 filePath 只接受「文件庫資料夾底下」的路徑，其餘清空
 *   - validRecords：陣列裡只留「有字串 id 的物件」
 */

const { PLATFORM_URLS, LOCAL_SERVICE_TYPES } = require('./constants');
const { normalizeServiceUrl, isPathInside } = require('./security');

const ID_RE = /^[A-Za-z0-9_.-]{1,100}$/;

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function str(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

/** 陣列裡只留「物件且有非空字串 id」的項目（其餘丟棄）。 */
function validRecords(arr) {
  return (Array.isArray(arr) ? arr : []).filter(
    (r) =>
      isPlainObject(r) &&
      typeof r.id === 'string' &&
      r.id.length > 0 &&
      r.id.length <= 200
  );
}

/**
 * @returns {object|null} 乾淨的帳號物件；不合法回傳 null
 */
function sanitizeBackupAccount(raw) {
  if (!isPlainObject(raw) || typeof raw.id !== 'string' || !ID_RE.test(raw.id))
    return null;
  const isLocal = raw.platform === 'local';
  if (!isLocal && !Object.prototype.hasOwnProperty.call(PLATFORM_URLS, raw.platform)) {
    return null;
  }
  const account = {
    id: raw.id,
    platform: raw.platform,
    name: str(raw.name, 200).trim() || raw.platform,
    roleId:
      typeof raw.roleId === 'string' && raw.roleId ? raw.roleId.slice(0, 100) : null,
  };
  if (isLocal) {
    // 網址不合法時清空（帳號仍會還原，畫面上可以重新編輯網址），不載入任何東西
    account.url = normalizeServiceUrl(raw.url) || '';
    account.serviceType = Object.prototype.hasOwnProperty.call(
      LOCAL_SERVICE_TYPES,
      raw.serviceType
    )
      ? raw.serviceType
      : 'custom';
  }
  return account;
}

/**
 * 文件中繼資料：filePath 只有「位於文件庫資料夾底下」才保留；否則清空並把 managed 設為 false
 * （清單上會顯示「檔案遺失」，使用者可以重新匯入）。這樣惡意備份就不能指定「開啟／讀取／
 * 覆寫／刪除」電腦上的任意檔案。
 * @returns {{ doc: object, pathCleared: boolean } | null}
 */
function sanitizeBackupDocument(raw, documentsDir) {
  if (!isPlainObject(raw) || typeof raw.id !== 'string' || !ID_RE.test(raw.id))
    return null;
  const inside =
    typeof raw.filePath === 'string' && isPathInside(raw.filePath, documentsDir);
  const doc = {
    ...raw,
    name: str(raw.name, 300) || str(raw.originalName, 300),
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === 'string') : [],
    notes: str(raw.notes, 20000),
    filePath: inside ? raw.filePath : '',
    managed: inside && raw.managed === true,
  };
  return {
    doc,
    pathCleared: !inside && typeof raw.filePath === 'string' && raw.filePath !== '',
  };
}

module.exports = { sanitizeBackupAccount, sanitizeBackupDocument, validRecords };
