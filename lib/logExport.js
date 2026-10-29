'use strict';

/**
 * lib/logExport.js
 *
 * 日誌匯出的類型與預設檔名（純函式，可直接用 node --test 測試）。
 * 檔名一律帶類型：platter-errors-2026-10-28.json、platter-audits-…、platter-console-…、platter-logs-all-…
 */

const LOG_EXPORT_KINDS = ['errors', 'audits', 'console', 'all'];

function buildLogExportFileName(kind, date) {
  const k = LOG_EXPORT_KINDS.includes(kind) ? kind : 'all';
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  // 用本地日期（不是 UTC），凌晨匯出時檔名日期才跟使用者看到的一致
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const base = k === 'all' ? 'platter-logs-all' : `platter-${k}`;
  return `${base}-${day}.json`;
}

module.exports = { LOG_EXPORT_KINDS, buildLogExportFileName };
