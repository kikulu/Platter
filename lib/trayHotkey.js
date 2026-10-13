'use strict';

/**
 * lib/trayHotkey.js
 *
 * 浮動托盤的全域快捷鍵（1.41.0）。
 *   - applyTrayHotkey(prefs, deps)：先取消舊的註冊，依設定重新註冊；註冊失敗
 *     （被別的程式佔用、快捷鍵字串無效、系統不支援）只回報狀態、不丟例外，不影響其他功能。
 *   - getTrayHotkeyStatus()：最近一次註冊結果，設定頁用來顯示。
 *   - unregisterTrayHotkey()：App 結束前呼叫。
 *
 * deps 可注入（測試用）：{ globalShortcut, onTrigger }；預設用 Electron 的 globalShortcut，
 * 觸發時呼叫 lib/windows.js 的 toggleTrayFromHotkey()。
 */

let registeredAccelerator = null;
let lastStatus = { state: 'off', accelerator: null };

function defaultDeps() {
  const { globalShortcut } = require('electron');
  const { toggleTrayFromHotkey } = require('./windows');
  return { globalShortcut, onTrigger: toggleTrayFromHotkey };
}

function unregisterTrayHotkey(globalShortcutArg) {
  const gs = globalShortcutArg || require('electron').globalShortcut;
  if (registeredAccelerator && gs) {
    try {
      gs.unregister(registeredAccelerator);
    } catch (err) {
      // 取消註冊失敗不處理
    }
  }
  registeredAccelerator = null;
}

/**
 * @returns {{ state: 'off'|'ok'|'conflict'|'invalid'|'error', accelerator: string|null, message?: string }}
 */
function applyTrayHotkey(prefs, deps) {
  const { globalShortcut, onTrigger } = deps || defaultDeps();
  unregisterTrayHotkey(globalShortcut);

  if (!prefs || !prefs.hotkeyEnabled) {
    lastStatus = { state: 'off', accelerator: null };
    return lastStatus;
  }
  const accelerator = String(prefs.hotkey || '').trim();
  if (!accelerator) {
    lastStatus = { state: 'invalid', accelerator: null };
    return lastStatus;
  }
  try {
    const ok = globalShortcut.register(accelerator, () => {
      try {
        onTrigger();
      } catch (err) {
        console.error('托盤快捷鍵觸發失敗:', err);
      }
    });
    if (ok && globalShortcut.isRegistered(accelerator)) {
      registeredAccelerator = accelerator;
      lastStatus = { state: 'ok', accelerator };
    } else {
      // register() 回傳 false：快捷鍵被其他程式佔用，或系統（例如 Linux Wayland）不允許
      lastStatus = { state: 'conflict', accelerator };
    }
  } catch (err) {
    // 例如 accelerator 字串格式無效
    lastStatus = { state: 'invalid', accelerator, message: String(err && err.message) };
  }
  return lastStatus;
}

function getTrayHotkeyStatus() {
  return lastStatus;
}

module.exports = { applyTrayHotkey, unregisterTrayHotkey, getTrayHotkeyStatus };
