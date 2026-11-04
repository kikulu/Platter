'use strict';

/**
 * lib/startupPolicy.js
 *
 * 啟動與崩潰復原的決策規則（純函式，不依賴 Electron，可直接用 node --test 測試）。
 *
 *   - 開機時要不要自動載入上次使用的帳號頁面（記憶體吃緊時延後，改成使用者點了才載入）
 *   - 托盤視窗延後多久再建立
 *   - 渲染行程消失（render-process-gone）後該怎麼處理：自動重載、還是顯示提示讓使用者決定
 *
 * 取捨說明：Electron 的 process.getSystemMemoryInfo() 在不同平台的 `free` 意義略有差異
 * （Linux 上可能不含可回收的快取），所以「自動」模式只在「可用記憶體很少」時才延後，
 * 判斷不準的人可以在「設定 → 疑難排解」改成「一律載入」。
 */

const STARTUP_LOAD_MODES = ['auto', 'defer', 'load'];
const DEFAULT_STARTUP_LOAD = 'auto';

// 可用記憶體低於 1 GB，或不到總量 8%，視為吃緊（單位：KB，跟 getSystemMemoryInfo 一致）
const LOW_MEMORY_FREE_KB = 1024 * 1024;
const LOW_MEMORY_FREE_RATIO = 0.08;

const TRAY_DELAY_MS = 1500;
const TRAY_DELAY_LOW_MEMORY_MS = 8000;
const REMINDERS_DELAY_MS = 5000;

// 自動重載的最短間隔：避免頁面一載入就崩潰造成無限重載迴圈
const AUTO_RELOAD_MIN_INTERVAL_MS = 60 * 1000;

function normalizeStartupLoad(value) {
  return STARTUP_LOAD_MODES.includes(value) ? value : DEFAULT_STARTUP_LOAD;
}

/** @param {{total?:number, free?:number}|null} info  process.getSystemMemoryInfo() 的結果（KB） */
function isLowMemory(info) {
  if (!info || typeof info !== 'object') return false;
  const free = Number(info.free);
  const total = Number(info.total);
  if (!Number.isFinite(free) || free <= 0) return false; // 讀不到就當作沒問題，不要誤擋
  if (free < LOW_MEMORY_FREE_KB) return true;
  return Number.isFinite(total) && total > 0 && free / total < LOW_MEMORY_FREE_RATIO;
}

/** 開機時是否延後載入帳號頁面。 */
function shouldDeferAccountLoad(mode, memoryInfo) {
  const m = normalizeStartupLoad(mode);
  if (m === 'defer') return true;
  if (m === 'load') return false;
  return isLowMemory(memoryInfo);
}

function trayStartDelayMs(lowMemory) {
  return lowMemory ? TRAY_DELAY_LOW_MEMORY_MS : TRAY_DELAY_MS;
}

/** 渲染行程消失的原因 → 畫面上要顯示的分類（記憶體不足 / 其他） */
function crashKind(reason) {
  return reason === 'oom' || reason === 'memory-eviction' ? 'oom' : 'crashed';
}

/**
 * 渲染行程消失後怎麼辦。
 * @param {string} reason  Electron render-process-gone 的 details.reason
 * @param {{ now: number, lastAutoReloadAt: number, isOwnWindow?: boolean }} ctx
 * @returns {'ignore'|'auto-reload'|'prompt'}
 *   ignore：正常結束；auto-reload：直接重載；prompt：顯示提示，由使用者按「重新載入」
 */
function decideCrashAction(reason, ctx) {
  if (reason === 'clean-exit') return 'ignore';
  const now = Number(ctx && ctx.now) || 0;
  const last = Number(ctx && ctx.lastAutoReloadAt) || 0;
  const cooledDown = now - last >= AUTO_RELOAD_MIN_INTERVAL_MS;
  // 自己的視窗（本機 HTML，載入成本很低）：什麼原因都先自動重載一次，除了連續崩潰
  if (ctx && ctx.isOwnWindow) return cooledDown ? 'auto-reload' : 'prompt';
  // 第三方帳號頁面：記憶體不足類不自動重載（會立刻又吃掉記憶體、造成重載迴圈），交給使用者
  if (crashKind(reason) === 'oom') return 'prompt';
  if (reason === 'launch-failed' || reason === 'integrity-failure') return 'prompt';
  return cooledDown ? 'auto-reload' : 'prompt';
}

module.exports = {
  STARTUP_LOAD_MODES,
  DEFAULT_STARTUP_LOAD,
  LOW_MEMORY_FREE_KB,
  LOW_MEMORY_FREE_RATIO,
  TRAY_DELAY_MS,
  TRAY_DELAY_LOW_MEMORY_MS,
  REMINDERS_DELAY_MS,
  AUTO_RELOAD_MIN_INTERVAL_MS,
  normalizeStartupLoad,
  isLowMemory,
  shouldDeferAccountLoad,
  trayStartDelayMs,
  crashKind,
  decideCrashAction,
};
