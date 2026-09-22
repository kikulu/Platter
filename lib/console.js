const { genId } = require('./utils');
const { broadcastToAllWindows } = require('./broadcast');
const { CONSOLE_BUFFER_MAX } = require('./constants');
const state = require('./state');

// ---------------------------------------------------------------------------
// 主控台（Console）：即時攔截 console.log/info/warn/error（含
// WebContentsView 頁面自己的 console-message，見 lib/windows.js 的
// ensureAccountViewLoaded），存一份記憶體內的環狀緩衝區即時廣播給日誌主控台
// 視窗。這是「當下發生什麼事」的原始逐行輸出，跟 lib/logs.js 那邊結構化、
// 會落地存檔的錯誤/稽核日誌是互補關係：
//   - 錯誤/稽核日誌：篩選過的重點事件，存 logs.sqlite，重開 App 還在。
//   - 主控台：完整的原始 console 輸出（含除錯用的細節，例如「這次擷取
//     matched 幾個節點」），只留在記憶體裡，App 關掉就沒了，不佔硬碟空間。
// ---------------------------------------------------------------------------

const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

function formatConsoleArg(arg) {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.stack || arg.message;
  try {
    return JSON.stringify(arg);
  } catch (err) {
    return String(arg);
  }
}

function captureConsole(level, args) {
  const entry = {
    id: genId('cl'),
    timestamp: new Date().toISOString(),
    level,
    text: args.map(formatConsoleArg).join(' '),
  };
  state.consoleBuffer.push(entry);
  if (state.consoleBuffer.length > CONSOLE_BUFFER_MAX) state.consoleBuffer.shift();
  broadcastToAllWindows('console:entry', entry);
  return entry;
}

// 覆蓋全域 console：這是模組載入時就會執行的 side effect。main.js 必須在
// 最前面就 require 這個模組，才能讓之後所有程式碼（含其他 lib/** 模組）的
// console.log 都被攔截記錄，不要延後載入。
['log', 'info', 'warn', 'error'].forEach((level) => {
  console[level] = (...args) => {
    originalConsole[level](...args);
    captureConsole(level, args);
  };
});

module.exports = { formatConsoleArg, captureConsole };
