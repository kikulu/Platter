const test = require('node:test');
const assert = require('node:assert');
const {
  normalizeTrayPrefs,
  pushRecent,
  resolveRecentItems,
} = require('../lib/utils');
const { applyTrayHotkey, getTrayHotkeyStatus } = require('../lib/trayHotkey');

// ---- 最近使用 ----

test('pushRecent：新的放最前面、去重、只留上限筆數', () => {
  let r = [];
  r = pushRecent(r, 'a', 3);
  r = pushRecent(r, 'b', 3);
  r = pushRecent(r, 'c', 3);
  assert.deepStrictEqual(r, ['c', 'b', 'a']);
  r = pushRecent(r, 'a', 3); // 再用一次 a：移到最前面，不重複
  assert.deepStrictEqual(r, ['a', 'c', 'b']);
  r = pushRecent(r, 'd', 3); // 超過上限：最舊的被擠掉
  assert.deepStrictEqual(r, ['d', 'a', 'c']);
});

test('pushRecent：上限 0 代表關閉，一律回傳空陣列；無效 id 不記錄', () => {
  assert.deepStrictEqual(pushRecent(['a'], 'b', 0), []);
  assert.deepStrictEqual(pushRecent(['a'], '', 5), []);
  assert.deepStrictEqual(pushRecent(['a'], null, 5), []);
  assert.deepStrictEqual(pushRecent(undefined, 'x', 5), ['x']);
});

test('pushRecent：上限超過 20 時以 20 為準', () => {
  let r = [];
  for (let i = 0; i < 30; i++) r = pushRecent(r, 'id' + i, 99);
  assert.strictEqual(r.length, 20);
  assert.strictEqual(r[0], 'id29');
});

test('resolveRecentItems：知識庫項目被刪除時自動略過，順序維持，不超過上限', () => {
  const items = [{ id: 'a', title: 'A' }, { id: 'c', title: 'C' }, { id: 'd', title: 'D' }];
  // b 已被刪除
  const out = resolveRecentItems(['d', 'b', 'a', 'c'], items, 2);
  assert.deepStrictEqual(out.map((x) => x.id), ['d', 'a']);
  assert.deepStrictEqual(resolveRecentItems(undefined, items, 5), []);
  assert.deepStrictEqual(resolveRecentItems(['a'], undefined, 5), []);
});

test('normalizeTrayPrefs：舊資料沒有快捷鍵／最近使用欄位時走預設（快捷鍵預設關閉、保留 5 筆）', () => {
  const p = normalizeTrayPrefs({ projectMode: 'current' });
  assert.strictEqual(p.projectMode, 'current');
  assert.strictEqual(p.hotkeyEnabled, false);
  assert.strictEqual(p.hotkey, 'CommandOrControl+Shift+P');
  assert.strictEqual(p.recentLimit, 5);
  assert.deepStrictEqual(p.recent, []);
  assert.deepStrictEqual(normalizeTrayPrefs(undefined).recent, []);
});

test('normalizeTrayPrefs：數值超出範圍、型別錯誤、recent 有重複時修正', () => {
  assert.strictEqual(normalizeTrayPrefs({ recentLimit: 999 }).recentLimit, 20);
  assert.strictEqual(normalizeTrayPrefs({ recentLimit: -3 }).recentLimit, 0);
  assert.strictEqual(normalizeTrayPrefs({ recentLimit: 'abc' }).recentLimit, 5);
  assert.strictEqual(normalizeTrayPrefs({ hotkey: '   ' }).hotkey, 'CommandOrControl+Shift+P');
  const p = normalizeTrayPrefs({ recentLimit: 2, recent: ['a', 'a', 5, 'b', 'c'] });
  assert.deepStrictEqual(p.recent, ['a', 'b']); // 去重、略過非字串、截到上限
});

// ---- 全域快捷鍵註冊 ----

function fakeShortcut({ registerResult = true, throwOnRegister = false } = {}) {
  const registered = new Set();
  const calls = { register: [], unregister: [] };
  return {
    calls,
    registered,
    register(acc, cb) {
      calls.register.push(acc);
      if (throwOnRegister) throw new Error('bad accelerator');
      if (registerResult) registered.add(acc);
      this.last = cb;
      return registerResult;
    },
    unregister(acc) {
      calls.unregister.push(acc);
      registered.delete(acc);
    },
    isRegistered: (acc) => registered.has(acc),
  };
}

test('applyTrayHotkey：未啟用時不註冊，狀態為 off', () => {
  const gs = fakeShortcut();
  const st = applyTrayHotkey({ hotkeyEnabled: false, hotkey: 'Ctrl+K' }, { globalShortcut: gs, onTrigger() {} });
  assert.strictEqual(st.state, 'off');
  assert.strictEqual(gs.calls.register.length, 0);
});

test('applyTrayHotkey：註冊成功，觸發時呼叫 onTrigger；重新套用會先取消舊的', () => {
  const gs = fakeShortcut();
  let fired = 0;
  const deps = { globalShortcut: gs, onTrigger: () => fired++ };
  let st = applyTrayHotkey({ hotkeyEnabled: true, hotkey: 'CommandOrControl+Shift+P' }, deps);
  assert.strictEqual(st.state, 'ok');
  gs.last();
  assert.strictEqual(fired, 1);
  st = applyTrayHotkey({ hotkeyEnabled: true, hotkey: 'Alt+Space' }, deps);
  assert.strictEqual(st.state, 'ok');
  assert.ok(gs.calls.unregister.includes('CommandOrControl+Shift+P'));
  assert.ok(!gs.registered.has('CommandOrControl+Shift+P'));
  // 關閉：取消註冊
  st = applyTrayHotkey({ hotkeyEnabled: false }, deps);
  assert.strictEqual(st.state, 'off');
  assert.strictEqual(gs.registered.size, 0);
  assert.strictEqual(getTrayHotkeyStatus().state, 'off');
});

test('applyTrayHotkey：被佔用（register 回傳 false）→ conflict，不丟例外', () => {
  const gs = fakeShortcut({ registerResult: false });
  const st = applyTrayHotkey({ hotkeyEnabled: true, hotkey: 'Ctrl+C' }, { globalShortcut: gs, onTrigger() {} });
  assert.strictEqual(st.state, 'conflict');
  assert.strictEqual(st.accelerator, 'Ctrl+C');
});

test('applyTrayHotkey：格式無效（register 丟例外）→ invalid，不丟例外', () => {
  const gs = fakeShortcut({ throwOnRegister: true });
  const st = applyTrayHotkey({ hotkeyEnabled: true, hotkey: '???' }, { globalShortcut: gs, onTrigger() {} });
  assert.strictEqual(st.state, 'invalid');
});

test('applyTrayHotkey：觸發時 onTrigger 丟例外不會讓快捷鍵 callback 崩潰', () => {
  const gs = fakeShortcut();
  applyTrayHotkey(
    { hotkeyEnabled: true, hotkey: 'Alt+X' },
    {
      globalShortcut: gs,
      onTrigger: () => {
        throw new Error('boom');
      },
    }
  );
  const origError = console.error;
  console.error = () => {};
  try {
    assert.doesNotThrow(() => gs.last());
  } finally {
    console.error = origError;
  }
});
