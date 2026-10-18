'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { t, currentLanguage } = require('../lib/i18n');
const state = require('../lib/state');

test('t：找不到的鍵回傳鍵本身；變數取代；指定語言', () => {
  assert.equal(t('main.__no_such_key__'), 'main.__no_such_key__');
  assert.equal(currentLanguage(), 'zh-TW');
  // 既有的 renderer 鍵也可以在主程序取得
  assert.equal(
    t('settings.troubleshoot.clearBackups', null, 'en'),
    'Clear backup files (.bak)'
  );
  assert.equal(
    t('settings.troubleshoot.clearBackupsDone', { count: 3 }, 'en'),
    'Cleared 3 backup file(s).'
  );
});

test('t：跟著 appState.ui.language 切換；不合法的語言退回 zh-TW', () => {
  const original = state.appState.ui.language;
  try {
    state.appState.ui.language = 'ja';
    assert.match(t('settings.troubleshoot.clearBackups'), /バックアップ/);
    state.appState.ui.language = 'xx';
    assert.equal(currentLanguage(), 'zh-TW');
  } finally {
    state.appState.ui.language = original;
  }
});
